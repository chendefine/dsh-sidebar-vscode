/**
 * `dsh-sidebar-vscode`, node half: the vscode-selection context boundary,
 * the extension command channel's fenced routes, and the same-origin VS
 * Code reverse proxy.
 *
 * Everything UI-shaped (the official right-Sidebar `vscode` tab, the
 * composer chips, the reference rail, the chat-open interception, the
 * configuration card) lives in the browser half. This half owns:
 *
 * - the model-facing seam: for every live agent it listens at
 *   `agent/pre-step`, expands canonical `dsh-vscode:` (editor selections)
 *   and `dsh-vscode-res:` (explorer file/folder) mentions in the claimed
 *   user messages into readable labels plus bounded `<text-selection>`
 *   context messages sourced `{ kind: 'vscode-mention', … }` — or, for
 *   resources, content-less `<file-selection>`/`<folder-selection>`
 *   markers sourced `{ kind: 'vscode-resource', … }` (see `src/mention.ts`);
 *
 * - the plugin's `Config` schema (`src/config.ts`): the settings service
 *   derives the `dsh-sidebar-vscode` configuration page from it (every
 *   volatile field editable live, committed edits pushed into the
 *   running references without a remount) — the static `Config` export
 *   below IS the registration, no service inject needed;
 *
 * - the fenced route family under `/sidebar-vscode/api/*`, dispatched
 *   through one method table (METHODS below): the open-channel probes and
 *   commands (`open.capability` / `open.request` / `open.embedded`), the
 *   boot gate pair (`boot.begin` / `boot.status`) that gates the iframe
 *   reveal on the extension's post-reconcile boot receipt, the proxy
 *   control plane (`proxy.config` / `proxy.status`), and the settings
 *   document locator (`settings.document`) for the browser-half takeover
 *   of the settings page's「打开配置文件」button — all behind the same
 *   browser-trust fence as every other plugin route;
 *
 * - the same-origin VS Code reverse proxy (see `src/vscodeProxy.ts`),
 *   mounted at `/sidebar/vscode`: an HTTP prefix route plus the discovered
 *   WebSocket upgrade path, so gateway-less deployments (Windows, LAN)
 *   still get a same-origin workbench iframe. `/sidebar-vscode/api/
 *   proxy.config` lets the browser half push the `serverUrl` setting (a
 *   full serve-web URL, base path + token) as the proxy's upstream, with a
 *   bounded reachability probe in the answer; `proxy.status` reports the
 *   live mounting state for the iframe-base choice.
 *
 * @module dsh-sidebar-vscode
 */
import type { Context } from '@deepseek-ai/cordis';
import type { VscodeSidebarPluginConfig } from './config.ts';
/** Cordis plugin name (the Loader entry; matches the client bundle id). */
export declare const name = "dsh-sidebar-vscode";
/**
 * The plugin's configuration schema — the one the loader resolves the
 * entry config through and the settings service derives this plugin's
 * configuration page from (its volatile fields, keyed by the entry id
 * `dsh-sidebar-vscode`); see `src/config.ts`.
 */
export { Config } from './config.ts';
export type { VscodeSidebarPluginConfig } from './config.ts';
/** Services required before load: the agent registry (agent/created
 * events), the webserver (command-channel routes), and the web runtime
 * (the trust fence's live trustedHosts). The settings section needs no
 * inject: the host's settings service derives it from this entry's
 * `Config` schema by entry id. */
export declare const inject: string[];
/**
 * Mount the vscode-selection pre-step boundary for every agent.
 * @param ctx - host cordis context.
 * @param config - the loader-resolved plugin config; every field is a
 * live volatile reference a settings commit updates in place. The Host
 * half consumes none of them (every consumer is browser-side, through
 * the shared config form), so the references are simply held.
 */
export declare function apply(ctx: Context, config: VscodeSidebarPluginConfig): void;
