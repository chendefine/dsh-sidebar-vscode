/**
 * The boot gate of the VSCode tab — the mechanism that keeps a freshly
 * loading workbench iframe invisible (opacity 0) until its editor area is
 * reconciled, so nothing ever visibly opens just to be closed again.
 *
 * Two layers live here:
 *
 * - {@link watchBootQuiet}, the DOM-quiet fallback reveal for workbench
 *   loads whose boot nonce could not be parked with the node half (an
 *   older host half whose `boot.begin` / `boot.status` routes are not
 *   loaded yet — the exact handshake is in `openChannelApi.ts` and takes
 *   over once the host restarts);
 * - {@link BootGateController}, the full nonce-handshake state machine
 *   the VscodeView drives (`begin` on every frame load key, `frameLoaded`
 *   on the iframe's load event, `fence` on unmount): it parks the boot
 *   nonce BEFORE the frame mounts, awaits the extension's post-reconcile
 *   receipt echoing it, rotates the nonce when a still-mounted frame
 *   RELOADS in place, and reveals when the receipt matches, the workbench
 *   DOM renders quiet AND matches the parked boot ledger, or a bounded
 *   timeout expires — whichever comes first. All timing and transport
 *   are injected, so the whole machine is unit-testable without a DOM.
 *
 * While the iframe sits hidden, VS Code's own editor restore and the
 * extension's boot reconcile both mutate the editor tab strip; when that
 * strip has held still for a quiet window (or the receipt landed) the
 * first VISIBLE frame already shows the reconciled editor area.
 *
 * Every layer is deliberately conservative and fail-soft: a cross-origin
 * frame (no readable document) reveals immediately (stock behavior, the
 * direct-iframe fallback), a shell that never renders falls to the bounded
 * timeout, and every signal is re-sampled live so a late mutation always
 * re-arms the quiet window.
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
  /**
   * Optional second gate the reveal must ALSO pass: whether the sampled
   * strip is not merely quiet but SETTLED — matching the boot ledger the
   * reconcile diffs against. A quiet-but-mismatched strip (a ghost VS
   * Code's restore replayed, close still in flight) answers false and
   * keeps the frame hidden. Absent = no extra gate (quiet alone reveals).
   */
  settled?(): boolean
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
  minElapsedMs: 800,
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
    // The settled gate is re-sampled live: a quiet strip held back by a
    // ledger mismatch flips to settled the moment the reconcile's close
    // lands (the strip change re-arms the quiet window, settled passes,
    // the next tick reveals).
    const settledOk = inputs.settled === undefined || inputs.settled()
    if (rendered && quiet && settledOk && at - startedAt >= timing.minElapsedMs) {
      reveal()
      return
    }
    schedule(tick, timing.intervalMs)
  }
  schedule(tick, timing.intervalMs)
  return () => { stopped = true }
}

// ---- the boot-gate state machine (nonce handshake + rotation) --------------

/** The final path segment of one editor id (the strip exposes basenames). */
function basenameOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * Whether a sampled editor strip matches the boot ledger's desired
 * open-editor set, as a multiset of BASE names: the VS Code tab DOM
 * exposes only `data-resource-name` (no full paths), so the comparison
 * is exact on count and names. A mismatch is always decisive (the strip
 * is not what the reconcile will settle at); a match is decisive unless
 * two distinct files share one basename — a collision the receipt and
 * the bounded timeout still cover.
 */
export function sameEditorSet(strip: readonly string[], ledger: readonly string[]): boolean {
  if (strip.length !== ledger.length) return false
  const left = strip.map(basenameOf).sort()
  const right = ledger.map(basenameOf).sort()
  return left.every((name, at) => name === right[at])
}

