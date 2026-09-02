/**
 * The restore budget of the hidden-frame focus fence (VscodeView): how many
 * times focus may be handed back to the surface that held it, per sliding
 * window, before the fence gives up.
 *
 * Why a budget at all: the fence fights PROGRAMMATIC focus grabs made by
 * the embedded VS Code workbench while its tab cannot be seen (a hidden
 * iframe cannot receive user clicks, so every focus entry into it is a
 * steal). A workbench that re-grabs focus in a tight loop (a welcome page
 * re-focusing on every layout pass, an extension gone rogue) must not
 * turn the fence into an infinite focus ping-pong: after `max` restores
 * inside one `windowMs` window the fence stands down until the window
 * slides past — the user loses the caret for that burst, but the page
 * stays responsive instead of livelocking the focus chain.
 *
 * Pure bookkeeping on an injected clock so unit tests need no timers.
 *
 * @module dsh-sidebar-vscode/client/focusGuard
 */
/** Sliding-window restore budget. */
export declare class FocusRestoreBudget {
    readonly max: number;
    readonly windowMs: number;
    private windowStart;
    private used;
    /**
     * @param max - restores allowed per window before standing down.
     * @param windowMs - window length in milliseconds.
     */
    constructor(max?: number, windowMs?: number);
    /**
     * Try to spend one restore at the given time. The window slides: the
     * first `take` at or after `windowMs` from the window's start re-arms
     * the budget.
     * @param now - the current clock reading (ms).
     * @returns whether the restore may proceed.
     */
    take(now: number): boolean;
}
