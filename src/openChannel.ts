/**
 * Host half of the extension command channel: the /tmp spool the embedded
 * workbench's `dsh.selection-reference` extension (≥ 0.1.1) polls.
 *
 * Layout: `<tmpdir>/dsh-sidebar-vscode/<slug(workspace folder)>/<file>.json`
 * — one directory per workspace folder, addressed by a filesystem-safe slug
 * BOTH sides derive from the folder path they independently know (the client
 * sends the mapped folder; the extension derives it from its own
 * `workspaceFolders[0]`). The directory name, the file names, the version
 * bounds, and the slug function all live in the shared protocol plane
 * (`src/shared/protocol.ts`, mirrored in `extension/lib/protocol.js` and
 * pinned by `tests/protocolLockstep.spec.ts`). `/tmp` is shared by the
 * default same-container topology (serve-web runs beside dsh-runtime — see
 * the plugin README's deployment section); a split deployment simply fails
 * the capability probe and the client falls back to the URL-payload channel.
 *
 * - `cap.json` — the extension's liveness marker (`{v,at}`, written by
 *   builds ≥ 0.1.2 and refreshed on its poll tick whenever older than a
 *   minute); the route only reports it fresh AND versioned within
 *   {@link CAPABILITY_MAX_AGE_MS}, so a dead extension stops being
 *   "capable" within that window after its last write — and a deployment
 *   still carrying the pre-0.1.2 build (whose bare-timestamp marker fails
 *   the version parse) is never handed commands at all: that build
 *   replayed the last command on every extension-host restart.
 * - `cmd.json` — the last open command (atomic tmp+rename write). The
 *   consuming extension (≥ 0.1.2) deletes it once acted on, drops entries
 *   older than its command TTL, and keeps a monotonic nonce watermark in
 *   `last.json` — three independent guards against the same replay: a
 *   sidebar tab close/reopen tears down and reboots the workbench, and a
 *   fresh extension host reading a leftover cmd.json re-opened the file
 *   the user had just closed.
 *
 * All persistence flows through one {@link SpoolStore}: the atomic
 * tmp+rename write discipline, the tmp-name sequencing, and the fail-soft
 * JSON read exist exactly once.
 *
 * @module dsh-sidebar-vscode/openChannel
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CAPABILITY_MAX_AGE_MS,
  CAPABILITY_MIN_V,
  CHANNEL_FILES,
  NONCE_MAX_LENGTH,
  OPEN_CHANNEL_DIR,
  slugOf,
} from './shared/protocol.ts'

export { CAPABILITY_MAX_AGE_MS, CAPABILITY_MIN_V, slugOf }

/** The spool root (same base the extension derives from `os.tmpdir()`). */
export const OPEN_CHANNEL_BASE = join(tmpdir(), OPEN_CHANNEL_DIR)

/** One validated open command. */
export interface OpenCommandBody {
  folder: string
  path: string
  nonce: number
  line?: number
  column?: number
  /**
   * The boot nonce of the EMBEDDED workbench this open was minted for
   * (extension cap ≥ 4): the extension consumes a tagged command only on
   * the host that activated with the same nonce, so a lingering previous
   * host cannot eat it (see the extension's boot-tag gate).
   */
  boot?: string
}

/** Whether a path is absolute POSIX (the container is Linux — serve-web runs there). */
function isAbsolutePosix(path: string): boolean {
  return path.startsWith('/')
}

/**
 * Structurally validate one `open.request` payload. Returns null for
 * anything malformed — foreign shapes must never reach the filesystem.
 */
export function parseOpenCommand(payload: unknown): OpenCommandBody | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  if (typeof record.folder !== 'string' || !isAbsolutePosix(record.folder)) return null
  if (typeof record.path !== 'string' || !isAbsolutePosix(record.path)) return null
  if (typeof record.nonce !== 'number' || !Number.isFinite(record.nonce)) return null
  const out: OpenCommandBody = { folder: record.folder, path: record.path, nonce: record.nonce }
  if (typeof record.line === 'number' && Number.isFinite(record.line) && record.line > 0) {
    out.line = Math.floor(record.line)
  }
  if (typeof record.column === 'number' && Number.isFinite(record.column) && record.column > 0) {
    out.column = Math.floor(record.column)
  }
  if (typeof record.boot === 'string' && record.boot !== '') {
    out.boot = record.boot.slice(0, NONCE_MAX_LENGTH)
  }
  return out
}