/** The gate's phases, in lifecycle order. */
export type BootGatePhase =
  /** The boot nonce is not parked yet — the frame must NOT mount. */
  | 'pending'
  /** A still-mounted frame RELOADED in place; a fresh nonce is being parked. */
  | 'rotating'
  /** Parked; the extension's receipt is being awaited (the nonce is taggable). */
  | 'hidden'
  /** No exact handshake (route missing): the DOM-quiet watcher decides the reveal. */
  | 'dom'
  /** No gating at all (no workspace / cross-origin boot): stock behavior. */
  | 'off'

/** One observable gate state — keyed by the frame load it belongs to. */
export interface BootGateStatus {
  /** The load key this state belongs to (target + reload nonce). */
  readonly key: string
  readonly phase: BootGatePhase
  /** The parked boot nonce ('' unless phase is 'hidden'). */
  readonly nonce: string
  /** The workspace the nonce was parked for ('' unless phase is 'hidden'). */
  readonly workspace: string
  /**
   * The boot ledger's desired open-editor set as parked (null = no
   * ledger / unknown — the reveal racer then gates on quiet alone).
   */
  readonly ledger: readonly string[] | null
  /** Whether the frame may be revealed (visible) for this load. */
  readonly revealed: boolean
}

/** The injected transport + timing the controller needs (unit-test seams). */
export interface BootGateDeps {
  /** The live mapped workspace of the addressed session (null = unknown). */
  workspace(): string | null
  /** Park one boot nonce with the node half (routes `boot.begin`). */
  beginBoot(folder: string, nonce: string): Promise<{ began: boolean, editors: string[] | null }>
  /** Whether the extension's receipt echoes this nonce (route `boot.status`). */
  pollBootStatus(folder: string, nonce: string): Promise<boolean>
  /** Sample the workbench's editor-tab signature (null = cross-origin). */
  domSample(): string | null
  /**
   * Sample the workbench's open-editor name strip (one entry per file
   * tab, basename as the DOM exposes it; null = unreadable/not rendered).
   * Only consulted when a boot ledger is known — to verify the strip has
   * settled at what the reconcile will leave standing.
   */
  domPaths(): string[] | null
  /** Mint one boot nonce (client randomness, printable). */
  mintNonce(): string
  /** Schedule one callback (the reveal poll / quiet watcher cadence). */
  schedule(callback: () => void, ms: number): void
  /** The clock every budget reads. */
  now(): number
}

/**
 * Reveal budget for the exact-handshake poll loop (ms from the frame's
 * load event). The DOM-quiet racer usually reveals long before this; the
 * budget only bounds the pathological case (nothing renders, nothing
 * answers) so the overlay never pins the tab for the old 8s span.
 */
export const BOOT_REVEAL_TIMEOUT_MS = 4_000

/** Poll cadence of the receipt watch. */
export const BOOT_POLL_INTERVAL_MS = 150

/**
 * The boot gate controller: one instance per mounted VscodeView, driven
 * through three entry points —
 *
 * - {@link BootGateController.begin} whenever the frame's load key changes
 *   (first mount, target change, manual reload): parks a fresh nonce
 *   BEFORE the frame may mount ('pending' keeps it unmounted; 'off' skips
 *   gating when no workspace is known);
 * - {@link BootGateController.frameLoaded} on every iframe load event: the
 *   FIRST load starts the reveal watch against the parked nonce; every
 *   subsequent load of the same frame is an in-place RELOAD (the pane DOM
 *   was detached on a panel collapse or workspace switch and re-inserted,
 *   which the browser treats as a reload) and ROTATES the nonce first —
 *   retiring every lingering extension host still bound to the old boot;
 * - {@link BootGateController.fence} when the frame goes away (unmount /
 *   key change): rotates the parked nonce once more so a lingering host
 *   stops writing the shared editor ledger from its invisible window.
 *
 * The reveal paths: the 'hidden' phase runs a RACE between the receipt
 * poll (every {@link BOOT_POLL_INTERVAL_MS}, budgeted by
 * {@link BOOT_REVEAL_TIMEOUT_MS}) and the DOM-quiet watcher
 * ({@link watchBootQuiet}) — whichever settles first reveals, because a
 * reloaded frame's extension host may never re-activate and its receipt
 * then never lands, while the rendered editor strip is proof enough that
 * the staging the gate exists for is done. The 'dom' phase (no exact
 * handshake available) watches the editor strip alone; anything else
 * reveals immediately.
 */
