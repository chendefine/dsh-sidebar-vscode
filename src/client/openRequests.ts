/**
 * The open-request consumer: the one-shot execution discipline for the
 * `openRequest` stamps the takeover seams write onto the VSCode tab's
 * persisted meta — extracted from the VscodeView effect so the whole
 * nonce-baseline machinery is a unit-testable object.
 *
 * An openRequest is a ONE-SHOT command, not durable tab state, but the
 * sidebar layout (meta included) is persisted and shared across windows
 * and reloads — so a consumer must never replay what predates it:
 *
 * - a request whose nonce is below the PAGE-LOAD floor was persisted by
 *   a previous page (or already executed before a remount): mark it seen
 *   and RETIRE it, never open it;
 * - a request minted by THIS page (nonce ≥ the floor) that no instance
 *   has executed yet is the mount-batch click — it must execute;
 * - anything at or below the last-executed nonce is spent — retire it so
 *   it can never fire again anywhere;
 * - while the frame's boot gate is unsettled (its nonce not parked yet),
 *   a fresh request DEFERS: the click that re-creates the tab lands in
 *   the very render that mounts the iframe, and its open command must be
 *   able to carry the boot nonce (which parks only milliseconds later).
 *   Nothing is advanced or retired while deferring, so the request still
 *   executes once the gate settles;
 * - a request stamped for ANOTHER session's workbench (a different
 *   workspace folder) is declined after retirement — it would land a
 *   foreign file into this workspace's spool. Unstamped requests stay
 *   wildcards.
 *
 * The page-level floor ({@link PAGE_LOAD_AT}) and the page-level
 * executed-nonce watermark live at module scope on purpose: they survive
 * tab close/reopen remounts (whose mount-baseline reads the watermark so
 * an already-executed request never re-opens) and reset only on reload.
 *
 * @module dsh-sidebar-vscode/client/openRequests
 */

import { requestAddressedTo, type OpenRequest } from './openIntercept.ts'

/** The page-load timestamp: nonces below it predate this page. */
const PAGE_LOAD_AT = Date.now()

/** The page-load floor (the real wiring's `pageLoadedAt` dep). */
export function pageLoadedAt(): number {
  return PAGE_LOAD_AT
}

/**
 * The highest openRequest nonce any tab instance of this page has
 * executed. Module level on purpose: it survives tab close/reopen
 * remounts and resets only on reload.
 */
let lastExecutedNonceAtPage = Number.NEGATIVE_INFINITY

/** The injected seams (tests substitute fakes). */
export interface OpenRequestConsumerDeps {
  /** Strip the request from the persisted tab meta (one-shot hygiene). */
  retire(): void
  /** Execute a fresh, addressed request (the workbench open). */
  execute(request: OpenRequest): Promise<void> | void
  /** Whether the boot gate settled (deferred requests wait for true). */
  gateSettled(): boolean
  /** The clock the page-load floor reads (module capture, injectable). */
  pageLoadedAt(): number
}

/**
 * One consumer per mounted VscodeView. Feed it the currently visible
 * request (extracted from the tab meta) and the consuming session on
 * every relevant change; it owns the instance baseline and decides
 * retire / defer / execute / decline exactly once per nonce.
 */
export class OpenRequestConsumer {
  private initialized = false
  private lastNonce = Number.NEGATIVE_INFINITY

  constructor(private readonly deps: OpenRequestConsumerDeps) {}

  /**
   * Consider one visible request for the session whose tab mounted this
   * consumer. Call on every meta/gate change; repeated calls with the
   * same request are idempotent (a seen nonce is retired and skipped).
   */
  update(request: OpenRequest | null, sessionId: string | undefined): void {
    if (!this.initialized) {
      this.initialized = true
      // A request that predates this page load was persisted (or already
      // executed before a remount): mark it seen and skip. A request
      // minted by THIS page (nonce ≥ the floor) that no instance has
      // executed yet is the mount-batch click — fall through so it runs.
      if (request === null || request.nonce < this.deps.pageLoadedAt()) {
        this.lastNonce = request?.nonce ?? Number.NEGATIVE_INFINITY
        // Retire a stale persisted request: the layout outlives the click,
        // and a leftover stamp is what a much-later remount (or another
        // window) mistook for a fresh open — poisoning a foreign
        // workspace's spool with it.
        this.deps.retire()
        return
      }
      this.lastNonce = lastExecutedNonceAtPage
    }
    if (request === null) return
    if (request.nonce <= this.lastNonce) {
      // Seen before (this instance's baseline or a previous execution):
      // spent — retire it so it can never fire again anywhere.
      this.deps.retire()
      return
    }
    // Defer while the frame's boot nonce is not parked yet: the click
    // that re-creates the tab lands in the very render that mounts the
    // iframe, and its open command must carry the boot nonce — which
    // parks only milliseconds later. The caller re-feeds us when the
    // gate settles; nothing is advanced or retired here.
    if (!this.deps.gateSettled()) return
    this.lastNonce = request.nonce
    lastExecutedNonceAtPage = request.nonce
    // A request is a ONE-SHOT command: retire it the moment it is
    // consumed here, whoever executes it below.
    this.deps.retire()
    // Session addressing: a request stamped for ANOTHER session's
    // workbench (a different workspace folder — another window showing a
    // different conversation, a synced layout landing here) must be
    // declined, or the open delivers a foreign file into THIS workspace's
    // spool. Unstamped requests (the settings takeover) stay wildcards.
    if (!requestAddressedTo(request, sessionId)) return
    void Promise.resolve(this.deps.execute(request)).catch(() => {
      // The open paths are fail-soft by design; an execution error must
      // not surface as an unhandled rejection on top.
    })
  }
}
