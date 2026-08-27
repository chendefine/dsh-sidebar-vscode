/**
 * Pure path/URL logic for the VSCode tab: translating the DSH session cwd
 * into the embedded VS Code server's view of the same directory, and building
 * the iframe URL. No DOM, no React — unit-testable in isolation.
 *
 * Deployment assumption (this machine): the VS Code server (`code serve-web`)
 * runs INSIDE the dsh-runtime container itself, so the DSH session and the
 * embedded workbench see the very same filesystem under the very same paths:
 *
 *   DSH session (= VS Code server, one container)
 *   /data/workspace        (==)      /data/workspace
 *   /opt                   (==)      /opt
 *
 * so the built-in default is a pair of identity rules
 * `/data/workspace=/data/workspace;/opt=/opt` — pure pass-through markers for
 * the usual workspace roots. The rules act as PREFIX REWRITERS, not a
 * whitelist: a path no rule matches is not an error, it just reaches the
 * open channels unchanged ({@link mapPathForOpen}); only the workspace
 * FOLDER mapping treats it as unmappable ({@link mapPath}). The sidebar
 * settings row (`pathMap`) can override the rules, e.g. when the workbench
 * runs in a separate container with different mounts.
 *
 * @module dsh-sidebar-vscode/client/paths
 */
/** One parsed mapping rule (source prefix → destination prefix). */
export interface PathMapRule {
    from: string;
    to: string;
}
/** The built-in default mapping used when the setting is empty/invalid. */
export declare const DEFAULT_PATH_MAP = "/data/workspace=/data/workspace;/opt=/opt";
/** The built-in default VS Code server base URL (same-origin gateway subpath). */
export declare const DEFAULT_SERVER_URL = "/vscode";
/**
 * Parse the user-facing `pathMap` setting (`src=dst;src2=dst2`). Empty or
 * fully-malformed input falls back to {@link DEFAULT_PATH_MAP}. Malformed
 * single entries are skipped (the rest still apply). Rules are returned
 * longest-source-prefix first (stable among equals) so the most specific
 * rule wins in {@link mapPath}.
 */
export declare function parsePathMap(spec: string | undefined): readonly PathMapRule[];
/**
 * Map one DSH-side absolute path through the rules.
 *
 * Order: (1) the first rule (longest source prefix first) whose `from`
 * contains the path rewrites the prefix; (2) a path already sitting under
 * some rule's DESTINATION prefix passes through unchanged (the cwd was
 * already VS Code-side — prevents double-mapping); (3) otherwise `null`
 * (unmappable — the caller opens the base URL and shows a hint).
 */
export declare function mapPath(path: string, rules: readonly PathMapRule[]): string | null;
/**
 * Map one DSH-side path for a FILE OPEN: {@link mapPath} when a rule
 * matches, else the path itself passed through unchanged.
 *
 * Rationale: unmapped ≠ unopenable. DSH and the VS Code server share one
 * filesystem in the default same-container deployment, so any absolute
 * path the session can read the workbench can open; whether the file
 * actually exists is the open channel's call (the extension stats and
 * warns "file not found", the URL-payload channel lets VS Code report
 * it). Refusing the open client-side just because no rule matched — the
 * old behavior — turned perfectly readable out-of-map files (e.g.
 * `/app`, `/tmp`) into the「文件路径无法映射到 VSCode 容器」error.
 *
 * Returns null only for input nothing sensible can be done with: empty
 * or non-absolute paths (the open channels all address POSIX absolute
 * paths).
 */
export declare function mapPathForOpen(path: string, rules: readonly PathMapRule[]): string | null;
/**
 * The inverse of {@link mapPath}: translate one VS Code-server-side path
 * back into the DSH session's view of the same file (longest destination
 * prefix wins; a path already sitting under a SOURCE prefix is DSH-side
 * already and passes through). Used when a selection reference arrives from
 * the embedded VS Code and must name the file the way the DSH session (and
 * the agent's tools) see it.
 */
export declare function reverseMapPath(path: string, rules: readonly PathMapRule[]): string | null;
/**
 * Normalize the `serverUrl` setting into a usable base: empty → the
 * same-origin gateway subpath ({@link DEFAULT_SERVER_URL}); trailing slashes
 * dropped; a value with neither a URL scheme nor a leading '/' is treated as
 * a subpath and anchored to the page root.
 */
export declare function normalizeBaseUrl(raw: string | undefined): string;
/**
 * One file the degraded channel asks the workbench to open through VS Code
 * web's native `payload` query parameter (see {@link buildVscodeUrl}).
 */
export interface VscodeOpenFile {
    /** The VS Code-server-side absolute path to open. */
    file: string;
    /** The host the browser reaches the VS Code server through (`host[:port]`). */
    authority: string;
    /** Optional 1-based line to place the cursor on. */
    line?: number;
    /** Optional 1-based column to place the cursor on (requires `line`). */
    column?: number;
}
/**
 * Build the iframe target: the (scheme-absolute or same-origin relative)
 * VS Code workbench URL, with `?folder=` naming the mapped workspace
 * (the server opens that folder; `folder === null` opens its default).
 *
 * `open` (the degraded no-extension channel) rides VS Code web's native
 * `payload` query parameter — the same mechanism vscode.dev uses (per the
 * code-server FAQ: payload is upstream VS Code web behavior, no
 * server-specific config needed) — as a URL-encoded `[key, value]` pair
 * array: `gotoLineMode` makes a trailing `:line[:column]` suffix a cursor
 * position, and `openFile` takes a
 * `vscode-remote://<authority><absolute path>` URI where `<authority>` is
 * the host the browser reaches the server through. The payload is consumed
 * once at workbench startup, so this channel costs a full iframe reload —
 * the extension command channel is the primary path and this is its
 * fallback.
 */
export declare function buildVscodeUrl(base: string, folder: string | null, open?: VscodeOpenFile): string;