export class BootGateController {
  private status: BootGateStatus = { key: '', phase: 'pending', nonce: '', workspace: '', ledger: null, revealed: false }
  private readonly listeners = new Set<() => void>()
  private revealStop: (() => void) | null = null
  private loadCount = 0
  private disposed = false

  constructor(private readonly deps: BootGateDeps) {}

  /** The current state (a fresh object per transition; identity-stable between). */
  getSnapshot(): BootGateStatus {
    return this.status
  }

  /** Subscribe to state transitions; returns the unsubscriber. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private patch(next: Partial<BootGateStatus>): void {
    this.status = { ...this.status, ...next }
    this.emit()
  }

  /**
   * The nonce an open command may be tagged with: only a 'hidden' phase
   * nonce is live for THIS boot (the extension consumes a tagged command
   * solely on the host that activated with it — see the open channel).
   */
  taggableNonce(): string | undefined {
    return this.status.phase === 'hidden' ? this.status.nonce : undefined
  }

  /** Whether the gate has settled enough to run deferred open requests. */
  settled(): boolean {
    return this.status.phase !== 'pending' && this.status.phase !== 'rotating'
  }

  /**
   * A new frame load begins for `key` (the previous frame, if any, went
   * away): park a fresh boot nonce BEFORE the frame may mount. A missing
   * workspace skips gating ('off' — stock behavior); a failed park falls
   * back to the DOM-quiet watcher ('dom').
   */
  begin(key: string): void {
    if (this.disposed) return
    this.revealStop?.()
    this.revealStop = null
    this.loadCount = 0
    this.status = { key, phase: 'pending', nonce: '', workspace: '', ledger: null, revealed: false }
    this.emit()
    const workspace = this.deps.workspace()
    if (workspace === null) {
      this.patch({ phase: 'off' })
      return
    }
    const nonce = this.deps.mintNonce()
    void (async () => {
      const outcome = await this.deps.beginBoot(workspace, nonce)
      if (this.disposed || this.status.key !== key) return
      this.patch(outcome.began
        ? { phase: 'hidden', nonce, workspace, ledger: outcome.editors }
        : { phase: 'dom', nonce: '', workspace: '', ledger: null })
    })()
  }

  /**
   * The frame fired a load event for the CURRENT key: the first load
   * starts the reveal watch; a subsequent load of the same frame is an
   * in-place reload and rotates the nonce first (fresh renderer whose
   * extension host activates against a bootreq that still names the
   * PREVIOUS boot — whose hosts may be lingering).
   */
  frameLoaded(): void {
    if (this.disposed) return
    this.loadCount += 1
    const { key, phase } = this.status
    if (this.loadCount > 1 && (phase === 'hidden' || phase === 'rotating')) {
      void this.rotate(key)
      return
    }
    this.startRevealWatch(this.status, key)
  }

  /** Rotate the boot nonce for a reloaded frame and re-arm the reveal. */
  private async rotate(key: string): Promise<void> {
    const workspace = this.deps.workspace()
    if (workspace === null) {
      this.startRevealWatch(this.status, key)
      return
    }
    this.patch({ phase: 'rotating', nonce: '', workspace: '', ledger: null, revealed: false })
    const fresh = this.deps.mintNonce()
    const outcome = await this.deps.beginBoot(workspace, fresh)
    if (this.disposed || this.status.key !== key) return
    const next: BootGateStatus = outcome.began
      ? { key, phase: 'hidden', nonce: fresh, workspace, ledger: outcome.editors, revealed: false }
      : { key, phase: 'dom', nonce: '', workspace: '', ledger: null, revealed: false }
    this.status = next
    this.emit()
    this.startRevealWatch(next, key)
  }

