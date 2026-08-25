/**
 * The "sidebar opens VSCode by default" behavior (`openAsDefault`, the
 * switch at the top of this tab's 功能设置 panel).
 *
 * better-sidebar hardcodes every brand-new session's seed: ONE empty
 * 'Files' editor tab (upstream `state.ts` `makeDefaultState`'s
 * 'editor-home' — there is no preference for the seeded tab type). This
 * module is the plugin-side companion the upstream service suggests for
 * exactly that gap: watch the sidebar store, and while the switch is on
 * and the active session still carries its pristine seed, swap that seed
 * for THIS plugin's tab —
 *
 *   service.openTab({ type: TAB_ID })   lands the VSCode tab in the active
 *                                       pane and makes it the pane's
 *                                       active tab (a type-only open never
 *                                       forces the panel open, so a
 *                                       collapsed sidebar stays collapsed:
 *                                       the tab is simply what the user
 *                                       sees on the next expansion);
 *   service.closeTab(<seed id>)         removes the seeded 'Files' tab so
 *                                       the swap is a replacement, not an
 *                                       addition.
 *
 * Safety rails:
 * - PRISTINE GATE: the swap only runs on an untouched seed state (single
 *   pane, at most the one path-less editor tab, no minted counters, no
 *   expansions, no bottom tabs, no floats). Any user or agent activity
 *   makes the state non-pristine and the session keeps its own layout —
 *   the same contract as better-sidebar's own `openByDefault` pref
 *   ("已存在的会话保持各自布局").
 * - ONCE MARKER: `dsh-sidebar-vscode:v1:default-tab:<sessionId>` in
 *   localStorage records that a session already received the swap.
 *   Without it, closing the VSCode tab of a fresh session would leave an
 *   empty pristine-looking seed and the next store notification would
 *   re-open it — the user could never close the tab. The marker also
 *   makes plugin reload / HMR re-apply idempotent.
 * - ENABLE GATE: a disabled tab type never swaps (the seed must not be
 *   removed to make room for a tab that cannot open), and a refused open
 *   (the tab never landed) never closes the seed either.
 *
 * @module dsh-sidebar-vscode/client/defaultTab
 */

import { TAB_ID, readSettingValue } from './settings.ts'

/** The pluginSettings key of the "sidebar opens VSCode by default" switch. */
export const OPEN_AS_DEFAULT_KEY = 'openAsDefault'

/** localStorage marker prefix: one swap per session, ever (best-effort). */
const MARKER_PREFIX = 'dsh-sidebar-vscode:v1:default-tab'

/** The tab shape the pristine walk needs. */
interface TabShape {
  id: string
  type: string
  title?: string
  path?: string
}

/** The split-tree shape the pristine walk needs (leaf | split). */
type SplitShape =
  | { kind: 'leaf'; id?: string; tabs: TabShape[]; active?: string | null }
  | { kind: 'split'; children: SplitShape[] }

/**
 * The sidebar-state slice {@link isPristineSeed} inspects. Structural on
 * purpose: the real `SidebarState` (not re-exported through the
 * better-sidebar root types) is assignable to it, and unit tests can
 * hand-build literals without the peer's internals.
 */
export interface DefaultTabStateShape {
  nextTerminal: number
  nextBrowser: number
  expanded: string[]
  bottomOpenedOnce: boolean
  splits: SplitShape
  bottomSplits: SplitShape
  floats: unknown[]
}

/**
 * The service slice this module needs — structural over the real
 * `ctx.betterSidebar` (`BetterSidebarService`) so the client body and the
 * settings panel share one face without importing peer internals.
 */
export interface DefaultTabServiceFace {
  getSnapshot(): {
    sessionId: string | undefined
    state?: DefaultTabStateShape
    prefs: { pluginSettings: Record<string, Record<string, unknown>> }
  }
  subscribeState(listener: () => void): () => void
  isTabEnabled(id: string): boolean
  openTab(seed: { type: string }): void
  closeTab(tabId: string): void
}

/** Depth-first tabs of a split tree. */
function tabsOf(node: SplitShape): TabShape[] {
  return node.kind === 'leaf' ? node.tabs : node.children.flatMap(tabsOf)
}

