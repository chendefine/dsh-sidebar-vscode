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
export async function postJson(
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

/**
 * Park one boot nonce with the node half BEFORE the workbench iframe
 * mounts (see `boot.begin`): the extension (≥ 0.1.2) echoes it in its
 * post-reconcile `boot.json` receipt, and {@link pollBootStatus} reports
 * the match — together they let the VscodeView keep the iframe invisible
 * until the editor area is reconciled, so a ghost file restored by VS
 * Code's own state never visibly opens just to be closed again.
 *
 * Fail-soft like every helper here: a missing route (an older host half
 * not reloaded yet) answers false and the caller skips the gating — the
 * workbench boots visible with stock behavior.
 */
export async function beginBoot(
  folder: string,
  nonce: string,
  fetchLike: FetchLike = defaultFetch,
): Promise<boolean> {
  const parsed = await postJson('boot.begin', { folder, nonce }, fetchLike)
  return parsed !== null
}

/**
 * Whether the extension's boot receipt for `folder` echoes THIS boot's
 * nonce — i.e. the editor reconcile finished for the workbench the caller
 * is keeping invisible. Answers false on any mismatch/absence/transport
 * error: keep waiting, the caller's timeout reveals regardless.
 */
export async function pollBootStatus(
  folder: string,
  nonce: string,
  fetchLike: FetchLike = defaultFetch,
): Promise<boolean> {
  const parsed = await postJson('boot.status', { folder, nonce }, fetchLike)
  return parsed !== null
    && (parsed.value as { matched?: unknown } | null)?.matched === true
}

/**
 * Locate the settings provider's local document through this plugin's node
 * half (`settings.document`, same fenced route family as the open channel).
 * The stock `/api/settings.openDocument` deliberately never reveals the
 * Host path to the browser — this plugin's own route does, so the settings
 * button takeover can hand the file to the embedded VS Code instead of the
 * Host OS opener (which dies with `xdg-open ENOENT` on headless containers).
 *
 * Fail-soft like every helper here: an absent settings provider, a provider
 * without a local document, an older node half (route not reloaded yet), or
 * any transport error answers null and the caller falls back to the stock
 * open behavior.
 */
export async function fetchSettingsDocumentPath(
  fetchLike: FetchLike = defaultFetch,
): Promise<string | null> {
  const parsed = await postJson('settings.document', {}, fetchLike)
  if (parsed === null) return null
  const path = (parsed.value as { path?: unknown } | null)?.path
  return typeof path === 'string' && path !== '' ? path : null
}
