/**
 * The DOM-quiet boot watcher: the fallback reveal path of the VSCode
 * tab's boot gate, for workbench loads whose boot nonce could not be
 * parked with the node half (an older host half whose `boot.begin` /
 * `boot.status` routes are not loaded yet — the exact handshake is in
 * `openChannelApi.ts` and takes over once the host restarts).
 *
 * While the iframe sits hidden (opacity 0), VS Code's own editor restore
 * and the extension's boot reconcile both mutate the editor tab strip;
 * when that strip has held still for a quiet window the reconcile is done
 * and the first VISIBLE frame already shows the reconciled editor area —
 * nothing ever visibly opens just to be closed again.
 *
 * The watcher is deliberately conservative and fail-soft: a cross-origin
 * frame (no readable document) reveals immediately (stock behavior, the
 * direct-iframe fallback), a shell that never renders falls to the
 * bounded timeout, and every signal is re-sampled from the live DOM so a
 * late mutation always re-arms the quiet window.
 *
 * @module dsh-sidebar-vscode/client/bootGate
 */

/** What the reveal decision needs from the host component. */
export interface BootQuietInputs {
  /**
   * Sample the workbench's editor-tab signature, or null when the frame
   * is cross-origin (unreadable) — the ungated case. An empty string
   * means "same-origin but the workbench shell has not rendered yet"; any
   * non-empty string (a rendered shell, even with zero tabs — use a
   * sentinel like `(none)`) counts as rendered.
   */
  sample(): string | null
}

/** Timing knobs (overridable for tests). */
export interface BootQuietTiming {
  /** Minimum time from start before a quiet frame may reveal (ms). */
  minElapsedMs: number
  /** How long the tab signature must hold still (ms). */
  quietMs: number
  /** Hard reveal deadline from start (ms). */
  timeoutMs: number
  /** Sampling interval (ms). */
  intervalMs: number
}

/** The defaults the VSCode tab uses. */
export const BOOT_QUIET_TIMING: BootQuietTiming = {
  minElapsedMs: 1500,
  quietMs: 1200,
  timeoutMs: 8000,
  intervalMs: 250,
}

/**
 * Watch `inputs.sample()` until the workbench's editor strip is rendered
 * AND has been quiet for `timing.quietMs` (with `minElapsedMs` elapsed),
 * the frame turns out to be cross-origin, or the timeout hits — then call
 * `onReveal()` exactly once. Returns a stop function (idempotent).
 */
export function watchBootQuiet(
  inputs: BootQuietInputs,
  onReveal: () => void,
  timing: BootQuietTiming = BOOT_QUIET_TIMING,
  schedule: (callback: () => void, ms: number) => void = (cb, ms) => { window.setTimeout(cb, ms) },
  now: () => number = Date.now,
): () => void {
  let stopped = false
  let revealed = false
  let lastSignature: string | null = null
  let lastChangeAt = now()
  const startedAt = lastChangeAt
  const reveal = (): void => {
    if (stopped || revealed) return
    revealed = true
    onReveal()
  }
  const tick = (): void => {
    if (stopped || revealed) return
    const at = now()
    if (at - startedAt >= timing.timeoutMs) {
      reveal()
      return
    }
    const signature = inputs.sample()
    if (signature === null) {
      // Cross-origin frame: no visibility into the workbench — ungated.
      reveal()
      return
    }
    if (signature !== lastSignature) {
      lastSignature = signature
      lastChangeAt = at
    }
    const quiet = at - lastChangeAt >= timing.quietMs
    const rendered = lastSignature !== null && lastSignature !== ''
    if (rendered && quiet && at - startedAt >= timing.minElapsedMs) {
      reveal()
      return
    }
    schedule(tick, timing.intervalMs)
  }
  schedule(tick, timing.intervalMs)
  return () => { stopped = true }
}
