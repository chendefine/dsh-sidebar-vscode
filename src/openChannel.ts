/**
 * Host half of the extension command channel: the /tmp spool the embedded
 * workbench's `dsh.selection-reference` extension (≥ 0.1.1) polls.
 *
 * Layout: `<tmpdir>/dsh-sidebar-vscode/<slug(workspace folder)>/{cap,cmd}.json`
 * — one directory per workspace folder, addressed by a filesystem-safe slug
 * BOTH sides derive from the folder path they independently know (the client
 * sends the mapped folder; the extension derives it from its own
 * `workspaceFolders[0]`). `/tmp` is shared by the default same-container
 * topology (serve-web runs beside dsh-runtime — see the plugin README's
 * deployment section); a split deployment simply fails the capability probe
 * and the client falls back to the URL-payload channel.
 *
 * - `cap.json` — the extension's liveness marker, refreshed on its poll
 *   tick; the route only reports it fresh within a window, so a dead
 *   extension stops being "capable" within seconds.
 * - `cmd.json` — the last open command (atomic tmp+rename write; the
 *   extension consumes it by monotonic nonce, so a lost read never replays
 *   and a stale file never re-opens).
 *
 * The slug spec is pinned by `tests/openChannel.spec.ts`; the extension's
 * plain-JS mirror (extension/extension.js `slugOf`) must stay in lockstep.
 *
 * @module dsh-sidebar-vscode/openChannel
 */
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The spool root (same base the extension derives from `os.tmpdir()`). */
export const OPEN_CHANNEL_BASE = join(tmpdir(), 'dsh-sidebar-vscode')

/** How old the capability marker may be before "present" turns false. */
export const CAPABILITY_MAX_AGE_MS = 120_000

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
  const tmp = `${file}.tmp-${process.pid}-${now()}`
  const document = JSON.stringify({ ...command, ts: now() })
  await writeFile(tmp, document, 'utf8')
  await rename(tmp, file)
}

/**
 * Whether the extension serving `folder` is alive: its capability marker
 * must exist and be younger than {@link CAPABILITY_MAX_AGE_MS}. Any
 * filesystem error simply answers false (degrade, never throw).
 */
export async function readCapability(
  base: string,
  folder: string,
  maxAgeMs: number = CAPABILITY_MAX_AGE_MS,
  now: () => number = Date.now,
): Promise<boolean> {
  try {
    const info = await stat(join(base, slugOf(folder), 'cap.json'))
    return now() - info.mtimeMs < maxAgeMs
  } catch {
    return false
  }
}
