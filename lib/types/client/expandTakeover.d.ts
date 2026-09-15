/**
 * The expand-button takeover of the OFFICIAL right Sidebar: one capture-phase
 * document listener that turns the collapsed column's expand control into a
 * direct workbench reveal, behind the same `openAsDefault` switch as the
 * chat-open and settings-page takeovers.
 *
 * Why a DOM seam: the expand control (`ExpandButton.tsx` of
 * `@deepseek-ai/dsh-client-ui-sidebar-right`) lives in the conversation
 * header's corner seat and acts on the per-session store it shares with the
 * panel — `actions.setExpanded(sessionId, true)` — a store the slot runtime
 * mints per session and no public service exposes. The controller's own
 * `toggleExpanded` is not the button's path either. The ONE externally
 * observable, stable marker of that control is its dedicated attribute
 * (`data-sidebar-right-expand`, spelled on nothing else), so the takeover
 * captures clicks that bubble from it at the document's capture phase —
 * before the React root's bubble-phase handler — and re-issues the gesture
 * as `sidebarRight.openTab('vscode')`:
 *
 * - `openTab` reveals or creates the session's ONE workbench page tab
 *   (the registry deduplicates pages by kind) and expands the column in
 *   the same step — the official "content the user cannot see is not
 *   opened" rule — so the stock `setExpanded(true)` the button would have
 *   run is subsumed, and the click is consumed (stopPropagation +
 *   preventDefault) only AFTER the workbench open succeeded;
 * - a declined click (switch off) reaches the stock handler untouched and
 *   the column expands to whatever it last showed (the seeded guide on a
 *   fresh surface — with several registered guide entries the official
 *   seed rule resolves to the guide, never to this plugin's page);
 * - a failed open (no mounted seat, a thrown `openTab`) lets the stock
 *   expand proceed — a plain expand beats a dead button.
 *
 * The listener is installed for the plugin's lifetime and removed on
 * dispose (HMR-safe); everything time-varying (the switch) is read per
 * click, so flipping the setting applies to the very next press.
 *
 * @module dsh-sidebar-vscode/client/expandTakeover
 */
/** The official expand control's stable marker (spelled on nothing else). */
export declare const EXPAND_BUTTON_SELECTOR = "[data-sidebar-right-expand]";
/** The event-target face the claim needs (structural over `EventTarget`). */
export interface ClaimTarget {
    closest(selector: string): Element | null;
}
/** Per-click decisions the takeover needs (wired to the switch + service). */
export interface ExpandTakeoverDeps {
    /** Whether to take over THIS click: the `openAsDefault` switch, read live. */
    takeoverEnabled(): boolean;
    /**
     * Reveal the workbench tab (and with it the column):
     * `sidebarRight.openTab('vscode')`. A throw means the open was refused —
     * the click falls through to the stock expand.
     */
    openWorkbench(): void;
}
/** The event face the claim reads (structural over `Event`). */
export interface ClaimEvent {
    readonly target: unknown;
    stopPropagation(): void;
    preventDefault(): void;
}
/**
 * Whether one event target lives inside the official expand control.
 * @param target - the event's target (any node; non-element targets match
 * nothing).
 * @param selector - the expand control's selector.
 * @returns whether the click belongs to the expand control.
 */
export declare function isExpandControlClick(target: unknown, selector?: string): boolean;
/**
 * Consider one capture-phase click for the workbench takeover.
 *
 * Pure decision + act: claims nothing while the switch is off or the click
 * is not the expand control's; otherwise opens the workbench and, only once
 * that succeeded, consumes the click so the stock expand handler never
 * runs. An `openWorkbench` throw is swallowed here on purpose — the stock
 * expand is the correct fallback and must still receive the event.
 *
 * @param event - the capture-phase click event.
 * @param deps - per-click takeover decisions.
 * @param selector - the expand control's selector.
 * @returns whether the click was claimed (opened + consumed).
 */
export declare function claimExpandClick(event: ClaimEvent, deps: ExpandTakeoverDeps, selector?: string): boolean;
/** The add/remove-listener face the installer needs (structural document). */
export interface ListenerTarget {
    addEventListener(type: string, listener: (event: ClaimEvent) => void, options: {
        capture: boolean;
    }): void;
    removeEventListener(type: string, listener: (event: ClaimEvent) => void, options: {
        capture: boolean;
    }): void;
}
/**
 * Install the expand-button takeover on one document-like target.
 *
 * Fail-soft: an environment with no `document` (SSR, tests) installs
 * nothing. The listener rides the CAPTURE phase so it decides before any
 * bubble-phase React handler; removal restores nothing else (the listener
 * is wholly ours).
 *
 * @param deps - per-click takeover decisions (the shared gate + the
 * workbench open).
 * @param target - the listener target (the page document by default).
 * @param selector - the expand control's selector.
 * @returns the disposer removing the listener (HMR-safe, idempotent).
 */
export declare function installExpandTakeover(deps: ExpandTakeoverDeps, target?: ListenerTarget | undefined, selector?: string): () => void;
