/**
 * The navigation consumer: the one-shot execution discipline for the
 * `openTab('vscode', { params })` navigations the takeover wrapper mints
 * — extracted from the VscodeView effect so the whole revision-baseline
 * machinery is a unit-testable object.
 *
 * The official right Sidebar delivers an open to a tab's body as
 * `tab.navigation`: `{ address, params, revision }`, where `revision`
 * increments on EVERY navigation to the tab (params unchanged or not)
 * and starts at 1 for a tab somebody opened by address/kind. That
 * monotonic counter IS the one-shot command vehicle the
 * better-sidebar-era `openRequest` meta + nonce had to build by hand —
 * with two of its hazards gone by construction:
 *
 * - nothing persists: the navigation lives in the in-memory layout, so
 *   no page-load floor and no retire/strip step (a reload cannot replay
 *   a spent click);
 * - the tab is session-scoped and the wrapper opens the MOUNTED
 *   session's tab, so no cross-session addressing guard is needed.
 *
 * What remains is exactly the discipline the view needs:
 *
 * - revision 0 (a seeded guide, an undo-restored record) is nobody's
 *   click — never acted on;
 * - a PAGE-LEVEL watermark (`${sessionId}:${tabId}` → the highest
 *   revision any consumer of this page executed) lets a remount — the
 *   official pane renders only the active tab's body, so switching tabs
 *   away and back remounts the workbench — skip the navigation it
 *   already executed, while the mount-batch click (the navigation that
 *   created the tab, revision 1 of a fresh record, no watermark entry)
 *   still runs;
 * - while the frame's boot gate is unsettled (its nonce not parked yet),
 *   a fresh navigation DEFERS: the click that re-creates the tab lands
 *   in the very render that mounts the iframe, and its open command must
 *   be able to carry the boot nonce (which parks only milliseconds
 *   later). Nothing is advanced while deferring, so the navigation still
 *   executes once the gate settles.
 *
 * @module dsh-sidebar-vscode/client/openRequests
 */

/** One workbench open command, fully resolved (the execute-time shape). */
export interface OpenRequest {
  /** The DSH-side absolute path to open. */
  path: string
  /**
   * The extension command id (the spool's monotonic sequence), minted at
   * execution time — one id per executed navigation.
   */
  nonce: number
  /** Optional 1-based cursor position. */
  line?: number
  column?: number
}

/**
 * One navigation stamp as the view reads it off `tab.navigation`
 * (structural subset of the official `SidebarRightTabNavigation`).
 */
export interface NavigationStamp {
  readonly revision: number
  readonly params: unknown
}

/**
 * Read the open command one navigation's `params` carries. Structural and
 * throw-free: a malformed or absent params object (another plugin's
 * navigation, a hand-built record) yields null and the consumer stands
 * down for it — but the revision is still consumed as seen, so a later
 * well-formed navigation is not blocked by an earlier malformed one.
 */
export function readNavigationOpen(params: unknown): { path: string, line?: number, column?: number } | null {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return null
  const record = params as { path?: unknown, line?: unknown, column?: unknown }
  if (typeof record.path !== 'string' || record.path === '') return null
  const out: { path: string, line?: number, column?: number } = { path: record.path }
  if (typeof record.line === 'number' && Number.isFinite(record.line) && record.line > 0) {
    out.line = Math.floor(record.line)
  }
  if (typeof record.column === 'number' && Number.isFinite(record.column) && record.column > 0) {
    out.column = Math.floor(record.column)
  }
  return out
}

/** The last minted command nonce (module state — one monotonic sequence per page). */
let lastNonce = 0

/**
 * Mint the next command nonce: wall-clock based so sequences survive
 * reloads, but strictly monotonic within a page (two clicks in the same
 * millisecond must still produce increasing values, or the second would
 * be swallowed by the extension spool).
 */
export function nextNonce(now: () => number = Date.now): number {
  const current = now()
  lastNonce = current > lastNonce ? current : lastNonce + 1
  return lastNonce
}

/**
 * The highest navigation revision any consumer of this page has executed,
 * keyed by `${sessionId}:${tabId}`. Module level on purpose: it survives
 * tab close/reopen and tab-switch remounts (the official pane unmounts
 * inactive bodies) and resets only on reload — which also resets the
 * in-memory layout that holds the navigations.
 */
const executedWatermark = new Map<string, number>()

/** Test-only: drop the page watermark (each spec starts cold). */
export function resetExecutedWatermark(): void {
  executedWatermark.clear()
}

/** The injected seams (tests substitute fakes). */
export interface OpenRequestConsumerDeps {
  /** Execute one fresh navigation (the workbench open). */
  execute(request: OpenRequest): Promise<void> | void
  /** Whether the boot gate settled (deferred navigations wait for true). */
  gateSettled(): boolean
}

/**
 * One consumer per mounted VscodeView. Feed it the tab's live navigation
 * and the consuming session/tab identity on every relevant change; it
 * owns the instance baseline and the page watermark, and decides
 * defer / execute / skip exactly once per revision.
 */
export class OpenRequestConsumer {
  private initialized = false
  private lastRevision = 0

  constructor(private readonly deps: OpenRequestConsumerDeps) {}

  /**
   * Consider the tab's current navigation for the session whose tab
   * mounted this consumer. Call on every navigation/gate change;
   * repeated calls with the same revision are idempotent.
   */
  update(navigation: NavigationStamp | undefined, sessionId: string | undefined, tabId: string | undefined): void {
    const revision = navigation?.revision ?? 0
    if (!this.initialized) {
      this.initialized = true
      // A remount (tab switch back, close/reopen): the navigation this
      // page already executed answers at or below the watermark — mark it
      // seen and stand down. The mount-batch click (a fresh record's
      // revision 1, no watermark entry) falls through and runs.
      this.lastRevision = Math.max(readWatermark(sessionId, tabId), 0)
    }
    if (revision <= 0) return
    if (revision <= this.lastRevision) return
    // Defer while the frame's boot nonce is not parked yet: the click
    // that re-creates the tab lands in the very render that mounts the
    // iframe, and its open command must carry the boot nonce — which
    // parks only milliseconds later. The caller re-feeds us when the
    // gate settles; nothing is advanced here.
    if (!this.deps.gateSettled()) return
    this.lastRevision = revision
    writeWatermark(sessionId, tabId, revision)
    const open = readNavigationOpen(navigation?.params)
    if (open === null) return
    void Promise.resolve(this.deps.execute({ ...open, nonce: nextNonce() })).catch(() => {
      // The open paths are fail-soft by design; an execution error must
      // not surface as an unhandled rejection on top.
    })
  }
}

/** The watermark of one tab (0 when this page never executed for it). */
function readWatermark(sessionId: string | undefined, tabId: string | undefined): number {
  const key = watermarkKey(sessionId, tabId)
  return key === undefined ? Number.NEGATIVE_INFINITY : executedWatermark.get(key) ?? 0
}

/** Record the watermark of one tab (best-effort; unknown identity skips). */
function writeWatermark(sessionId: string | undefined, tabId: string | undefined, revision: number): void {
  const key = watermarkKey(sessionId, tabId)
  if (key === undefined) return
  executedWatermark.set(key, revision)
}

function watermarkKey(sessionId: string | undefined, tabId: string | undefined): string | undefined {
  if (sessionId === undefined || sessionId === '') return undefined
  return `${sessionId}:${tabId ?? ''}`
}
