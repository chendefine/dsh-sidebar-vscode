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
export declare const BOOT_LOCK_NAME = "dsh-sidebar-vscode:workbench-boot";
/** How long an uncontended acquisition may take before it is worth mentioning. */
export declare const BOOT_LOCK_GRACE_MS = 500;
/** Bounded wait: proceed unlocked when the lock still has not granted. */
export declare const BOOT_LOCK_WAIT_CAP_MS = 60000;
/** Render-watch cadence while the lock is held. */
export declare const BOOT_LOCK_RENDER_POLL_MS = 250;
/** Bounded hold: release when the frame never reports a rendered workbench. */
export declare const BOOT_LOCK_HOLD_CAP_MS = 30000;
/** The observable states; 'waiting' → ('queued') → 'held' per load key. */
export type BootLockState = 'waiting' | 'queued' | 'held';
/** One observable snapshot — keyed by the frame load it belongs to. */
export interface BootLockStatus {
    /** The load key this acquisition cycle belongs to. */
    readonly key: string;
    readonly state: BootLockState;
}
/**
 * Acquire the cross-tab boot lock, waiting while another tab holds it.
 * Resolves the release function, or null when the Web Locks API is
 * unavailable (fail-open — the caller proceeds unlocked). The release is
 * idempotent.
 */
export declare function acquireWebLock(name?: string): Promise<(() => void) | null>;
/** The injected transport + timing the controller needs (unit-test seams). */
export interface BootLockDeps {
    /** Wait-mode lock acquisition; null = unsupported (proceed unlocked). */
    acquire(): Promise<(() => void) | null>;
    /** Whether the embedded workbench has rendered its DOM. */
    rendered(): boolean;
    /** Schedule one delayed callback (the grace / cap / render-watch cadence). */
    schedule(callback: () => void, ms: number): void;
    /** The clock the caps read. */
    now(): number;
}
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
export declare class WorkbenchBootLock {
    private readonly deps;
    private status;
    private readonly listeners;
    /** Bumped by every begin()/end(): in-flight acquisitions discard stale grants. */
    private generation;
    /** Whether this cycle's acquisition settled (granted, failed, or capped). */
    private settled;
    private release;
    private released;
    private disposed;
    constructor(deps: BootLockDeps);
    /** The current snapshot (a fresh object per transition; identity-stable between). */
    getSnapshot(): BootLockStatus;
    /** Subscribe to snapshot transitions; returns the unsubscriber. */
    subscribe(listener: () => void): () => void;
    private emit;
    private patch;
    /**
     * Start one acquisition cycle for `key`: the frame behind that key may
     * mount only once the snapshot reads 'held' for it. A previous cycle
     * (and its lock hold) is stood down first — exactly one hold per
     * controller at any moment.
     */
    begin(key: string): void;
    /** Stand the current cycle down (stop watches, release the lock). */
    end(): void;
    /**
     * The held lock: report 'held' for the key, then watch for the moment
     * the race this lock exists for is over — the painted workbench — and
     * physically release (bounded by the hold cap for frames whose DOM we
     * can never see, e.g. a cross-origin direct boot).
     */
    private hold;
    /** Physically release the lock (idempotent; the snapshot stays 'held'). */
    private doRelease;
    /** Stop the in-flight cycle and release its hold (snapshot keeps its key). */
    private cancelCycle;
    /** Final teardown: release and ignore every later driver call. */
    dispose(): void;
}
