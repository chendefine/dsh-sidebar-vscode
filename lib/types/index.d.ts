/**
 * `dsh-sidebar-vscode`, node half: the vscode-selection context boundary,
 * the extension command channel's fenced routes, and the same-origin
 * VS Code reverse proxy.
 *
 * Everything UI-shaped (the better-sidebar VS Code tab, the composer
 * chips, the reference rail, the chat-open interception) lives in the
 * browser half. This half owns:
 *
 * - the model-facing seam: for every live agent it listens at
 *   `agent/pre-step`, expands canonical `dsh-vscode:` (editor selections)
 *   and `dsh-vscode-res:` (explorer file/folder) mentions in the claimed
 *   user messages into readable labels plus bounded `<text-selection>`
 *   context messages sourced `{ kind: 'vscode-mention', … }` — or, for
 *   resources, content-less `<file-selection>`/`<folder-selection>`
 *   markers sourced `{ kind: 'vscode-resource', … }` (see `src/mention.ts`);
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
/** Cordis plugin name (the Loader entry; matches the client bundle id). */
export declare const name = "dsh-sidebar-vscode";
/** Services required before load: the agent registry (agent/created
 * events), the webserver (command-channel routes), and the web runtime
 * (the trust fence's live trustedHosts). */
export declare const inject: string[];
/**
 * Mount the vscode-selection pre-step boundary for every agent.
 * @param ctx - host cordis context.
 */
export declare function apply(ctx: Context): void;
