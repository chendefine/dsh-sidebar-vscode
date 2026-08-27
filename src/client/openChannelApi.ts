/**
 * Client half of the extension command channel: the two same-origin fetches
 * the VSCode tab makes against THIS plugin's node-half routes
 * (`/sidebar-vscode/api/*`) to (a) probe whether the upgraded
 * `dsh.selection-reference` extension is alive in the embedded workbench and
 * (b) hand it one file-open command.
 *
 * The routes are fence-protected by the node half (same-origin GUI only),
 * same trust model as better-sidebar's `/sidebar/api`. Both helpers are
 * fail-soft: any error answers `false` / `undefined`, and the VscodeView
 * falls back to the URL-payload channel — a missing route (older host half
 * not reloaded yet) or a missing extension must degrade, never break.
 *
 * @module dsh-sidebar-vscode/client/openChannelApi
 */

/** The base path of this plugin's node-half routes. */
export const OPEN_CHANNEL_API = '/sidebar-vscode/api'

/** Structural face of fetch the helpers need (injectable for tests). */
export interface FetchLike {
  (url: string, init: {
    method: string
    headers: { 'content-type': string }
    body: string
  }): Promise<{ ok: boolean, json(): Promise<unknown> }>
}

/** The default fetch binding (the browser's global). */
const defaultFetch: FetchLike = (url, init) => fetch(url, init)

/** One open command addressed to the extension serving `folder`. */
export interface OpenCommand {
  folder: string
  path: string
  nonce: number
  line?: number
  column?: number
}

/** POST one JSON body and answer `{ok, value}` structurally; null on any failure. */
async function postJson(
  method: string,
  body: Record<string, unknown>,
  fetchLike: FetchLike,
): Promise<{ ok: boolean, value: unknown } | null> {
  try {
    const response = await fetchLike(`${OPEN_CHANNEL_API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const parsed = await response.json().catch(() => null)
    if (!response.ok || parsed === null || typeof parsed !== 'object') return null
    const record = parsed as { ok?: unknown, value?: unknown }
    if (record.ok !== true) return null
    return { ok: true, value: record.value }
  } catch {
    return null
  }
}

/**
 * Whether the extension serving `folder` is alive: its capability marker
 * file must exist and be fresh (the extension refreshes it every poll tick;
 * the node half enforces the age window). Results are cached per folder for
 * a short TTL so a burst of clicks does not hammer the probe.
 */
const CAPABILITY_TTL_MS = 5000
let capabilityCache: { folder: string, at: number, present: boolean } | null = null

export async function probeCapability(
  folder: string,
  fetchLike: FetchLike = defaultFetch,
  now: () => number = Date.now,
): Promise<boolean> {
  if (
    capabilityCache !== null
    && capabilityCache.folder === folder
    && now() - capabilityCache.at < CAPABILITY_TTL_MS
  ) {
    return capabilityCache.present
  }
  const parsed = await postJson('open.capability', { folder }, fetchLike)
  const present = parsed !== null
    && parsed.value !== null
    && typeof parsed.value === 'object'
    && (parsed.value as { present?: unknown }).present === true
  capabilityCache = { folder, at: now(), present }
  return present
}

/** Test-only: drop the capability cache (each spec starts cold). */
export function resetCapabilityCache(): void {
  capabilityCache = null
}

/**
 * Hand one open command to the extension through the node half. Answers
 * whether the command was accepted (written to the spool the extension
 * polls) — delivery itself is asynchronous by design (the extension polls).
 */
export async function sendOpenCommand(
  command: OpenCommand,
  fetchLike: FetchLike = defaultFetch,
): Promise<boolean> {
  const parsed = await postJson('open.request', command as unknown as Record<string, unknown>, fetchLike)
  return parsed !== null
}
