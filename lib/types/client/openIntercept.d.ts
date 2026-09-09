/**
 * The chat-open takeover of the OFFICIAL right Sidebar: one wrapper around
 * `ctx.sidebarRight.openResource` — the navigation controller's public
 * resource funnel — plus the local `dsh-resource://file/` address parser
 * the wrapper needs.
 *
 * Every chat-originated file open of the official runtime flows through
 * this ONE public seam: ui-chat's injected `openFile` (tool-row path
 * links, prose file mentions), the deliverables row's produced-files
 * chips, every future caller that hands the sidebar a file address. The
 * wrapper's gate decides per call:
 *
 * - the `openAsDefault` switch off, a non-file address, an unparseable
 *   one, a session-scoped address whose workspace root is not (yet)
 *   known, or a blocklisted path → the call falls through UNTOUCHED to
 *   the stock routing, where the official registry ranks its builtin
 *   viewers (the text preview claims file addresses at the `fallback`
 *   band — exactly the reroute the better-sidebar-era blocklist made
 *   into its own Files tab);
 * - otherwise the open is CLAIMED for the workbench: translated into
 *   `openTab('vscode', { params: { path, line? } })` on the same
 *   service, so the ONE workbench tab of the mounted session is revealed
 *   (the column expands in the same step — the official "content the
 *   user cannot see is not opened" rule) and the open lands inside the
 *   embedded VS Code through `tab.navigation.params`.
 *
 * Why a wrapper instead of a resource-viewer tab type: the registry's
 * identity rule would mint one tab per address, and each tab renders its
 * own body — a second workbench iframe racing the first re-opens VS
 * Code's IndexedDB and deadlocks (see bootLock.ts). One page tab, with
 * opens delivered as navigation params, is the shape the workbench needs.
 *
 * The wrapper is an own-property shadow on the service INSTANCE (the
 * methods live on the prototype; every `ctx.sidebarRight.openResource`
 * call site resolves the own property first), installed for the plugin's
 * lifetime and restored only while the shadow is still ours — the same
 * discipline the previous era's remote-namespace wrappers used.
 *
 * The parser below is a structural twin of the official
 * `parseFileAddress` (`@deepseek-ai/dsh-util-workspace-path`): the client
 * bundle may not value-import official packages (the tsdown purity gate),
 * so the documented grammar is re-implemented and unit-tested against
 * the same cases.
 *
 * @module dsh-sidebar-vscode/client/openIntercept
 */
/** One parsed `dsh-resource://file/…` address, in one of its two scopes. */
export type FileAddress = {
    readonly scope: 'session';
    /** The Session whose workspace root the path is relative to. */
    readonly sessionId: string;
    /** Workspace-relative `/`-separated path, no leading `/`; empty for the root itself. */
    readonly path: string;
} | {
    readonly scope: 'absolute';
    /** Absolute `/`-separated path: `/a/b` on POSIX, `C:/a/b` for a drive, `//server/share/a` for UNC. */
    readonly path: string;
};
/**
 * Read a file address back into its parts (the official grammar:
 * component-encoded segments, `:` literal for drive letters, a UNC
 * path's empty first segment preserved).
 * @param address - a candidate address.
 * @returns the parts, or `undefined` when the string is not a
 * `dsh-resource://file/` URI in a known scope with a path, or a segment
 * is not validly encoded.
 */
export declare function parseFileAddress(address: string): FileAddress | undefined;
/** Whether a path is absolute (POSIX root, drive letter, or UNC share). */
export declare function isAbsoluteLike(path: string): boolean;
/**
 * Resolve a (possibly relative) path against the session cwd — the join
 * the session-scope translation needs (the official `fileAddressFor`
 * folded this step into address construction; the takeover unfolds it
 * again on the way back).
 */
export declare function resolveAgainst(cwd: string | undefined, path: string): string;
/** The open options face the wrapper intercepts (structural subset). */
export interface OpenResourceOptionsLike {
    readonly kind?: string;
    readonly params?: unknown;
}
/** The navigation-controller face the wrapper installs onto (structural over `ISidebarRight`). */
export interface SidebarRightLike {
    openResource(address: string, options?: OpenResourceOptionsLike): void;
    openTab(kind: string, options?: {
        readonly params?: unknown;
    }): void;
}
/** Per-call decisions the wrapper needs (wired to the switch + settings). */
export interface OpenResourceInterceptDeps {
    /** Whether to take over THIS call: the `openAsDefault` switch, read live. */
    takeoverEnabled(): boolean;
    /**
     * The open blocklist verdict for one ABSOLUTE path: a blocked path
     * falls through to the stock routing (the official viewers' surface).
     */
    blocked(path: string): boolean;
    /**
     * The workspace root of one session (the cwd the session-scope address
     * resolves against). Undefined = unresolvable for now → fall through.
     */
    cwdOf(sessionId: string): string | undefined;
    /** The workbench tab kind to open (`VSCODE_KIND`). */
    kind: string;
}
/**
 * Wrap `ctx.sidebarRight.openResource` — the official sidebar's public
 * resource funnel — with the workbench takeover.
 *
 * Fail-soft at the seam: a service whose `openResource` does not resolve
 * to a function, or whose `openTab` does not, installs nothing (the stock
 * funnel stands). A claimed open that throws inside `openTab` also falls
 * back to the original — a stock open beats a lost one.
 *
 * @param service - the navigation controller instance (`ctx.sidebarRight`).
 * @param deps - per-call takeover decisions.
 * @returns the disposer removing the shadow while it is still ours
 * (HMR-safe; a later re-shadow by anyone else is left standing).
 */
export declare function wrapSidebarRightOpenResource(service: SidebarRightLike, deps: OpenResourceInterceptDeps): () => void;
