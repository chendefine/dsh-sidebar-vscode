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
 * `/data/workspace=/data/workspace;/opt=/opt` — pure pass-through that still
 * whitelists the reachable workspace roots (anything else, e.g. `/tmp`, is
 * unmappable). The sidebar settings row (`pathMap`) can override the rules,
 * e.g. when the workbench runs in a separate container with different mounts.
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
 * Build the iframe target: the (scheme-absolute or same-origin relative)
 * VS Code workbench URL, with `?folder=` naming the mapped workspace
 * (the server opens that folder; `folder === null` opens its default).
 */
export declare function buildVscodeUrl(base: string, folder: string | null): string;
