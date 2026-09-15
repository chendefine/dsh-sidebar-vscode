/**
 * The workbench runtime: the keeper that keeps ONE embedded VS Code
 * workbench alive across right-Sidebar tab switches.
 *
 * WHY A KEEPER: the official pane renders only the active tab's body, so
 * every switch away unmounts this plugin's tab body — and an iframe
 * element removed from its parent loses its nested browsing context per
 * the HTML spec ("The iframe HTML element removing steps … are to destroy
 * a child navigable"). No re-parenting dance can save it (verified
 * against Chromium 151: same-document moves of the iframe AND of its
 * ancestor container both reload it), and VS Code has no
 * snapshot/rehydrate path (the way `ui-sidebar-terminal` rehydrates its
 * xterm from the controller's screen revisions — the pattern this design
 * borrows, adapted to the one element type whose state IS its document).
 * The only survival strategy left: the iframe element NEVER leaves the
 * DOM, so the workbench state must outlive the React component that
 * opened it.
 *
 * WHAT THIS MODULE OWNS, then, is everything the old `VscodeView` kept
 * in per-mount refs, lifted into a page-scoped singleton:
 *
 * - the persistent HOST `div` under `document.body` and the iframe inside
 *   it (created once per workbench lifetime, removed only on destroy);
 * - the boot LOCK, boot GATE, focus FENCE and open-channel OPENER
 *   controllers (each already a headless, dependency-injected object —
 *   they move here unchanged in behavior, only their lifetime changes);
 * - the clipboard BRIDGE (re-installed per frame load, its payload sink
 *   routed to whichever view is attached);
 * - the rect PROJECTION (see `projection.ts`): the attached tab body's
 *   placeholder pins the host's box while that tab is visible.
 *
 * LIFECYCLE RULES (the leak discipline — every rule exists so that
 * nothing outlives the thing that justifies it):
 *
 * - ONE live workbench per page, by BASIS (`${serverUrl}#${mapped
 *   workspace}`): a second basis (another workspace, a settings edit)
 *   reloads the frame in place (`src` reassignment); it never creates a
 *   second VS Code instance — the boot lock exists precisely because two
 *   concurrent same-origin boots deadlock VS Code's IndexedDB.
 * - ADOPTERS: every attached view registers its tab's abort signal; the
 *   runtime survives view unmounts (a tab switch away must NOT destroy
 *   the workbench — that is this module's whole point) and dies when the
 *   LAST adopting tab record goes away (signal abort = the sidebar
 *   removed the record; sidebar close and session switches retain
 *   records, so switching back and forth is free).
 * - PLUGIN DISPOSE (HMR / unload): `destroyWorkbenchRuntime()` tears
 *   everything down — host element removed, listeners and observers
 *   disposed, controllers' own teardowns run.
 * - `release()` (the view's unmount path) detaches the projection and
 *   hides the host; the workbench keeps running invisibly (its boot
 *   finishes, its WebSocket stays open — switching back is INSTANT).
 *
 * The frame never mounts before its audience: creation is gated on the
 * same deferred-first-load rule the view had (visible at least once, cwd
 * resolved, base resolved), and the boot lock → gate → `src` sequence
 * preserves the exact ordering the React effects used to give. The focus
 * fence is minted at the first ATTACH with that attach's visibility —
 * the one sanctioned boot is the deferred first load a hidden component
 * later released, exactly as before.
 *
 * Everything browser-shaped is injected (element factory, body, style
 * adopter, frame timing), so the state machine unit-tests in a bare node
 * environment; the channel transport (`openChannelApi`) stays the real
 * one because the controllers own its cancellation.
 *
 * @module dsh-sidebar-vscode/client/workbenchRuntime
 */
import type { PathMapRule } from './paths.ts';
import { type BootGateStatus } from './bootGate.ts';
import { type BootLockStatus } from './bootLock.ts';
import { type PendingOpen, type WorkbenchOpener } from './workbenchLink.ts';
import { type ClipboardPayloadSink } from './clipboardBridge.ts';
import { type ProjectionAnchor, type ProjectorTiming } from './projection.ts';
import { type OpenCommand } from './openChannelApi.ts';
/** What a view feeds the runtime per render (undefined serverUrl = base re-resolving; hold the current one). */
export interface WorkbenchInputs {
    /** The RESOLVED iframe base (mount or direct); undefined while the base resolution is in flight. */
    readonly serverUrl: string | undefined;
    /** The parsed `pathMap` rules. */
    readonly pathMap: readonly PathMapRule[];
    /** The session's authoritative cwd (undefined until resolved). */
    readonly cwd: string | undefined;
}
/** The observable state the view renders from. */
export interface WorkbenchRuntimeSnapshot {
    /** The load key currently desired (target URL + reload nonce; '' before the first). */
    readonly loadKey: string;
    /** Whether the iframe element exists (the first load has been released). */
    readonly frameAlive: boolean;
    /** Whether the frame fired a load for the key it carries. */
    readonly loaded: boolean;
    /** The pending degraded-channel payload URL, if any. */
    readonly pending: PendingOpen | null;
    /** The boot gate's state (keyed reads are the view's discipline). */
    readonly gate: BootGateStatus;
    /** The boot lock's state (keyed reads are the view's discipline). */
    readonly lock: BootLockStatus;
    /** Which view's placeholder the projection follows (null = nobody's). */
    readonly projected: string | null;
}
/**
 * The structural element face this module needs. The default binding is
 * the browser's; tests supply fakes, so it stays minimal: the style bag
 * the projector and frame dressing write, the iframe-ish members the
 * controllers read, and the child/remove plumbing the host needs.
 */
