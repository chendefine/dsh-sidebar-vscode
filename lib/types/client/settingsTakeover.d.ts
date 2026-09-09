/**
 * The settings-page takeover seam: a wrapper around the wire method behind
 * the settings page's「打开配置文件」button — the gateway-era
 * `remote.settings.openSettingsDocument` Host Remote, or the legacy
 * `connection.api.settings.openDocument` client-service member — so the
 * click lands the configuration file inside the embedded VS Code instead of
 * the Host OS opener.
 *
 * Why this seam exists: the stock button asks the Host to hand
 * `$DSH_HOME/settings.yaml` to the platform opener (macOS: a text editor;
 * Linux: the desktop file association — `spawn xdg-open ENOENT` on the
 * headless containers DSH typically runs in). The method's contract
 * deliberately carries no path, so the browser cannot choose a Host target;
 * this plugin instead resolves the document through its OWN fenced node-half
 * route (`settings.document`, see src/client/openChannelApi.ts) and reroutes
 * the open exactly like the chat-side seam (openIntercept.ts):
 * `sidebarRight.openTab('vscode', { params: { path } })` — the official
 * sidebar reveals the workbench tab and hands it the navigation. An absolute
 * path needs no mapping-rule match (mapPathForOpen passes unmatched paths
 * through), so the home-side settings.yaml opens as-is in the default
 * same-container topology.
 *
 * Fail-soft by construction: the wrapper declines (gate off, settings
 * provider absent, node half not reloaded yet, any transport error) by
 * calling the untouched original — and a page whose runtime carries neither
 * seam (no `remote.settings` namespace, no `api.settings.openDocument`
 * member) gets no wrapper installed at all (see wrapSettingsOpenDocument /
 * wrapRemoteOpenSettingsDocument) — the button never breaks because of this
 * plugin, it merely keeps its stock behavior.
 *
 * Dependency-free by design (mirrors openIntercept.ts's wrapper) so the
 * takeover logic is unit-testable in isolation.
 *
 * @module dsh-sidebar-vscode/client/settingsTakeover
 */
/**
 * Redefine one gateway-namespace method with an intercepting replacement,
 * chaining onto WHATEVER property shape is installed.
 *
 * Two shapes reach this seam, and both must compose:
 *
 * - the gateway's own mount (`remote.<ns>.<method>`): configurable,
 *   getter-only own properties — no setter, so plain assignment throws —
 *   where every getter access returns a FRESH invocation closure resolved
 *   against the live mount. This helper redefines the property with its own
 *   getter that re-invokes the original getter on every access and hands the
 *   yielded closure through `makeInterceptor`, so each caller still resolves
 *   a fresh chain against the live mount — exactly the stock semantics.
 * - a peer's VALUE-property shadow: another plugin wrapping the same seam
 *   by capturing the current closure and redefining the property as
 *   `{ writable: true, value: wrapped }` — a plain function, no getter. A
 *   getter-only redefinition cannot chain onto that (the descriptor has no
 *   `get`), so here the captured `descriptor.value` plays the original: the
 *   interceptor wraps it and is installed as a value property again, so
 *   whichever plugin installs LATER sits outermost and sees each call first.
 *
 * The disposer restores the saved descriptor, but only while OUR replacement
 * is still the installed one: the gateway deletes the property when it
 * unmounts the method and re-creates it on remount, and clobbering either
 * state with the saved (stale) descriptor would resurrect a dead mount.
 *
 * Fail-soft at the seam: a target carrying no such own property, a descriptor
 * whose getter does not yield a callable, or a value that is not a function
 * installs nothing.
 *
 * @param target - the namespace service object (or any face carrying the method).
 * @param method - the own property name to redefine.
 * @param makeInterceptor - wraps one original closure; on the getter path it
 * is invoked once per property access (the interceptor never holds a stale
 * mount), on the value path once at install.
 * @returns the disposer restoring the original descriptor (HMR-safe).
 */
export declare function redefineGetterMethod<Original extends (...args: never[]) => unknown>(target: object, method: string, makeInterceptor: (original: Original) => Original): () => void;
/**
 * Structural answer shape of `settings.openDocument` the wrapper must
 * satisfy on the takeover path (the minimal subset its only production
 * caller — SettingsDocumentStore.open — reads: `result.ok`).
 */
