/**
 * The focus fence of the embedded workbench: the controller that bounces
 * focus entries into the VS Code iframe back to the surface that held
 * focus last, unless the user actually aimed at the workbench.
 *
 * Why a fence at all: the VS Code workbench PROGRAMMATICALLY focuses its
 * own content shortly after it boots — the Getting Started page calls
 * focus() on itself when it renders, and a restored workspace focuses the
 * editor it restored — typically 0.5–4s after the iframe loads, with zero
 * user interaction. Whenever that boot happens at a moment the user did
 * not aim at the workbench (a new session's default tab behind a
 * collapsed panel; switching back to a session whose workspace remounts
 * the panel; a page reload), the grab rips the caret out of wherever it
 * belongs — usually the freshly-autofocused composer.
 *
 * The DECISION logic is pure and lives in focusGuard.ts (`fenceShouldBounce`,
 * `FocusRestoreBudget` — unit-tested there). This controller owns the
 * plumbing around it: the parent-document listeners for the component's
 * whole life, the per-load gesture trackers inside the frame document,
 * and the visibility/boot arming windows. Two armed situations:
 *
 * 1. HIDDEN (`visible === false`, explicit only): every entry is a steal
 *    — a hidden frame cannot receive user clicks.
 * 2. BOOT: for a window after EVERY load of the frame (each load is a
 *    workbench boot, and every boot self-focuses). Entries bounce UNLESS
 *    the user gestured inside the frame (same-origin pointerdown/keydown
 *    trackers, re-attached on every load — a cross-origin frame cannot
 *    report gestures, so the boot fence stands down rather than bounce
 *    real clicks) or a parent Tab keypress handed focus over. The ONE
 *    sanctioned boot is the deferred first load of a component that
 *    mounted hidden: the user revealed the tab to release it, so its
 *    focus grab is welcome (see {@link FocusFenceController.onFrameLoad}).
 *
 * Detection rides FOCUSOUT, not focusin: a focus crossing INTO the iframe
 * fires focusout in the parent document but never focusin — the focusin
 * lands inside the frame's own document.
 *
 * @module dsh-sidebar-vscode/client/focusFence
 */

import { BOOT_WINDOW_MS, fenceShouldBounce, FocusRestoreBudget } from './focusGuard.ts'

/** The injected seams (unit tests substitute a fake frame). */
export interface FocusFenceDeps {
  /** The live iframe element (null before the frame mounts). */
  getFrame(): HTMLIFrameElement | null
  /** The clock the arming windows read. */
  now(): number
  /** Macro-task scheduler for the settled-activeElement check. */
  setTimeout(callback: () => void, ms?: number): void
}

/**
 * The fence controller: attach() installs the parent-document listeners
 * once for the owning component's lifetime; onFrameLoad() re-arms the
 * boot window and re-attaches the gesture trackers on every frame load
 * (the document they must live in is whichever the frame shows now — an
 * intermediate about:blank would otherwise leave them aimed at a dead
 * document); setVisible() feeds the hidden situation (armed only on an
 * EXPLICIT false — an old better-sidebar peer passing no flag must never
 * have its user clicks fought; undefined fails open).
 */
export class FocusFenceController {
  private readonly budget: FocusRestoreBudget
  private lastOutside: HTMLElement | null = null
  private bootArmed = false
  private bootUntil = 0
  private gestureAt = 0
  private parentTabAt = 0
  private visible: boolean | undefined
  private readonly bornVisible: boolean
  private firstLoad = true

  constructor(
    private readonly deps: FocusFenceDeps,
    options: { bornVisible?: boolean, budgetMax?: number, budgetWindowMs?: number } = {},
  ) {
    this.bornVisible = options.bornVisible ?? true
    this.budget = new FocusRestoreBudget(options.budgetMax, options.budgetWindowMs)
  }

  /** Feed the tab's visibility flag (explicit false arms the hidden fence). */
  setVisible(visible: boolean | undefined): void {
    this.visible = visible
  }

  /**
   * Install the parent-document listeners (focusout/focusin tracking, the
   * Tab handoff marker, the steal check). Everything the handlers read
   * lives on the controller, so the listeners never need re-arming.
   * @returns the disposer removing them.
   */
  attach(): () => void {
    const track = (target: EventTarget | null): void => {
      if (target instanceof HTMLElement && target !== this.deps.getFrame()) this.lastOutside = target
    }
    const checkSteal = (): void => {
      const frame = this.deps.getFrame()
      if (frame === null || document.activeElement !== frame) return
      const bounce = fenceShouldBounce({
        hidden: this.visible === false,
        bootArmed: this.bootArmed,
        bootUntil: this.bootUntil,
        gestureAt: this.gestureAt,
        parentTabAt: this.parentTabAt,
      }, this.deps.now())
      if (!bounce) return
      if (!this.budget.take(this.deps.now())) return
      if (this.lastOutside !== null && this.lastOutside.isConnected) this.lastOutside.focus()
    }
    const onFocusOut = (event: FocusEvent): void => {
      track(event.target)
      this.deps.setTimeout(checkSteal, 0)
    }
    const onFocusIn = (event: FocusEvent): void => { track(event.target) }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') this.parentTabAt = this.deps.now()
    }
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }

  /**
   * The frame fired a load: reset the gesture memory, re-attach the
   * same-origin gesture trackers into the frame's CURRENT document, and
   * re-arm the boot fence with a fresh window. The one sanctioned boot is
   * the deferred FIRST load of a component that mounted hidden — that
   * load was released by the user revealing the tab, so its focus grab is
   * welcome (and the gesture trackers make every other armed window
   * harmless for a user who is actually clicking inside).
   */
  onFrameLoad(): void {
    this.gestureAt = 0
    let gesturesVisible = true
    const frame = this.deps.getFrame()
    try {
      const doc = frame?.contentDocument ?? null
      if (frame === null || doc === null) {
        // Cross-origin (the direct-iframe fallback) or not yet mounted: no
        // gesture visibility — fail open rather than bounce real clicks.
        gesturesVisible = false
      } else {
        const mark = (): void => { this.gestureAt = this.deps.now() }
        doc.addEventListener('pointerdown', mark, true)
        doc.addEventListener('keydown', mark, true)
      }
    } catch {
      gesturesVisible = false
    }
    const firstLoad = this.firstLoad
    this.firstLoad = false
    const sanctionedReveal = firstLoad && !this.bornVisible
    this.bootArmed = gesturesVisible && !sanctionedReveal
    this.bootUntil = this.deps.now() + BOOT_WINDOW_MS
  }
}
