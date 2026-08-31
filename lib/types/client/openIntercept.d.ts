/**
 * The chat-open takeover's shared plumbing: the reroute driver, the
 * openRequest meta vehicle, and the `workspaces.openPath` wrapper — the
 * pieces both takeover seams (research options II + III) share.
 *
 * The two seams every chat-originated open flows through:
 * - the turn-tail slot (option II, turnTail.tsx): the produced-files row
 *   (the "changed files" chips) is claimed at priority -2, before
 *   dsh-better-sidebar's own -1 entry, so its chips open here;
 * - `workspaces.openPath` (option III, below): the client runtime's SINGLE
 *   funnel for the remaining chat-side opens (tool-row path links, prose
 *   file mentions — ui-conversation's apply.ts is the only production
 *   caller). This also repairs the headless-container hole: better-sidebar
 *   declines its own takeover whenever its built-in editor tab is disabled,
 *   letting opens fall through to the Host OS opener (`spawn xdg-open
 *   ENOENT`); this wrapper keeps them landing in the VSCode tab regardless.
 *
 * The reroute lands as: `openTab({ type: TAB_ID, path })` — a CONTENT seed,
 * so better-sidebar's own "land in sight" logic expands the hosting panel,
 * and the single-instance descriptor focuses an already-open tab — followed
 * by `updateTab(TAB_ID, { meta })` carrying an `openRequest` the VscodeView
 * consumes (meta is the documented cross-tab vehicle; a single-instance
 * focus never applies seed fields, hence the explicit update).
 *
 * Dependency-free by design (mirrors better-sidebar's openpath-intercept.ts)
 * so the takeover logic is unit-testable in isolation.
 *
 * @module dsh-sidebar-vscode/client/openIntercept
 */
/** The open-tab seed shape the reroute sends (structural subset of OpenTabSeed). */
export interface OpenTabSeed {
    type: string;
    title?: string;
    path?: string;
    id?: string;
    url?: string;
    meta?: unknown;
}
/** The betterSidebar service slice the reroute driver (below) touches. */
export interface InterceptServiceFace {
    openTab(seed: OpenTabSeed): void;
    isTabEnabled(id: string): boolean;
    updateTab(tabId: string, patch: {
        title?: string;
        path?: string;
        meta?: unknown;
    }): void;
    getSnapshot(): {
        sessionId?: string | undefined;
        state?: unknown;
    };
}
/**
 * Per-call decisions the wrappers need (wired to the switch + service).
 */
export interface OpenInterceptDeps {
    /**
     * Whether to take over THIS call: the `openAsDefault` switch (the same
     * switch that seeds new sessions with the VSCode tab) must be on and the
     * VSCode tab type enabled. A declining call falls through untouched.
     */
    takeoverEnabled(): boolean;
    /** Route the open into the VSCode tab (open + meta update). */
    reroute(path: string): void;
}
/** One file-open request carried on the VSCode tab's meta. */
export interface OpenRequest {
    /** Monotonic id; consumers only act on values greater than the last one seen. */
    nonce: number;
    /** The DSH-side absolute path to open. */
    path: string;
    /** Optional 1-based cursor position (reserved; produced chips are path-only). */
    line?: number;
    column?: number;
}
/**
 * Structurally read the openRequest off a tab meta. Returns null for absent
 * or malformed shapes — a foreign meta (another plugin's, or a hand-edited
 * layout) must never crash the consumer.
 */
export declare function extractOpenRequest(meta: unknown): OpenRequest | null;
/**
 * Merge one openRequest into an existing tab meta, preserving sibling keys
 * (any other plugin-owned fields on the same meta object survive verbatim).
 */
export declare function mergeOpenRequest(meta: unknown, request: OpenRequest): Record<string, unknown>;
/**
 * Mint the next nonce: wall-clock based so sequences survive reloads, but
 * strictly monotonic within a page (two clicks in the same millisecond must
 * still produce increasing values, or the second would be swallowed).
 */
export declare function nextNonce(now?: () => number): number;
/**
 * Find one tab's meta in a sidebar state (both trees — splits and
 * bottomSplits — are searched). Structural and throw-free: a malformed state
 * simply yields undefined, and `updateTab` on a missing tab is a documented
 * no-op, so a walk failure can never break the reroute.
 */
export declare function findTabMeta(state: unknown, tabId: string): unknown;
/** Whether a path is absolute (POSIX root, drive letter, or UNC share). */
export declare function isAbsoluteLike(path: string): boolean;
/**
 * Resolve a (possibly relative) path against the session cwd. The two seams
 * differ here: `workspaces.openPath` callers already resolve to absolute
 * (ui-conversation's apply.ts does), while turn-tail produced paths come
 * straight from tool callView `locations` and may be workspace-relative —
 * better-sidebar's own `openSidebarFile` resolves them against the session
 * cwd the same way. Mirrors its `resolveSidebarPath` semantics.
 */
export declare function resolveAgainst(cwd: string | undefined, path: string): string;
/**
 * The reroute driver both seams share: land the VSCode tab (content seed →
 * panel auto-expansion + single-instance focus) and stamp the openRequest
 * meta. The `openTab` call lands on the real service untouched — neither
 * seam wraps openTab (option I was rolled back), and the openPath wrapper
 * is not on this path.
 */