export interface SettingsOpenResponse {
    rpcId: unknown;
    result: {
        ok: boolean;
        value?: unknown;
        error?: unknown;
    };
}
/** Structural signature of the settings.openDocument member. */
export interface SettingsOpenDocumentFace {
    (payload: unknown, signal?: AbortSignal): Promise<SettingsOpenResponse>;
}
/** The connection.api.settings slice the wrapper replaces. */
export interface SettingsApiLike {
    openDocument: SettingsOpenDocumentFace;
}
/** Per-call decisions the wrapper needs (wired to the switch + service). */
export interface SettingsTakeoverDeps {
    /**
     * Whether to take over THIS call: the same gate as the chat-open seams —
     * the `openAsDefault` switch on AND the VSCode tab type enabled. A
     * declining call falls through to the stock Host opener untouched.
     */
    takeoverEnabled(): boolean;
    /**
     * Resolve the settings document's Host-side absolute path (this plugin's
     * `settings.document` route). null/empty means "cannot locate" and the
     * call falls back to the stock behavior.
     */
    resolvePath(): Promise<string | null>;
    /** Route the open into the workbench tab (openTab + navigation params). */
    reroute(path: string): void;
    /**
     * Close the host settings dialog after a successful reroute (optional —
     * absent wiring simply keeps the dialog open). Wired to
     * {@link closeSettingsDialog} in index.tsx.
     */
    closeDialog?(): void;
}
export declare function wrapSettingsOpenDocument(api: {
    settings?: SettingsApiLike | undefined;
} | undefined, deps: SettingsTakeoverDeps): () => void;
/**
 * The funnel's result faces (structural subset of the runtime's
 * `RemoteResult`: `{ ok: true, value } | { ok: false, error }` — the only
 * production caller, SettingsDocumentStore.open, reads `result.ok` and, on
 * failure, `result.error.message`).
 */
export type RemoteSettingsOpenResult = {
    ok: true;
    value: {
        opened: true;
    };
} | {
    ok: false;
    error: Error;
};
/**
 * The remote settings namespace slice the wrapper replaces.
 * `openSettingsDocument` is optional because the seam is fail-soft: a
 * namespace without the mounted method (older runtime, method unmounted)
 * installs nothing.
 */
export interface RemoteSettingsLike {
    openSettingsDocument?(signal?: AbortSignal): Promise<RemoteSettingsOpenResult>;
}
/**
 * Wrap `remote.settings.openSettingsDocument` — the settings-document funnel
 * of the gateway-era client runtime — with the SAME takeover gate and
 * reroute as the legacy `connection.api.settings.openDocument` wrapper above.
 *
 * Why this seam exists: the runtime that retired `connection.api` routes the
 * button through the `settings/openSettingsDocument` Host Remote
 * (SettingsDocumentStore.open is its only production caller), which hands the
 * materialized document to the Host's native opener (`xdg-open` — dead on a
 * headless container). The legacy wrapper above therefore installs nothing on
 * this runtime; on the pre-gateway runtime the reverse holds — the
 * `remote.settings` namespace never appears and the legacy member keeps the
 * takeover. Exactly one of the two ever intercepts.
 *
 * Mechanics (property redefinition of the gateway's getter-only namespace
 * methods, per-access original, restore-only-ours) live in
 * `redefineGetterMethod` (openIntercept.ts). A taken-over call resolves with
 * the native receipt's success shape so the button's busy state clears
 * without surfacing the Host opener's failure.
 *
 * @param settings - the remote settings namespace service to wrap.
 * @param deps - per-call takeover decisions (the same gate as the chat seams').
 * @returns the disposer restoring the original property descriptor (HMR-safe).
 */
export declare function wrapRemoteOpenSettingsDocument(settings: RemoteSettingsLike, deps: SettingsTakeoverDeps): () => void;
/** Structural document face the dialog close needs (dispatch only). */
export interface DocumentDispatchFace {
    dispatchEvent(event: unknown): boolean;
}
/**
 * Close the host settings dialog after a taken-over open.
 *
 * The settings shell keeps its open state component-local — no service or
 * store exposes a close — but its modal panel mounts a document-level
 * Escape listener whose lifetime is exactly the panel's (see
 * SettingsRoot.tsx's SettingsPanel). A synthetic Escape keydown is therefore
 * the one externally reachable close path, and it rides the dialog's own
 * semantics: the listener exists only while the dialog is open, so this
 * cannot close anything through the settings shell itself, and an
 * already-closed dialog makes it a no-op. (A synthetic document-level
 * Escape is not scoped, though: any OTHER concurrently-mounted
 * document/window-level Escape listener receives it too — a stacked
 * overlay inside the settings dialog would close along with it; the
 * settings modal excludes other overlays in practice.)
 *
 * Fail-soft like everything here: environments without a constructible
 * KeyboardEvent (or any dispatch failure) simply leave the dialog open.
 *
 * @param doc - the document to dispatch on (the page global by default).
 * @param makeEvent - the event factory (injectable for tests).
 */
export declare function closeSettingsDialog(doc?: DocumentDispatchFace | undefined, makeEvent?: (type: 'keydown', init: {
    key: string;
    bubbles: boolean;
}) => unknown): void;