/** Whether a tab is better-sidebar's hardcoded seed (the path-less Files window). */
function isEditorHomeSeed(tab: TabShape): boolean {
  return tab.type === 'editor' && tab.path === undefined
}

/**
 * Whether the state is an UNTOUCHED fresh-session seed: one pane holding
 * at most the one path-less 'Files' editor tab, and no counter bump
 * anywhere (a minted terminal/browser id, an expanded directory, a
 * bottom-panel tab, a bottom-panel expansion, or a float each prove the
 * session was already used).
 */
export function isPristineSeed(state: DefaultTabStateShape): boolean {
  if (state.floats.length > 0) return false
  if (state.bottomOpenedOnce) return false
  if (state.nextTerminal !== 1 || state.nextBrowser !== 1) return false
  if (state.expanded.length > 0) return false
  if (tabsOf(state.bottomSplits).length > 0) return false
  if (state.splits.kind !== 'leaf') return false
  const tabs = state.splits.tabs
  if (tabs.length === 0) return true
  return tabs.length === 1 && isEditorHomeSeed(tabs[0]!)
}

/**
 * The seed tab id a pristine state carries (undefined when the seed was
 * empty — the editor tab type disabled, or every tab already closed).
 * Only meaningful on a state {@link isPristineSeed} already accepted.
 */
export function seedTabIdOf(state: DefaultTabStateShape): string | undefined {
  if (state.splits.kind !== 'leaf') return undefined
  const first = state.splits.tabs[0]
  return first !== undefined && isEditorHomeSeed(first) ? first.id : undefined
}

/** Whether this session already received its swap (best-effort storage). */
function wasMarked(sessionId: string): boolean {
  try {
    return localStorage.getItem(`${MARKER_PREFIX}:${sessionId}`) !== null
  } catch {
    return false
  }
}

/** Record the swap for this session (best-effort; storage may be absent). */
function markSession(sessionId: string): void {
  try {
    localStorage.setItem(`${MARKER_PREFIX}:${sessionId}`, '1')
  } catch {
    // Storage full or unavailable: in-memory idempotence still holds for
    // this page load (the swap itself makes the state non-pristine).
  }
}

/**
 * Swap the active session's pristine seed for this plugin's tab: gates on
 * the marker / pristine shape / tab enablement, then opens the VSCode tab
 * and removes the seeded Files tab — but only when the open really landed
 * (a refused open must never cost the sidebar its seed).
 * @returns whether the swap ran.
 */
export function applyDefaultTab(service: DefaultTabServiceFace): boolean {
  const snapshot = service.getSnapshot()
  const sessionId = snapshot.sessionId
  const state = snapshot.state
  if (sessionId === undefined || state === undefined) return false
  if (wasMarked(sessionId)) return false
  if (!isPristineSeed(state)) return false
  if (!service.isTabEnabled(TAB_ID)) return false
  // Mark BEFORE mutating: the open/close below notifies the store, and the
  // re-entrant notification must find the marker (or the now non-pristine
  // state) instead of scheduling another swap.
  markSession(sessionId)
  service.openTab({ type: TAB_ID })
  const seedTabId = seedTabIdOf(state)
  if (seedTabId === undefined) return true
  // The landed check re-reads the live snapshot: a refused or failed open
  // (disabled type, missing descriptor) leaves the seed in place.
  const after = service.getSnapshot().state
  const landed = after !== undefined
    && tabsOf(after.splits).concat(tabsOf(after.bottomSplits)).some(tab => tab.type === TAB_ID)
  if (landed) service.closeTab(seedTabId)
  return true
}

/**
 * Watch the sidebar store for the default-tab swap. Evaluates once at
 * startup (a session may already be active and pristine) and on every
 * store notification — session switches, state changes, and prefs writes.
 * The prefs path matters twice: the settings document resolves AFTER the
 * store's defaults at boot, and the switch's own write re-triggers this
 * evaluation, so flipping it on applies to a still-pristine active
 * session without any extra plumbing (used sessions keep their layouts).
 * @returns the disposer.
 */
export function watchDefaultTab(service: DefaultTabServiceFace): () => void {
  const evaluate = (): void => {
    if (readSettingValue(service, OPEN_AS_DEFAULT_KEY) !== true) return
    applyDefaultTab(service)
  }
  evaluate()
  return service.subscribeState(evaluate)
}
