/**
 * The same-origin VS Code reverse proxy: mounts a `code serve-web`
 * instance under the DSH web port itself (`/sidebar/vscode`), so the
 * embedded workbench iframe is same-origin with the DSH shell without any
 * external gateway — keeping the clipboard signal bridge intact on
 * gateway-less deployments (Windows, LAN).
 *
 * Upstream selection, in priority order:
 *
 * 1. **The `serverUrl` setting carrying a full URL** (pushed by the
 *    browser half through the fenced `/sidebar-vscode/api/proxy.config`
 *    route — `configure()`): exactly what `code serve-web` printed,
 *    origin + base path + query (the `?tkn=` token) included. The query
 *    is appended to every proxied HTTP request (serve-web checks the
 *    token on requests only — its `handleUpgrade` ignores it).
 * 2. `DSH_SIDEBAR_VSCODE_UPSTREAM` (`off`-like sentinels disable; a full
 *    URL, default `http://127.0.0.1:8000` — a bare local serve-web).
 *
 * Path mapping: the workbench bakes `serverBasePath` (from serve-web's own
 * `--server-base-path`) into every absolute URL it renders, and connects
 * its WebSocket at `<serverBasePath>/<quality>-<commit>`. The probe reads
 * that baked base from the index HTML and RECONCILES the routing to it —
 * the URL names the entry point, the HTML names the routing (a `/vscode`
 * server answers `/` with the same `/vscode`-rooted page). For the
 * resulting base path `P` the proxy registers:
 *
 * - the mount `/sidebar/vscode` rewriting `/sidebar/vscode<rest>` →
 *   `P<rest>` (the page URL, bookmarks, the iframe target);
 * - an identity mirror at `P` itself when `P` is neither `/` (the SPA
 *   owns the root) nor the mount;
 * - a discovered shim at `/<quality>-<commit>` when `P` is `/` (the
 *   root-absolute resource URLs);
 * - one exact upgrade route at `P/<quality>-<commit>` — the only path
 *   the browser socket factory ever connects to.
 *
 * The browser's `Host` header is kept verbatim, so serve-web bakes
 * `remoteAuthority` pointing at the DSH port and every workbench URL
 * (resources, callbacks, WebSocket) flows back through this proxy. The
 * index probe follows up to three redirects and adopts the final origin,
 * so an upstream behind a redirecting reverse proxy (e.g. an enforced
 * http→https hop) still discovers — and forwards — correctly.
 *
 * The `<quality>-<commit>` prefix is re-discovered (throttled) whenever
 * the workbench HTML itself is served — awaited on the first page load,
 * so a serve-web update swaps the routes before subresources fire.
 * Registration is probe-gated for the env source (a silent default claims
 * nothing) but immediate for the settings source (the user asked for this
 * upstream — an unreachable one answers honest 502s). `status()` reports
 * both shapes: `mounted` (routes claimed) and `serving` (probe succeeded
 * and every planned route is live — the only state the iframe may target
 * the mount in). A route owned by another plugin disables the feature
 * with a warning.
 *
 * @module dsh-sidebar-vscode/vscodeProxy
 */
/** Environment key overriding the proxy upstream (full URL, path/query ok). */
export declare const UPSTREAM_ENV = "DSH_SIDEBAR_VSCODE_UPSTREAM";
/**
 * Default upstream: a bare `code serve-web` on the local machine — the
 * CLI's own defaults (port 8000, root base path). Gateway deployments
 * pre-configure `DSH_SIDEBAR_VSCODE_UPSTREAM` (or set `serverUrl`) to
 * their real base-path URL instead.
 */
export declare const DEFAULT_UPSTREAM = "http://127.0.0.1:8000";
/** The subpath this proxy owns on the webserver (the browser-facing mount). */
export declare const PROXY_MOUNT = "/sidebar/vscode";
/** One parsed upstream: what `code serve-web` printed, structurally. */
export interface UpstreamConfig {
    /** `scheme://host[:port]` — the request target origin. */
    readonly origin: string;
    /** Base path serve-web runs under (`''` for `/`), no trailing slash. */
    readonly basePath: string;
    /** Every query pair of the pasted URL (the `tkn` token et al.), appended. */
    readonly extraQuery: readonly (readonly [string, string])[];
}
/** The structural cordis face this module touches (see index.ts's pattern). */
export interface ProxyPluginContext {
    effect(setup: () => (() => void) | void, label?: string): unknown;
    logger: {
        info(...args: unknown[]): void;
        warn(...args: unknown[]): void;
    };
}
/** The off-like sentinels that disable the proxy entirely. */
export declare function isDisabledValue(raw: string | undefined): boolean;
/**
 * Parse one upstream URL — the full address `code serve-web` prints, base
 * path and `?tkn=` token included. `http`/`https` with a host only; garbage,
 * other schemes, and credential-bearing URLs return null (the caller decides
 * what that means). Credentials are rejected rather than silently dropped:
 * they could never ride along transparently, and serve-web does not use them.
 */
