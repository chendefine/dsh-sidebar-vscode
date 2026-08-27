/**
 * The settings-page takeover seam: a wrapper around
 * `connection.api.settings.openDocument` — the wire method behind the
 * settings page's「打开配置文件」button — so the click lands the
 * configuration file inside the embedded VS Code instead of the Host OS
 * opener.
 *
 * Why this seam exists: the stock button asks the Host to hand
 * `$DSH_HOME/settings.yaml` to the platform opener (macOS: a text editor;
 * Linux: the desktop file association — `spawn xdg-open ENOENT` on the
 * headless containers DSH typically runs in). The method's contract
 * deliberately carries no path, so the browser cannot choose a Host target;
 * this plugin instead resolves the document through its OWN fenced node-half
 * route (`settings.document`, see src/client/openChannelApi.ts) and reroutes
 * the open exactly like the chat-side seams (options II + III in
 * openIntercept.ts): land/focus the VSCode tab and stamp an openRequest its
 * component consumes. Since dc70396 an absolute path needs no mapping-rule
 * match (mapPathForOpen passes unmatched paths through), so the home-side
 * settings.yaml opens as-is in the default same-container topology.
 *
 * Fail-soft by construction: the wrapper declines (gate off, settings
 * provider absent, node half not reloaded yet, any transport error) by
 * calling the untouched original — the button never breaks because of this
 * plugin, it merely keeps its stock behavior.
 *
 * Dependency-free by design (mirrors openIntercept.ts's wrappers) so the
 * takeover logic is unit-testable in isolation.
 *
 * @module dsh-sidebar-vscode/client/settingsTakeover
 */
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
    /** Route the open into the VSCode tab (open + meta update). */
    reroute(path: string): void;
    /**
     * Close the host settings dialog after a successful reroute (optional —
     * absent wiring simply keeps the dialog open). Wired to
     * {@link closeSettingsDialog} in index.tsx.
     */
    closeDialog?(): void;
}
/**
 * Wrap `connection.api.settings.openDocument` with the settings-button
 * takeover.
 *
 * Chain-safety: the disposer restores the RAW original reference (the same
 * contract as wrapWorkspacesOpenPath), so this wrapper composes with any
 * other patch of the same member in any install/dispose order, and HMR
 * re-apply cannot strand a stale closure.
 *
 * @param api - the client connection's settings API member (mutated in place).
 * @param deps - per-call takeover decisions (the same gate as the chat seams').
 * @returns the disposer restoring the original method.
 */
export declare function wrapSettingsOpenDocument(api: {
    settings: SettingsApiLike;
}, deps: SettingsTakeoverDeps): () => void;
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
 * semantics: the listener exists only while the dialog is open, so this can
 * never close anything else, and an already-closed dialog makes it a no-op.
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