/** Process-lifetime sequence for tmp names (same-millisecond writes collide otherwise). */
let tmpSequence = 0

/**
 * The per-folder JSON spool: one place for the atomic tmp+rename write and
 * the fail-soft read every channel file shares. A write is never observed
 * half-formed (the extension polls at any instant); a read of a missing or
 * corrupt file answers null instead of throwing, so every caller degrades
 * rather than breaks.
 */
export class SpoolStore {
  /** @param base - the spool root (usually {@link OPEN_CHANNEL_BASE}). */
  constructor(private readonly base: string) {}

  /** The folder's spool directory (created lazily by {@link write}). */
  private dirOf(folder: string): string {
    return join(this.base, slugOf(folder))
  }

  /** Atomically write one JSON document into the folder's spool. */
  async write(folder: string, file: string, document: unknown, now: () => number = Date.now): Promise<void> {
    const dir = this.dirOf(folder)
    await mkdir(dir, { recursive: true })
    const target = join(dir, file)
    const tmp = `${target}.tmp-${process.pid}-${tmpSequence++}-${now()}`
    await writeFile(tmp, JSON.stringify(document), 'utf8')
    await rename(tmp, target)
  }

  /** Read one JSON document; null when absent, unreadable, or corrupt. */
  async readJson(folder: string, file: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(join(this.dirOf(folder), file), 'utf8')) as unknown
    } catch {
      return null
    }
  }

  /** File facts for freshness checks; null when the file is absent. */
  async statFile(folder: string, file: string): Promise<{ mtimeMs: number } | null> {
    try {
      const info = await stat(join(this.dirOf(folder), file))
      return { mtimeMs: info.mtimeMs }
    } catch {
      return null
    }
  }
}

/**
 * Write one open command into the folder's spool (atomic tmp+rename, so the
 * extension never observes a partial JSON document).
 */
export async function writeOpenCommand(
  base: string,
  command: OpenCommandBody,
  now: () => number = Date.now,
): Promise<void> {
  await new SpoolStore(base).write(command.folder, CHANNEL_FILES.cmd, { ...command, ts: now() }, now)
}

/**
 * Stamp the embedded-boot marker for `folder`: the sidebar's client calls
 * the `open.embedded` route on every workbench iframe load, and the
 * extension reads the marker at activation to tell its EMBEDDED boots (a
 * fresh stamp) from standalone windows (no stamp) — only embedded boots
 * start with a clean editor area, because their iframe teardown skips
 * VS Code's unload lifecycle and its editor-state restore would otherwise
 * replay files the user closed seconds before closing the tab.
 */
export async function writeEmbeddedBoot(
  base: string,
  folder: string,
  now: () => number = Date.now,
): Promise<void> {
  await new SpoolStore(base).write(folder, CHANNEL_FILES.embed, { ts: now() }, now)
}

/**
 * Park one boot nonce in `bootreq.json` BEFORE the client mounts the
 * workbench iframe: the extension (≥ 0.1.2) reads it at activation and
 * echoes it back in its `boot.json` receipt after the editor reconcile,
 * so the client can tell THIS boot's receipt from a previous one without
 * trusting cross-process clocks. The nonce is client-generated randomness
 * (bounded here to a sane printable length); a failed write simply leaves
 * the previous nonce, which the fresh echo cannot match — the client's
 * reveal timeout covers it.
 */
export async function writeBootRequest(
  base: string,
  folder: string,
  nonce: string,
): Promise<void> {
  await new SpoolStore(base).write(folder, CHANNEL_FILES.bootreq, { nonce })
}

/**
 * Stamp one user interaction for a boot (`interact.json`, `{nonce, ts}`):
 * the client writes it when the REVEALED workbench sees its first user
 * gesture, and the extension's reconcile close loop and ghost passes read
 * it to stand down — the reveal racer can hand the user an interactive
 * workbench while the reconcile is still settling against a ledger that
 * predates their open, and a tab the user opened in that window must
 * never be closed as a restore ghost. The nonce scoping keeps a stale
 * stamp from disarming a later boot.
 */
