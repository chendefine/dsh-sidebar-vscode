/**
 * The cross-tab workbench boot lock: serializes the FIRST moments of a
 * VS Code web boot across every same-origin DSH tab holding this plugin.
 *
 * Why: a VS Code web renderer opens its IndexedDB application storage
 * (`vscode-web-db`) within the first second of booting. When two
 * same-origin pages race to CREATE that database, one of them can hang
 * inside `willOpenDatabase` for minutes (measured on this very
 * deployment: a 294-second open on a warm profile; two fresh profiles
 * stalled forever, and both unblocked within 500ms of the OTHER tab's
 * page going away) — the workbench DOM never renders, and the boot
 * gate's reveal then shows an empty frame. The DSH app routinely has
 * several tabs open on the same origin (restored conversations), each
 * able to auto-open this VS Code tab, so the race is not exotic.
 *
 * The fix: before a frame may mount, the tab must hold the Web Lock
 * `dsh-sidebar-vscode:workbench-boot` (the Web Locks API — same-origin
 * scope, released automatically when a holding tab dies). The lock is
 * RELEASED once the workbench has rendered its DOM — a renderer cannot
 * paint `.monaco-workbench` without having passed the database open, so
 * that is exactly the moment the creation race is over for this profile;
 * from then on concurrent opens are the cheap reconnect kind.
 *
 * Everything is fail-open by design — the lock removes a rare stall, it
 * must never introduce a wait of its own:
 *
 * - no Web Locks API (older browsers): acquire answers null, the boot
 *   proceeds unlocked (stock behavior);
 * - the lock never grants (a wedged holder): a bounded wait cap proceeds
 *   unlocked;
 * - the render never happens (cross-origin frame, a broken boot): a
 *   bounded hold cap releases the lock so queued tabs are not starved.
 *
 * While the lock is contended beyond a short grace, the snapshot flips
 * to 'queued' so the loading overlay can say why nothing is happening.
 *
 * @module dsh-sidebar-vscode/client/bootLock
 */

/** The cross-tab lock name (identical in every DSH tab of the profile). */
export const BOOT_LOCK_NAME = 'dsh-sidebar-vscode:workbench-boot'

/** How long an uncontended acquisition may take before it is worth mentioning. */
export const BOOT_LOCK_GRACE_MS = 500

/** Bounded wait: proceed unlocked when the lock still has not granted. */
export const BOOT_LOCK_WAIT_CAP_MS = 60_000

/** Render-watch cadence while the lock is held. */
export const BOOT_LOCK_RENDER_POLL_MS = 250

/** Bounded hold: release when the frame never reports a rendered workbench. */
export const BOOT_LOCK_HOLD_CAP_MS = 30_000

/** The observable states; 'waiting' → ('queued') → 'held' per load key. */
export type BootLockState = 'waiting' | 'queued' | 'held'

/** One observable snapshot — keyed by the frame load it belongs to. */
export interface BootLockStatus {
  /** The load key this acquisition cycle belongs to. */
  readonly key: string
  readonly state: BootLockState
}

/** The structural navigator face the Web Locks binding reads. */
interface LockManagerLike {
  request(name: string, callback: () => Promise<void>): Promise<unknown>
}

/** navigator, narrowed to the optional locks manager. */
type NavigatorWithLocks = { locks?: LockManagerLike }

/**
 * Acquire the cross-tab boot lock, waiting while another tab holds it.
 * Resolves the release function, or null when the Web Locks API is
 * unavailable (fail-open — the caller proceeds unlocked). The release is
 * idempotent.
 */
export function acquireWebLock(name: string = BOOT_LOCK_NAME): Promise<(() => void) | null> {
  const locks = (navigator as NavigatorWithLocks).locks
  if (locks === undefined || typeof locks.request !== 'function') {
    return Promise.resolve(null)
  }
  return new Promise(resolve => {
    let granted = false
    void locks.request(name, async () => {
      granted = true
      let release!: () => void
      const held = new Promise<void>(resolveHeld => { release = resolveHeld })
      resolve(release)
      await held
    }).catch(() => {
      // The request failed before (or without) granting — fail open.
      if (!granted) resolve(null)
    })
  })
}

/** The injected transport + timing the controller needs (unit-test seams). */
export interface BootLockDeps {
  /** Wait-mode lock acquisition; null = unsupported (proceed unlocked). */
  acquire(): Promise<(() => void) | null>
  /** Whether the embedded workbench has rendered its DOM. */
  rendered(): boolean
  /** Schedule one delayed callback (the grace / cap / render-watch cadence). */
  schedule(callback: () => void, ms: number): void
  /** The clock the caps read. */
  now(): number
}

