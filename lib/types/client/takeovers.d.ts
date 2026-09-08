/**
 * The takeover family's installation: every seam that reroutes a
 * host-side file open into the embedded VS Code workbench, wired through
 * ONE gate and ONE decision core instead of four hand-rolled copies.
 *
 * The seams (research options II + III + IV), all behind the same
 * `openAsDefault` switch and the same open blocklist:
 *
 * - **Option II — the turn-tail slot** (`turnTail.tsx` + `producedFiles.ts`):
 *   the produced-files row (the "changed files" chips) is claimed at
 *   priority -2, before dsh-better-sidebar's own -1 entry, so its chips
 *   open the files in the VSCode tab. A decline (switch off / tab
 *   disabled / nothing produced) falls through to its row unchanged.
 * - **Option III — the chat file-open funnels**: exactly one era-specific
 *   seam ever installs — the gateway-era runtime routes every chat-side
 *   open (tool-row path links, prose mentions) through the
 *   `remote.session.openWorkspacePath` Host Remote (reached through a
 *   NESTED inject that parks until the namespace exists; ui-chat's
 *   injected `openFile` is its only production caller); the pre-gateway
 *   runtime through the `workspaces.openPath` client service. Wrapping
 *   them also repairs the headless hole: better-sidebar declines its own
 *   takeover when its built-in Files tab is disabled, letting opens die
 *   on the Host OS opener (`spawn xdg-open ENOENT`).
 * - **Option IV — the settings open-document button** (`settingsTakeover.ts`):
 *   the settings page's「打开配置文件」click resolves the document through
 *   this plugin's own fenced node-half route and opens it in the VSCode
 *   tab, closing the settings dialog behind it. Two era-specific seams
 *   again (`remote.settings.openSettingsDocument` vs the legacy
 *   `connection.api.settings.openDocument`); exactly one ever intercepts.
 *
 * Cross-cutting wiring that lives HERE so no seam carries its own copy:
 *
 * - the gate: `takeoverEnabled` = the switch is on AND the VSCode tab
 *   type enabled (evaluated per call, so flipping the switch applies to
 *   the very next click);
 * - the open blocklist (`openBlocklist.ts`), read per call: a file type
 *   the code editor renders poorly (Office/image/PDF …) declines the
 *   VSCode reroute and opens in better-sidebar's built-in Files tab
 *   instead — the stock Host opener only when that tab type is disabled;
 * - session addressing: every reroute is stamped with the session whose
 *   workbench it targets, and cwd resolution for workspace-relative
 *   produced paths;
 * - peer interop: dsh-better-sidebar ≥ 0.18.0 shadows the same
 *   `openWorkspacePath` method with a value-property wrapper of its own,
 *   and a peer disable/enable cycle can re-run its shadow AFTER this
 *   install — the one-shot re-assert a few seconds in restores the
 *   outermost slot with no polling (an undisplaced wrap just chains a
 *   harmless extra layer).
 *
 * @module dsh-sidebar-vscode/client/takeovers
 */
import { type InterceptServiceFace } from './openIntercept.ts';
import { type TurnTailSlotsFace } from './turnTail.tsx';
import { type SettingsApiLike } from './settingsTakeover.ts';
/** The sessions slice the reroute's cwd resolution reads. */
interface TakeoverSessionsFace {
    list?: {
        getSnapshot(): {
            current?: string;
            byId?: Record<string, {
                cwd?: string;
            } | undefined>;
        };
    };
}
/** The structural context face the installation touches. */
export interface TakeoverClientFace {
    slots: TurnTailSlotsFace;
    sessions?: TakeoverSessionsFace;
    /**
     * Nested service injection (cordis `ctx.inject`): parks a child fiber
     * until every named service exists, runs the body with a scope that may
     * read them, and honors the body's returned disposer on service withdraw
     * or plugin unload. Optional so the body can park on services the OLD
     * runtime never provides without blocking activation — the fail-soft
     * contract of every takeover seam.
     */
    inject?(deps: readonly string[], body: (scope: {
        get(name: string): unknown;
    }) => (() => void) | void): unknown;
    /** The client workspaces service (runtime IWorkspaces mirror — openPath only). */
    workspaces?: {
        openPath(path: string): Promise<void>;
    };
    /** The connection service (the legacy settings.openDocument seam's target). */
    connection?: {
        api?: {
            settings?: SettingsApiLike;
        };
    };
}
/**
 * The betterSidebar service slice the installation touches: the reroute
 * driver's face plus the prefs snapshot the settings reads need (the
 * pluginSettings blob lives in the same store).
 */
export interface TakeoverSidebarFace extends InterceptServiceFace {
    getSnapshot(): {
        sessionId?: string | undefined;
        state?: unknown;
        prefs: {
            pluginSettings: Record<string, Record<string, unknown>>;
        };
    };
    /** Monotonic capability list ('tabMeta' / 'updateTab' gate the takeover
     * whenever the peer publishes the list — every better-sidebar in the
     * declared ≥0.12 range does). */
    readonly features?: readonly string[];
}
/**
 * Install every takeover seam behind one gate. Fail-soft at each layer: a
 * better-sidebar without the tabMeta/updateTab capabilities keeps every
 * seam off (the stock behavior stands), and each era-specific seam simply
 * never installs on a runtime that does not provide its service.
 *
 * @param client - the client context face (slots, sessions, era services).
 * @param betterSidebar - the sidebar service face (gate + reroute driver).
 * @returns the disposer unwinding every installed seam (HMR-safe).
 */
export declare function installTakeovers(client: TakeoverClientFace, betterSidebar: TakeoverSidebarFace): () => void;
export {};