export async function writeUserInteract(
  base: string,
  folder: string,
  nonce: string,
  now: () => number = Date.now,
): Promise<void> {
  await new SpoolStore(base).write(folder, CHANNEL_FILES.interact, { nonce, ts: now() }, now)
}

/**
 * Whether the extension's `boot.json` receipt for `folder` echoes exactly
 * this boot's nonce — i.e. the editor reconcile already ran for the
 * workbench the client is keeping invisible. Any missing file, parse
 * error, or nonce mismatch answers false (keep waiting; the client's
 * timeout reveals regardless).
 */
export async function readBootStatus(
  base: string,
  folder: string,
  nonce: string,
): Promise<boolean> {
  const parsed = await new SpoolStore(base).readJson(folder, CHANNEL_FILES.boot)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  return (parsed as { nonce?: unknown }).nonce === nonce
}

/**
 * The boot LEDGER (`editors.json`) as it stands at nonce-park time: the
 * open-editor set the extension's reconcile will diff the restored window
 * against (same file, same shape the extension's `readLedger` parses —
 * `v: 1` with an `editors` array of absolute POSIX paths). Answered
 * alongside `boot.begin`'s park so the CLIENT's DOM-quiet reveal racer can
 * tell "the strip is quiet because it is settled" from "the strip is
 * quiet-but-wrong while the reconcile's close is still in flight" — a
 * quiet-but-mismatched strip must keep the frame hidden. Null when absent
 * or malformed: a first-ever boot has no ledger (the reconcile then
 * touches nothing) and an unreadable one gates nothing.
 */
export async function readBootLedger(
  base: string,
  folder: string,
): Promise<string[] | null> {
  const parsed = await new SpoolStore(base).readJson(folder, CHANNEL_FILES.editors)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as { v?: unknown, editors?: unknown }
  if (record.v !== 1 || !Array.isArray(record.editors)) return null
  if (!record.editors.every(entry => typeof entry === 'string' && entry.startsWith('/'))) return null
  return record.editors as string[]
}

/**
 * Whether the extension serving `folder` is alive AND new enough to trust:
 * its capability marker must exist, be younger than
 * {@link CAPABILITY_MAX_AGE_MS}, and carry a build version of at least
 * {@link CAPABILITY_MIN_V} (the pre-0.1.2 extension wrote a bare timestamp
 * and replays consumed commands — it must not be handed any). Any
 * filesystem or parse error simply answers false (degrade, never throw).
 */
export async function readCapability(
  base: string,
  folder: string,
  maxAgeMs: number = CAPABILITY_MAX_AGE_MS,
  now: () => number = Date.now,
): Promise<boolean> {
  return (await readCapabilityMarker(base, folder, maxAgeMs, now)).present
}

/**
 * The capability probe's full answer: `present` (same contract as
 * {@link readCapability}) plus the marker's build `version` when present
 * (null otherwise) — the client tags open commands with the workbench's
 * boot nonce only from version 4 up (the boot-tag-aware build); an older
 * extension ignores the field, so tagging would be pointless there.
 */
export async function readCapabilityMarker(
  base: string,
  folder: string,
  maxAgeMs: number = CAPABILITY_MAX_AGE_MS,
  now: () => number = Date.now,
): Promise<{ present: boolean, version: number | null }> {
  const store = new SpoolStore(base)
  const info = await store.statFile(folder, CHANNEL_FILES.cap)
  if (info === null || now() - info.mtimeMs >= maxAgeMs) return { present: false, version: null }
  const parsed = await store.readJson(folder, CHANNEL_FILES.cap)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { present: false, version: null }
  }
  const version = (parsed as { v?: unknown }).v
  const ok = version === CAPABILITY_MIN_V || (typeof version === 'number' && version > CAPABILITY_MIN_V)
  if (!ok) return { present: false, version: null }
  return { present: true, version: typeof version === 'number' ? version : CAPABILITY_MIN_V }
}
