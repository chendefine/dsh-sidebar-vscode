/**
 * Host half of the extension command channel: the /tmp spool the embedded
 * workbench's `dsh.selection-reference` extension (≥ 0.1.1) polls.
 *
 * Layout: `<tmpdir>/dsh-sidebar-vscode/<slug(workspace folder)>/{cap,cmd,editors,bootreq,boot}.json`
 * — one directory per workspace folder, addressed by a filesystem-safe slug
 * BOTH sides derive from the folder path they independently know (the client
 * sends the mapped folder; the extension derives it from its own
 * `workspaceFolders[0]`). `/tmp` is shared by the default same-container
 * topology (serve-web runs beside dsh-runtime — see the plugin README's
 * deployment section); a split deployment simply fails the capability probe
 * and the client falls back to the URL-payload channel.
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
 * The slug spec is pinned by `tests/openChannel.spec.ts`; the extension's
 * plain-JS mirror (extension/extension.js `slugOf`) must stay in lockstep.
 *
 * @module dsh-sidebar-vscode/openChannel
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The spool root (same base the extension derives from `os.tmpdir()`). */
export const OPEN_CHANNEL_BASE = join(tmpdir(), 'dsh-sidebar-vscode')

/** How old the capability marker may be before "present" turns false. */
export const CAPABILITY_MAX_AGE_MS = 120_000

/**
 * The minimum extension build the command channel trusts. The v0.1.1
 * extension CONSUMED commands but never deleted `cmd.json` and persisted no
 * nonce watermark — every workbench reboot (the sidebar tab's iframe
 * teardown/recreate) re-delivered the last opened file, which is exactly
 * the "closed file reopens on next VS Code start" bug. v0.1.2 (CHANNEL_CAP_V
 * in extension/extension.js) deletes consumed commands, skips stale ones,
 * and writes a versioned cap marker; `readCapability` parses that marker,
 * so a deployment still carrying the old build degrades to the URL-payload
 * channel instead of replaying files.
 */
export const CAPABILITY_MIN_V = 2

/**
 * Filesystem-safe slug of one workspace folder: non [A-Za-z0-9_-] characters
 * collapse to '_', capped at 64, plus a djb2-xor hex digest of the ORIGINAL
 * string so distinct folders sharing a collapsed form cannot collide.
 * Mirrored in extension/extension.js — keep both in lockstep (spec test).
 */
export function slugOf(folder: string): string {
  const clean = folder.trim()
  const safe = clean.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  let digest = 5381
  for (let at = 0; at < clean.length; at += 1) {
    digest = ((digest * 33) ^ clean.charCodeAt(at)) >>> 0
  }
  return `${safe}-${digest.toString(16)}`
}

/** One validated open command. */
export interface OpenCommandBody {
  folder: string
  path: string
  nonce: number
  line?: number
  column?: number
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
  return out
}

/** Process-lifetime sequence for tmp names (same-millisecond writes collide otherwise). */
let tmpSequence = 0

/**
 * Write one open command into the folder's spool (atomic tmp+rename, so the
 * extension never observes a partial JSON document).
 */
export async function writeOpenCommand(
  base: string,
  command: OpenCommandBody,
  now: () => number = Date.now,
): Promise<void> {
  const dir = join(base, slugOf(command.folder))
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'cmd.json')
  const tmp = `${file}.tmp-${process.pid}-${tmpSequence++}-${now()}`
  const document = JSON.stringify({ ...command, ts: now() })
  await writeFile(tmp, document, 'utf8')
  await rename(tmp, file)
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
  const dir = join(base, slugOf(folder))
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'embed.json')
  const tmp = `${file}.tmp-${process.pid}-${tmpSequence++}-${now()}`
  await writeFile(tmp, JSON.stringify({ ts: now() }), 'utf8')
  await rename(tmp, file)
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
  const dir = join(base, slugOf(folder))
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'bootreq.json')
  const tmp = `${file}.tmp-${process.pid}-${tmpSequence++}-${Date.now()}`
  await writeFile(tmp, JSON.stringify({ nonce }), 'utf8')
  await rename(tmp, file)
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
  try {
    const raw = await readFile(join(base, slugOf(folder), 'boot.json'), 'utf8')
    const parsed = JSON.parse(raw) as { nonce?: unknown }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    return parsed.nonce === nonce
  } catch {
    return false
  }
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
  try {
    const capFile = join(base, slugOf(folder), 'cap.json')
    const info = await stat(capFile)
    if (now() - info.mtimeMs >= maxAgeMs) return false
    const raw = await readFile(capFile, 'utf8')
    let parsed: { v?: unknown } | null = null
    try {
      parsed = JSON.parse(raw) as { v?: unknown }
    } catch {
      return false
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    return parsed.v === CAPABILITY_MIN_V || (typeof parsed.v === 'number' && parsed.v > CAPABILITY_MIN_V)
  } catch {
    return false
  }
}