export declare function parseUpstreamUrl(raw: string | undefined): UpstreamConfig | null;
/** One browser-prefix → upstream-base rewriting rule. */
export interface ProxyMount {
    /** Browser-side prefix this is registered under. */
    readonly prefix: string;
    /** Upstream base the remainder is appended to ('' = root). */
    readonly upstreamBase: string;
}
/**
 * The static (discovery-independent) mounts for one upstream: the
 * `/sidebar/vscode` rewrite mount, plus an identity mirror at the
 * upstream's own base path when that base is neither root (unmountable —
 * the SPA owns `/`) nor the mount itself.
 */
export declare function staticMounts(config: UpstreamConfig): readonly ProxyMount[];
/**
 * The exact browser path the workbench's WebSocket connects to for one
 * discovered `<quality>-<commit>`: the client joins the upstream's own
 * serverBasePath with the resource prefix — root upstreams connect at
 * `/<quality>-<commit>`, `/vscode` upstreams at `/vscode/<quality>-<commit>`.
 */
export declare function upgradePathFor(config: UpstreamConfig, qualityCommit: string): string;
/**
 * Map one browser request URL through the mounts: longest matching prefix
 * wins, the remainder is appended to the mount's upstream base, and the
 * upstream query pairs (the token) are appended unless already present.
 * Returns the upstream request target (path[?query]), or null when no
 * mount matches.
 */
export declare function mapRequestUrl(rawUrl: string, mounts: readonly ProxyMount[], extraQuery: readonly (readonly [string, string])[]): string | null;
/**
 * Extract the workbench resource prefix (`<quality>-<commit>`, e.g.
 * `stable-08d4889f…`) from the serve-web index HTML: the first
 * `/<quality>-<40-hex>/` path segment any referenced resource carries.
 */
export declare function discoverResourcePrefix(html: string): string | null;
/**
 * Extract the `serverBasePath` serve-web baked into the index HTML (the
 * workbench's own absolute URLs are all rooted there — ground truth for
 * routing, whatever path the probe URL carried). Accepts both the plain
 * JSON spelling and the `&quot;`-escaped `data-settings` attribute form;
 * root servers bake `/` or nothing — normalized to ''.
 */
export declare function discoverServerBasePath(html: string): string;
/** One fetched index page: the HTML plus the origin it finally came from. */
export interface FetchedIndex {
    /** The index HTML (capped, decoded as UTF-8). */
    readonly html: string;
    /**
     * The origin of the FINAL response: a redirect to another origin (an
     * enforced http→https hop, a redirecting gateway) is adopted, matching
     * where the browser itself would end up — discovery AND forwarding use it.
     */
    readonly origin: string;
}
/** The live proxy handle the settings route drives. */
export interface VscodeProxyHandle {
    /**
     * Adopt (or, with null, drop) the settings-sourced upstream. The route's
     * already-fetched index may ride along as `seed` — discovery then reuses
     * it instead of refetching the page (one fetch, two uses).
     */
    configure(config: UpstreamConfig | null, seed?: FetchedIndex): void;
    /**
     * One bounded liveness probe against a candidate upstream: the fetched
     * index page, or null when unreachable (bad URL, refused, timed out).
     */
    probeUpstream(config: UpstreamConfig): Promise<FetchedIndex | null>;
    /**
     * Live mounting state — the browser half asks before choosing an iframe
     * base: `mounted` (the mount route is claimed) with the mount prefix,
     * plus `serving` (the last probe succeeded and every planned route is
     * live) — the workbench may target the mount only while serving, and a
     * direct fallback keeps polling `serving` to graduate late.
     */
    status(): {
        mounted: boolean;
        prefix: string | null;
        serving: boolean;
    };
    /** Resolves after the initial (env/default) activation probe. */
    readonly ready: Promise<boolean>;
}
/**
 * Install the `/vscode` proxy machinery on the webserver. Nothing is
 * claimed until an upstream is known (settings `configure()` or the
 * env/default probe loop); see the module doc for the routing plan.
 * @param ctx - host cordis context (structural face, see index.ts).
 */
export declare function createVscodeProxy(ctx: ProxyPluginContext): VscodeProxyHandle;
