/**
 * The workbench iframe-base resolver: which base URL the embedded VS Code
 * workbench opens at — the same-origin proxy mount (`/sidebar/vscode`)
 * whenever the host half's built-in reverse proxy is serving, the
 * configured direct URL otherwise, with a self-healing poll that
 * graduates a direct fallback to the mount once the proxy comes up.
 *
 * Extracted from the VscodeView render body as a controller so the whole
 * decision — the `proxy.config` push, the `proxy.status` ask, the reset
 * of a previously pushed upstream, the 5s graduation loop, and the
 * cancellation discipline — is one unit-testable object with injected
 * transport. The {@link useWorkbenchBase} hook is the thin React binding.
 *
 * Decision table (the base is decided by PROXY REACHABILITY ALONE —
 * `serverUrl` names the UPSTREAM and the fallback base):
 *
 * - a FULL URL (`http(s)://…`, base path and `?tkn=` token included) is
 *   pushed via `proxy.config`; reachable → mount; unreachable (a
 *   serve-web still warming up, a remote address) → the direct
 *   cross-origin iframe plus a notice, with the host still probing and
 *   the graduation loop watching for it to start serving;
 * - anything else (empty = the default local serve-web, or an explicit
 *   relative subpath with gateway semantics) is never pushed: any
 *   previously pushed upstream is RELEASED (`{reset:true}`), and the
 *   host's own proxy state picks the winner — serving → mount, else the
 *   subpath itself as a direct base.
 *
 * @module dsh-sidebar-vscode/client/workbenchBase
 */
/** The resolved base states; 'resolving' is the pre-answer state. */
export type WorkbenchBaseState = 'resolving' | 'mount' | 'direct';
/** The structural fetch face the controller needs (injectable for tests). */
export interface BaseFetchLike {
    (url: string, init: {
        method: string;
        headers: {
            'content-type': string;
        };
        body: string;
    }): Promise<{
        ok: boolean;
        json(): Promise<unknown>;
    }>;
}
/** The controller's outbound signals (one per state transition). */
export type WorkbenchBaseEmit = (state: WorkbenchBaseState, notice: 'proxyFallback' | undefined) => void;
/** The timer face the graduation loop needs (injectable for tests). */
export interface BaseTimers {
    setInterval(handler: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}
/**
 * One resolution attempt per `serverUrl` shape. `update` cancels the
 * previous attempt and starts a new one; `cancel` stops everything
 * (unmount). The controller remembers what THIS component pushed to the
 * host (the historical `pushedUrl` discipline): switching from a full
 * URL to a relative subpath must RELEASE the previously adopted upstream
 * before the status ask, or the ask would observe the stale one — and
 * the release is awaited first for exactly that reason.
 */
export declare class WorkbenchBaseController {
    private readonly emit;
    private readonly fetchLike;
    private readonly timers;
    private cancelled;
    private graduate;
    private pushedUrl;
    constructor(emit: WorkbenchBaseEmit, fetchLike?: BaseFetchLike, timers?: BaseTimers);
    /** POST one JSON body and answer `{ok, value}` structurally; null on failure. */
    private post;
    /** Whether the host's proxy reports itself serving (a mount candidate). */
    private serving;
    /** Start the graduation loop: poll until the host serves, then emit mount. */
    private watchServing;
    /**
     * Resolve the base for one `serverUrl` shape. Cancels any in-flight
     * resolution first; emits 'resolving' immediately, then
     * 'mount'/'direct' once the host answers (plus later 'mount'
     * graduations from the direct fallback's poll).
     *
     * @param effectiveServerUrl - the normalized setting value (empty =
     * DEFAULT_SERVER_URL applied by the caller).
     * @param fullUrl - whether the value is a full http(s) URL.
     */
    update(effectiveServerUrl: string, fullUrl: boolean): void;
    /** Stop the in-flight resolution (unmount / HMR). */
    cancel(): void;
}
/**
 * The React binding: resolves the iframe base for one `serverUrl` shape
 * and re-resolves whenever it changes. `onNotice` receives the
 * degradation notice key ('proxyFallback') at most once per resolution.
 * @returns the live base state.
 */
export declare function useWorkbenchBase(effectiveServerUrl: string, fullUrl: boolean, onNotice: (key: 'proxyFallback') => void): WorkbenchBaseState;
