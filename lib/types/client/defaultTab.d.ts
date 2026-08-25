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
/** The pluginSettings key of the "sidebar opens VSCode by default" switch. */
export declare const OPEN_AS_DEFAULT_KEY = "openAsDefault";
/** The tab shape the pristine walk needs. */
interface TabShape {
    id: string;
    type: string;
    title?: string;
    path?: string;
}
/** The split-tree shape the pristine walk needs (leaf | split). */
type SplitShape = {
    kind: 'leaf';
    id?: string;
    tabs: TabShape[];
    active?: string | null;
} | {
    kind: 'split';
    children: SplitShape[];
};
/**
 * The sidebar-state slice {@link isPristineSeed} inspects. Structural on
 * purpose: the real `SidebarState` (not re-exported through the
 * better-sidebar root types) is assignable to it, and unit tests can
 * hand-build literals without the peer's internals.
 */
export interface DefaultTabStateShape {
    nextTerminal: number;
    nextBrowser: number;
    expanded: string[];
    bottomOpenedOnce: boolean;
    splits: SplitShape;
    bottomSplits: SplitShape;
    floats: unknown[];
}
/**
 * The service slice this module needs — structural over the real
 * `ctx.betterSidebar` (`BetterSidebarService`) so the client body and the
 * settings panel share one face without importing peer internals.
 */
export interface DefaultTabServiceFace {
    getSnapshot(): {
        sessionId: string | undefined;
        state?: DefaultTabStateShape;
        prefs: {
            pluginSettings: Record<string, Record<string, unknown>>;
        };
    };
    subscribeState(listener: () => void): () => void;
    isTabEnabled(id: string): boolean;
    openTab(seed: {
        type: string;
    }): void;
    closeTab(tabId: string): void;
}
/**
 * Whether the state is an UNTOUCHED fresh-session seed: one pane holding
 * at most the one path-less 'Files' editor tab, and no counter bump
 * anywhere (a minted terminal/browser id, an expanded directory, a
 * bottom-panel tab, a bottom-panel expansion, or a float each prove the
 * session was already used).
 */
export declare function isPristineSeed(state: DefaultTabStateShape): boolean;
/**
 * The seed tab id a pristine state carries (undefined when the seed was
 * empty — the editor tab type disabled, or every tab already closed).
 * Only meaningful on a state {@link isPristineSeed} already accepted.
 */
export declare function seedTabIdOf(state: DefaultTabStateShape): string | undefined;
/**
 * Swap the active session's pristine seed for this plugin's tab: gates on
 * the marker / pristine shape / tab enablement, then opens the VSCode tab
 * and removes the seeded Files tab — but only when the open really landed
 * (a refused open must never cost the sidebar its seed).
 * @returns whether the swap ran.
 */
export declare function applyDefaultTab(service: DefaultTabServiceFace): boolean;
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
export declare function watchDefaultTab(service: DefaultTabServiceFace): () => void;
export {};