/** The initial snapshot (nothing begun — no key matches yet). */
const INITIAL_STATUS: BootLockStatus = { key: '', state: 'waiting' }

/**
 * One boot-lock controller per mounted VscodeView, driven through two
 * entry points mirroring the boot gate:
 *
 * - {@link WorkbenchBootLock.begin} whenever the frame's load key is
 *   (re)established: releases any previous hold, flips to 'waiting'
 *   (then 'queued' past the grace), and holds the lock once granted —
 *   only a 'held' snapshot matching the CURRENT load key permits the
 *   iframe to mount;
 * - {@link WorkbenchBootLock.end} when that load key goes away
 *   (unmount / target change / manual reload): stops the cycle and
 *   releases the underlying lock (the next begin starts a fresh one).
 *
 * The physical release fires as soon as `rendered()` reports a painted
 * workbench (or the hold cap expires); the snapshot stays 'held' for
 * that key regardless — releasing the lock must never unmount the frame
 * it gated.
 */
export class WorkbenchBootLock {
  private status: BootLockStatus = INITIAL_STATUS
  private readonly listeners = new Set<() => void>()
  /** Bumped by every begin()/end(): in-flight acquisitions discard stale grants. */
  private generation = 0
  /** Whether this cycle's acquisition settled (granted, failed, or capped). */
  private settled = false
  private release: (() => void) | null = null
  private released = false
  private disposed = false

  constructor(private readonly deps: BootLockDeps) {}

  /** The current snapshot (a fresh object per transition; identity-stable between). */
  getSnapshot(): BootLockStatus {
    return this.status
  }

  /** Subscribe to snapshot transitions; returns the unsubscriber. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private patch(next: Partial<BootLockStatus>): void {
    this.status = { ...this.status, ...next }
    this.emit()
  }

  /**
   * Start one acquisition cycle for `key`: the frame behind that key may
   * mount only once the snapshot reads 'held' for it. A previous cycle
   * (and its lock hold) is stood down first — exactly one hold per
   * controller at any moment.
   */
  begin(key: string): void {
    if (this.disposed) return
    this.cancelCycle()
    this.generation += 1
    const generation = this.generation
    this.settled = false
    this.released = false
    this.patch({ key, state: 'waiting' })
    // The grace: an uncontended acquisition is sub-millisecond; anything
    // longer is a real queue worth a word about in the loading overlay.
    this.deps.schedule(() => {
      if (this.disposed || generation !== this.generation || this.settled) return
      this.patch({ state: 'queued' })
    }, BOOT_LOCK_GRACE_MS)
    // The wait cap: a wedged holder must never pin the tab — proceed
    // unlocked (the lock prevents a rare stall, it is not correctness).
    this.deps.schedule(() => {
      if (this.disposed || generation !== this.generation || this.settled) return
      this.hold(null)
    }, BOOT_LOCK_WAIT_CAP_MS)
    void this.deps.acquire().then(
      release => {
        if (this.disposed || generation !== this.generation || this.settled) {
          // A late grant of an already-settled (or abandoned) cycle: drop it.
          release?.()
          return
        }
        this.hold(release)
      },
      () => {
        // The acquisition itself failed: fail open (same as unsupported).
        if (this.disposed || generation !== this.generation || this.settled) return
        this.hold(null)
      },
    )
  }

  /** Stand the current cycle down (stop watches, release the lock). */
  end(): void {
    if (this.disposed) return
    this.cancelCycle()
  }

  /**
   * The held lock: report 'held' for the key, then watch for the moment
   * the race this lock exists for is over — the painted workbench — and
   * physically release (bounded by the hold cap for frames whose DOM we
   * can never see, e.g. a cross-origin direct boot).
   */
  private hold(release: (() => void) | null): void {
    this.settled = true
    this.release = release
    this.patch({ state: 'held' })
    const generation = this.generation
    const startedAt = this.deps.now()
    const tick = (): void => {
      if (this.disposed || generation !== this.generation) return
      if (this.deps.rendered() || this.deps.now() - startedAt >= BOOT_LOCK_HOLD_CAP_MS) {
        this.doRelease()
        return
      }
      this.deps.schedule(tick, BOOT_LOCK_RENDER_POLL_MS)
    }
    tick()
  }

  /** Physically release the lock (idempotent; the snapshot stays 'held'). */
  private doRelease(): void {
    if (this.released) return
    this.released = true
    this.release?.()
    this.release = null
  }

  /** Stop the in-flight cycle and release its hold (snapshot keeps its key). */
  private cancelCycle(): void {
    this.generation += 1
    this.settled = true
    this.doRelease()
  }

  /** Final teardown: release and ignore every later driver call. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelCycle()
  }
}
