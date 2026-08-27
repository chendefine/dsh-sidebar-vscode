/**
 * `dsh-sidebar-vscode`, node half: the vscode-selection context boundary
 * plus the extension command channel's two fenced routes.
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
 * - `/sidebar-vscode/api/open.capability` + `/open.request`: the spool the
 *   embedded workbench's extension polls (see `src/openChannel.ts`), fenced
 *   by the same browser-trust rules as every other plugin route.
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
