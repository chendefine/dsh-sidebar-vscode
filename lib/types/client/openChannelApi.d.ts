/**
 * Client half of the extension command channel: the two same-origin fetches
 * the VSCode tab makes against THIS plugin's node-half routes
 * (`/sidebar-vscode/api/*`) to (a) probe whether the upgraded
 * `dsh.selection-reference` extension is alive in the embedded workbench and
 * (b) hand it one file-open command.
 *
 * The routes are fence-protected by the node half (same-origin GUI only),
 * same trust model as better-sidebar's `/sidebar/api`. Both helpers are
 * fail-soft: any error answers `false` / `undefined`, and the VscodeView
 * falls back to the URL-payload channel — a missing route (older host half
 * not reloaded yet) or a missing extension must degrade, never break.
 *
 * @module dsh-sidebar-vscode/client/openChannelApi
 */
/** The base path of this plugin's node-half routes. */
export declare const OPEN_CHANNEL_API = "/sidebar-vscode/api";
/** Structural face of fetch the helpers need (injectable for tests). */
export interface FetchLike {
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
/** One open command addressed to the extension serving `folder`. */
export interface OpenCommand {
    folder: string;
    path: string;
    nonce: number;
    line?: number;
    column?: number;
}
/** POST one JSON body and answer `{ok, value}` structurally; null on any failure. */
export declare function postJson(method: string, body: Record<string, unknown>, fetchLike: FetchLike): Promise<{
    ok: boolean;
    value: unknown;
} | null>;
export declare function probeCapability(folder: string, fetchLike?: FetchLike, now?: () => number): Promise<boolean>;
/** Test-only: drop the capability cache (each spec starts cold). */
export declare function resetCapabilityCache(): void;
/**
 * Hand one open command to the extension through the node half. Answers
 * whether the command was accepted (written to the spool the extension
 * polls) — delivery itself is asynchronous by design (the extension polls).
 */
export declare function sendOpenCommand(command: OpenCommand, fetchLike?: FetchLike): Promise<boolean>;
/**
 * Locate the settings provider's local document through this plugin's node
 * half (`settings.document`, same fenced route family as the open channel).
 * The stock `/api/settings.openDocument` deliberately never reveals the
 * Host path to the browser — this plugin's own route does, so the settings
 * button takeover can hand the file to the embedded VS Code instead of the
 * Host OS opener (which dies with `xdg-open ENOENT` on headless containers).
 *
 * Fail-soft like every helper here: an absent settings provider, a provider
 * without a local document, an older node half (route not reloaded yet), or
 * any transport error answers null and the caller falls back to the stock
 * open behavior.
 */
export declare function fetchSettingsDocumentPath(fetchLike?: FetchLike): Promise<string | null>;
