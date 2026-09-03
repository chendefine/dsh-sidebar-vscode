/**
 * The focus fence of the embedded workbench (VscodeView): pure decision
 * logic plus the restore budget.
 *
 * Why a fence at all: the VS Code workbench PROGRAMMATICALLY focuses its
 * own content shortly after it boots — the Getting Started page calls
 * focus() on itself when it renders, and a restored workspace focuses
 * the editor it restored — typically 0.5–4s after the iframe loads, with
 * zero user interaction. Whenever that boot happens at a moment the user
 * did not aim at the workbench (a new session's default tab behind a
 * collapsed panel; switching back to a session whose workspace remounts
 * the panel; a page reload), the grab rips the caret out of wherever it
 * belongs — usually the freshly-autofocused composer, whose two blink
 * cycles are exactly how long the steal takes.
 *
 * The fence therefore bounces a focus entry into the frame unless there
 * is evidence of user intent, in two armed situations:
 *
 * 1. HIDDEN (`visible === false`): every entry is a steal — a hidden
 *    frame cannot receive user clicks.
 * 2. BOOT: for a window after EVERY load of the frame, because every
 *    load is a workbench boot and every boot self-focuses. Most boots
 *    happen at moments the user did not aim at the workbench: the pane
 *    survives workspace switches at the React level, but its iframe is
 *    torn out of the document on the way out and re-inserted on the way
 *    back — which the browser reloads, so switching back to a session
 *    boots a workbench that restores its editor and focuses it right
 *    after the composer was autofocused; a page reload does the same.
 *    During the window, entries bounce unless the user gestured inside
 *    the frame (a click/keydown seen through same-origin privilege — a
 *    cross-origin frame cannot report gestures, so the boot fence
 *    stands down rather than bounce real clicks) or a parent Tab
 *    keypress handed focus over. The one sanctioned boot is the
 *    deferred first load of a component that mounted hidden: the user
 *    revealed the tab to release it, so its focus grab is welcome (the
 *    component decides that, not this function).
 *
 * Bounces are bounded by a FocusRestoreBudget so a re-grabbing
 * workbench cannot livelock the focus chain.
 *
 * Pure bookkeeping on an injected clock so unit tests need no timers.
 *
 * @module dsh-sidebar-vscode/client/focusGuard
 */

/** How long after the first load the boot fence stays armed (ms). */
export const BOOT_WINDOW_MS = 6_000

/** A parent Tab keypress this recent counts as a focus handoff (ms). */
export const PARENT_TAB_WINDOW_MS = 250

/**
 * The snapshot the fence decision runs on. Times are clock readings
 * (ms); `0` means "never".
 */
export interface FenceFacts {
  /** The tab is not visible (`visible === false`): strict mode. */
  hidden: boolean
  /** The boot fence is armed for the frame's latest load. */
  bootArmed: boolean
  /** When the boot fence stands down. */
  bootUntil: number
  /** Last user gesture (pointerdown/keydown) inside the frame. */
  gestureAt: number
  /** Last Tab keypress in the parent document. */
  parentTabAt: number
}

/**
 * Should a focus entry into the frame be bounced back to the surface
 * that held focus last? (The caller checks `document.activeElement`
 * against the frame and spends budget on a `true`.)
 */
export function fenceShouldBounce(facts: FenceFacts, now: number): boolean {
  // Hidden is checked first: a hidden frame cannot earn focus, and a
  // gesture recorded before it was hidden must not legitimize a steal.
  if (facts.hidden) return true
  if (!facts.bootArmed) return false
  if (now >= facts.bootUntil) return false
  if (facts.gestureAt > 0) return false
  if (facts.parentTabAt > 0 && now - facts.parentTabAt <= PARENT_TAB_WINDOW_MS) return false
  return true
}

/** Sliding-window restore budget. */
export class FocusRestoreBudget {
  private windowStart = 0
  private used = 0

  /**
   * @param max - restores allowed per window before standing down.
   * @param windowMs - window length in milliseconds.
   */
  constructor(
    readonly max: number = 5,
    readonly windowMs: number = 10_000,
  ) {}

  /**
   * Try to spend one restore at the given time. The window slides: the
   * first `take` at or after `windowMs` from the window's start re-arms
   * the budget.
   * @param now - the current clock reading (ms).
   * @returns whether the restore may proceed.
   */
  take(now: number): boolean {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now
      this.used = 0
    }
    if (this.used >= this.max) return false
    this.used += 1
    return true
  }
}