  /**
   * The frame is going away (unmount or key change): rotate the parked
   * nonce once more, fire-and-forget — a lingering extension host still
   * holding the old nonce must stand down before its invisible window
   * poisons the shared editor ledger.
   */
  fence(): void {
    const workspace = this.deps.workspace()
    if (workspace !== null) void this.deps.beginBoot(workspace, this.deps.mintNonce())
  }

  /** Start (or restart) the reveal watch for the current load. */
  private startRevealWatch(gate: BootGateStatus, key: string): void {
    this.revealStop?.()
    this.revealStop = null
    const reveal = (): void => {
      if (this.disposed || this.status.key !== key || this.status.revealed) return
      this.patch({ revealed: true })
      // The winner also stands the loser down: a receipt landing after the
      // quiet reveal (or vice versa) must not keep a watcher ticking.
      this.revealStop?.()
    }
    if (gate.phase === 'hidden') {
      // THE REVEAL RACE — two independent signals run concurrently and the
      // first to fire reveals. The exact handshake is no longer the only
      // path: a reloaded frame's extension host may never re-activate, so
      // its receipt never lands, and the old code then burned the FULL
      // reveal budget on a workbench that had long since painted.
      //
      // (a) the receipt poll — the extension's post-reconcile echo,
      //     bounded by BOOT_REVEAL_TIMEOUT_MS from the load event. A
      //     match reveals unconditionally (the reconcile is DONE, even if
      //     the basename comparison below was fooled); an expired budget
      //     reveals only when the ledger gate passes — a quiet strip the
      //     ledger still mismatches means the reconcile's close is in
      //     flight (or never coming), and burning the budget then would
      //     flash exactly the ghost the gate exists to hide.
      // (b) the DOM-quiet racer — the workbench has RENDERED and its
      //     editor tab strip has held still for the quiet window AND
      //     matches the boot ledger (no ledger = nothing will reconcile,
      //     quiet is final). "Quiet" alone proved too weak: during a
      //     ghost boot the strip is quiet-but-wrong for the whole
      //     reconcile settle window, and quietness is precisely the
      //     precondition of the close that follows it — never evidence
      //     the close already happened.
      const settledByLedger = (): boolean => {
        if (gate.ledger === null) return true
        const strip = this.deps.domPaths()
        if (strip === null) return false
        return sameEditorSet(strip, gate.ledger)
      }
      const stops: Array<() => void> = []
      this.revealStop = () => { for (const stop of stops) stop() }
      const startedAt = this.deps.now()
      let pollStopped = false
      stops.push(() => { pollStopped = true })
      const tick = (): void => {
        if (pollStopped || this.disposed) return
        void (async () => {
          let matched = false
          try { matched = await this.deps.pollBootStatus(gate.workspace, gate.nonce) } catch { matched = false }
          if (pollStopped || this.disposed) return
          if (matched || (this.deps.now() - startedAt > BOOT_REVEAL_TIMEOUT_MS && settledByLedger())) {
            reveal()
            return
          }
          this.deps.schedule(tick, BOOT_POLL_INTERVAL_MS)
        })()
      }
      tick()
      let quietStop: (() => void) | null = null
      quietStop = watchBootQuiet(
        { sample: () => this.deps.domSample(), settled: settledByLedger },
        reveal,
        BOOT_QUIET_TIMING,
        (callback, ms) => { this.deps.schedule(callback, ms) },
        () => { return this.deps.now() },
      )
      stops.push(() => { quietStop?.() })
      return
    }
    if (gate.phase === 'dom') {
      this.revealStop = watchBootQuiet(
        { sample: () => this.deps.domSample() },
        reveal,
        BOOT_QUIET_TIMING,
        (callback, ms) => { this.deps.schedule(callback, ms) },
        () => { return this.deps.now() },
      )
      return
    }
    reveal()
  }

  /** Final teardown: stop the watch and ignore every later driver call. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.revealStop?.()
    this.revealStop = null
  }
}