export interface RuntimeElement {
    readonly style: Record<'left' | 'top' | 'width' | 'height' | 'zIndex' | 'visibility' | 'opacity' | 'pointerEvents', string>;
    src: string;
    className: string;
    title: string;
    appendChild(child: unknown): void;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    remove(): void;
}
/** The DOM factory the runtime builds its persistent pieces through. */
export interface RuntimeDom {
    /** Create one element (the host div, the frame). */
    createElement(tag: string): RuntimeElement;
    /** Where the persistent host is appended; the host's `remove` takes it back out. */
    readonly body: {
        appendChild(child: unknown): void;
    };
}
/** The node-half channel face the controllers drive (the real API, injectable for tests). */
export interface WorkbenchChannel {
    /** Park one boot nonce (`boot.begin`). */
    beginBoot(folder: string, nonce: string): Promise<{
        began: boolean;
        editors: string[] | null;
    }>;
    /** Whether the extension's receipt echoes the nonce (`boot.status`). */
    pollBootStatus(folder: string, nonce: string): Promise<boolean>;
    /** The extension capability probe (false / build version). */
    probeCapability(folder: string): Promise<false | number>;
    /** Hand one open command to the extension spool (`open.request`). */
    sendOpenCommand(command: OpenCommand): Promise<boolean>;
}
/** The seams tests substitute (DOM, styles, timing, channel, lock). */
export interface WorkbenchRuntimeDeps {
    readonly dom: RuntimeDom;
    /** Style-sheet adoption for the host sheet (default: the plugin registry). */
    readonly adoptStyles: () => () => void;
    /** One-shot scheduling for the controllers' cadence. */
    readonly schedule: (callback: () => void, ms: number) => void;
    /** The clock the controllers read. */
    readonly now: () => number;
    /** The projection loop's frame timing. */
    readonly timing: ProjectorTiming;
    /** The node-half channel (default: the real routes). */
    readonly channel: WorkbenchChannel;
    /** The cross-tab boot lock acquisition (default: Web Locks, fail-open). */
    readonly acquireLock: () => Promise<(() => void) | null>;
}
/**
 * The runtime handle a view drives. Every method is safe after destroy
 * (a no-op), so a view never needs to know whether it outlives the
 * workbench it projects.
 */
export interface WorkbenchHandle {
    /** The iframe element (null before creation / after destroy); managed by the runtime, read by views. */
    element: RuntimeElement | null;
    /** The open orchestrator (the view's navigation consumer drives it). */
    readonly opener: WorkbenchOpener;
    /** Feed the latest resolved inputs (per render; undefined serverUrl = hold). */
    update(inputs: WorkbenchInputs): void;
    /**
     * Attach this view: register the tab's abort signal (the runtime dies
     * when the LAST registered signal aborts), point the projection at the
     * placeholder, and feed the visibility flag. Re-attaching replaces the
     * current projection — only one view projects at a time.
     */
    attach(id: string, signal: AbortSignal, anchor: ProjectionAnchor | null, visible: boolean): void;
    /** Feed the visibility flag without re-registering (panel collapse/expand). */
    setVisible(visible: boolean): void;
    /** The view's unmount path: drop THIS view's projection, keep the workbench. */
    release(id: string): void;
    /** The clipboard sink the bridge routes to (null = fall back to the readable text). */
    setPayloadHandler(handler: ClipboardPayloadSink | null): void;
    /** The degradation-notice sink (transient UI state lives in the view). */
    setNoticeSink(sink: ((message: string) => void) | null): void;
    /** Manual reload: drop any pending payload, force one fresh load of the same target. */
    reload(): void;
    /** Whether the gate settled enough to run deferred open requests. */
    gateSettled(): boolean;
    /** The boot tag an open command may carry (see the boot gate). */
    taggableNonce(): string | undefined;
    /** The observable state the view renders from. */
    getSnapshot(): WorkbenchRuntimeSnapshot;
    subscribe(listener: () => void): () => void;
}
/**
 * Adopt (or create) the page's workbench runtime.
 *
 * The singleton is created on first use and reused while its basis holds;
 * a basis change reloads in place (never a second instance). A destroyed
 * runtime is replaced transparently by the next adopt.
 * @returns the handle every view of the workbench shares.
 */
export declare function adoptWorkbenchRuntime(): WorkbenchHandle;
/**
 * Tear the runtime down unconditionally (plugin dispose / HMR): host
 * removed from the body, every controller and listener disposed. Safe to
 * call with no live runtime.
 */
export declare function destroyWorkbenchRuntime(): void;
/**
 * Test-only: install a runtime built on injected seams into the
 * singleton slot (destroying any live one first).
 * @param deps - the fake DOM / styles / timing bundle.
 * @returns the handle the tests drive.
 */
export declare function installWorkbenchRuntimeForTest(deps: WorkbenchRuntimeDeps): WorkbenchHandle;