export declare function rerouteChatOpen(service: InterceptServiceFace, tabId: string, path: string): void;
/** The client workspaces service slice the wrapper replaces (runtime IWorkspaces mirror). */
export interface WorkspacesLike {
    openPath(path: string): Promise<void>;
}
/**
 * Wrap `workspaces.openPath` — the client runtime's chat file-open funnel —
 * with the SAME takeover gate and reroute as the turn-tail claim (option II).
 *
 * Why this second seam is needed: better-sidebar declines BOTH of its own
 * interceptions whenever its built-in editor tab is disabled in the side
 * card settings (`tabsEnabled['editor'] === false` gates the turn-tail row
 * AND its openPath wrapper — see its intercept.tsx). The open then falls
 * through to the Host OS opener, which on a headless container dies with
 * `spawn xdg-open ENOENT`. Wrapping openPath here keeps chat file opens
 * landing in the VSCode tab even when the user disabled better-sidebar's
 * Files tab (a natural pairing: files belong in VS Code, not the built-in
 * editor).
 *
 * Fail-soft at the seam like wrapSettingsOpenDocument: a workspaces
 * service without a callable `openPath` member (a runtime whose mirror
 * carries a different shape) installs nothing — the funnel keeps its
 * stock behavior and the plugin still activates.
 *
 * Chain-safety: better-sidebar wraps the same method with the identical
 * RAW-reference restore contract, so the two wrappers compose in any
 * install/dispose order. With both active and the switch on, THIS wrapper
 * (installed later, runs first) intercepts and the call never reaches
 * better-sidebar's — same destination either way.
 *
 * @param workspaces - the client workspaces service to wrap.
 * @param deps - per-call takeover decisions (the same gate as the turn-tail claim's).
 * @returns the disposer restoring the original method (HMR-safe).
 */
export declare function wrapWorkspacesOpenPath(workspaces: WorkspacesLike, deps: OpenInterceptDeps): () => void;
/**
 * Redefine one gateway-namespace method with a per-access replacement.
 *
 * The gateway's client projection mounts Remote namespace methods
 * (`remote.<ns>.<method>`) as configurable, getter-only own properties — no
 * setter, so plain assignment throws — and every getter access returns a
 * FRESH invocation closure resolved against the live mount. This helper
 * redefines the property with its own getter that re-invokes the original
 * getter on every access and hands the yielded closure through
 * `makeInterceptor`, so each caller still resolves a fresh chain against the
 * live mount — exactly the stock semantics.
 *
 * The disposer restores the saved descriptor, but only while OUR getter is
 * still the installed one: the gateway deletes the property when it unmounts
 * the method and re-creates it on remount, and clobbering either state with
 * the saved (stale) descriptor would resurrect a dead mount.
 *
 * Fail-soft at the seam: a target carrying no such own property, a non-getter
 * descriptor (a plain value method — a foreign runtime shape), or a getter
 * that does not yield a callable installs nothing.
 *
 * @param target - the namespace service object (or any face carrying the method).
 * @param method - the own property name to redefine.
 * @param makeInterceptor - wraps one original closure; invoked once per
 * property access, so the interceptor never holds a stale mount.
 * @returns the disposer restoring the original descriptor (HMR-safe).
 */
export declare function redefineGetterMethod<Original extends (...args: never[]) => unknown>(target: object, method: string, makeInterceptor: (original: Original) => Original): () => void;
/**
 * The funnel's result faces (structural subset of the runtime's `RemoteResult`:
 * `{ ok: true, value } | { ok: false, error }`).
 */
export type RemoteOpenResult = {
    ok: true;
    value: {
        opened: true;
    };
} | {
    ok: false;
    error: Error;
};
/**
 * The remote session namespace slice the wrapper replaces. `openWorkspacePath`
 * is optional because the seam is fail-soft: a namespace without the mounted
 * method (older runtime, method unmounted) installs nothing.
 */
export interface RemoteSessionLike {
    openWorkspacePath?(request: {
        readonly path: string;
    }, signal?: AbortSignal): Promise<RemoteOpenResult>;
}
/**
 * Wrap `remote.session.openWorkspacePath` — the chat file-open funnel of the
 * gateway-era client runtime — with the SAME takeover gate and reroute as the
 * legacy `workspaces.openPath` wrapper above.
 *
 * Why this seam exists: the runtime that replaced `workspaces.openPath` routes
 * every chat-side file open through the `session/openWorkspacePath` Host
 * Remote (ui-chat's injected `openFile` — the Read/Write/... tool-row path
 * links and prose file mentions — is its only production caller), which drives
 * the Host's native opener (`xdg-open` — dead on a headless container). The
 * service now owning the `workspaces` key (the workspace controller) carries
 * no opener at all, so the legacy wrapper above installs nothing there and
 * this seam takes over instead. On the pre-gateway runtime the reverse holds:
 * this wrapper is never installed (the namespace service never appears) and
 * the legacy one keeps the takeover.
 *
 * Mechanics (property redefinition, per-access original, restore-only-ours)
 * live in {@link redefineGetterMethod}; fail-soft at the seam like
 * wrapWorkspacesOpenPath: a service carrying no such property (method not
 * mounted, or a runtime whose namespace shape differs) installs nothing and
 * the funnel keeps its stock behavior.
 *
 * @param session - the remote session namespace service to wrap.
 * @param deps - per-call takeover decisions (the same gate as the turn-tail claim's).
 * @returns the disposer restoring the original property descriptor (HMR-safe).
 */
export declare function wrapRemoteOpenWorkspacePath(session: RemoteSessionLike, deps: OpenInterceptDeps): () => void;
