/**
 * The same-origin VS Code reverse proxy: mounts a `code serve-web`
 * instance under the DSH web port itself (`/sidebar/vscode`), so the
 * embedded workbench iframe is same-origin with the DSH shell without any
 * external gateway — keeping the clipboard signal bridge intact on
 * gateway-less deployments (Windows, LAN).
 *
 * Both legs (the HTTP mount and the WebSocket upgrade route) sit behind
 * the same browser-trust fence as every other plugin route
 * (`isTrustedApiRequest`, see trust-fence.ts): the DSH page, its iframe,
 * and direct bookmark navigations pass; cross-site pages are refused —
 * WebSocket handshakes are not CORS-checked by browsers, and serve-web's
 * `handleUpgrade` ignores the connection token, so an unfenced upgrade
 * leg would be a cross-site-hijack tunnel into the workbench.
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

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { isTrustedApiRequest } from './trust-fence.ts'

/** Environment key overriding the proxy upstream (full URL, path/query ok). */
export const UPSTREAM_ENV = 'DSH_SIDEBAR_VSCODE_UPSTREAM'

/**
 * Default upstream: a bare `code serve-web` on the local machine — the
 * CLI's own defaults (port 8000, root base path). Gateway deployments
 * pre-configure `DSH_SIDEBAR_VSCODE_UPSTREAM` (or set `serverUrl`) to
 * their real base-path URL instead.
 */
export const DEFAULT_UPSTREAM = 'http://127.0.0.1:8000'

/** The subpath this proxy owns on the webserver (the browser-facing mount). */
export const PROXY_MOUNT = '/sidebar/vscode'

/** Probe cadence while the upstream has not answered yet. */
const PROBE_INTERVAL_MS = 10_000

/** Probe / reachability budget. */
const PROBE_TIMEOUT_MS = 3_000

/** Bounded wait the page-GET handler grants a pending discovery. */
const DISCOVERY_WAIT_MS = 2_000

/** Minimum spacing between HTML-triggered commit refreshes. */
const REFRESH_THROTTLE_MS = 30_000

/** Cap on the fetched index HTML (real pages are a few hundred KB). */
const INDEX_CAP_BYTES = 1 << 20

/** Redirect hops the index probe follows (a redirecting reverse proxy). */
const MAX_REDIRECTS = 3

/**
 * Time-to-headers budget for forwarded requests and upgrades: a hung
 * upstream answers 502 (or drops the socket) instead of pinning it.
 * Post-header streams are unlimited — the browser abort tears those down.
 */
const UPSTREAM_TIMEOUT_MS = 30_000

/** How many consecutive upgrade prefixes stay registered. */
const MAX_UPGRADE_ROUTES = 3

/** One parsed upstream: what `code serve-web` printed, structurally. */
export interface UpstreamConfig {
  /** `scheme://host[:port]` — the request target origin. */
  readonly origin: string
  /** Base path serve-web runs under (`''` for `/`), no trailing slash. */
  readonly basePath: string
  /** Every query pair of the pasted URL (the `tkn` token et al.), appended. */
  readonly extraQuery: readonly (readonly [string, string])[]
}

/** The structural cordis face this module touches (see index.ts's pattern). */
export interface ProxyPluginContext {
  effect(setup: () => (() => void) | void, label?: string): unknown
  logger: { info(...args: unknown[]): void, warn(...args: unknown[]): void }
}

/** The webserver face the proxy registers through. */
interface ProxyWebServerFace {
  register(route: {
    kind: 'prefix' | 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
  }): () => void
  registerUpgrade(route: {
    path: string
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void> | void
  }): () => void
}

/** The off-like sentinels that disable the proxy entirely. */
export function isDisabledValue(raw: string | undefined): boolean {
  const lowered = (raw ?? '').trim().toLowerCase()
  return lowered === 'off' || lowered === '0' || lowered === 'false' || lowered === 'disabled' || lowered === 'no'
}

/**
 * Parse one upstream URL — the full address `code serve-web` prints, base
 * path and `?tkn=` token included. `http`/`https` with a host only; garbage,
 * other schemes, and credential-bearing URLs return null (the caller decides
 * what that means). Credentials are rejected rather than silently dropped:
 * they could never ride along transparently, and serve-web does not use them.
 */
export function parseUpstreamUrl(raw: string | undefined): UpstreamConfig | null {
  const value = (raw ?? '').trim()
  if (value === '') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') return null
  if (url.username !== '' || url.password !== '') return null
  const port = url.port === '' ? '' : `:${url.port}`
  const basePath = url.pathname.replace(/\/+$/, '')
  const extraQuery = [...url.searchParams.entries()] as readonly (readonly [string, string])[]
  return { origin: `${url.protocol}//${url.hostname}${port}`, basePath, extraQuery }
}

/** Join a base path ('' = root) with a path that keeps its leading '/'. */
function joinUrl(base: string, rest: string): string {
  return base === '' ? rest : `${base}${rest}`
}

/** One browser-prefix → upstream-base rewriting rule. */
export interface ProxyMount {
  /** Browser-side prefix this is registered under. */
  readonly prefix: string
  /** Upstream base the remainder is appended to ('' = root). */
  readonly upstreamBase: string
}

/**
 * The static (discovery-independent) mounts for one upstream: the
 * `/sidebar/vscode` rewrite mount, plus an identity mirror at the
 * upstream's own base path when that base is neither root (unmountable —
 * the SPA owns `/`) nor the mount itself.
 */
export function staticMounts(config: UpstreamConfig): readonly ProxyMount[] {
  const mounts: ProxyMount[] = [{ prefix: PROXY_MOUNT, upstreamBase: config.basePath }]
  if (config.basePath !== '' && config.basePath !== PROXY_MOUNT) {
    mounts.push({ prefix: config.basePath, upstreamBase: config.basePath })
  }
  return mounts
}

/**
 * The exact browser path the workbench's WebSocket connects to for one
 * discovered `<quality>-<commit>`: the client joins the upstream's own
 * serverBasePath with the resource prefix — root upstreams connect at
 * `/<quality>-<commit>`, `/vscode` upstreams at `/vscode/<quality>-<commit>`.
 */
export function upgradePathFor(config: UpstreamConfig, qualityCommit: string): string {
  return joinUrl(config.basePath, `/${qualityCommit}`)
}

/**
 * Map one browser request URL through the mounts: longest matching prefix
 * wins, the remainder is appended to the mount's upstream base, and the
 * upstream query pairs (the token) are appended unless already present.
 * Returns the upstream request target (path[?query]), or null when no
 * mount matches.
 */
export function mapRequestUrl(
  rawUrl: string,
  mounts: readonly ProxyMount[],
  extraQuery: readonly (readonly [string, string])[],
): string | null {
  const queryAt = rawUrl.indexOf('?')
  const path = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt)
  const search = queryAt === -1 ? '' : rawUrl.slice(queryAt + 1)
  let best: ProxyMount | null = null
  for (const mount of mounts) {
    if (path !== mount.prefix && !path.startsWith(`${mount.prefix}/`)) continue
    if (best === null || mount.prefix.length > best.prefix.length) best = mount
  }
  if (best === null) return null
  const upstreamPath = joinUrl(best.upstreamBase, path.slice(best.prefix.length) || '/')
  const params = new URLSearchParams(search)
  for (const [key, value] of extraQuery) {
    if (!params.has(key)) params.append(key, value)
  }
  const query = params.toString()
  return query === '' ? upstreamPath : `${upstreamPath}?${query}`
}

/** Delete hop-by-hop headers (and any the Connection header names). */
function stripHopByHop(headers: Record<string, unknown>): void {
  const connection = typeof headers.connection === 'string' ? headers.connection : ''
  const named = connection.toLowerCase().split(',').map(token => token.trim()).filter(token => token !== '')
  for (const name of new Set([
    ...named,
    'connection', 'keep-alive', 'upgrade', 'proxy-connection', 'te', 'trailer', 'transfer-encoding',
  ])) {
    delete headers[name]
  }
}

/** Pick the request factory for one upstream origin. */
function requesterFor(origin: string): typeof httpRequest {
  return origin.startsWith('https://') ? httpsRequest : httpRequest
}

/** Forward one ordinary HTTP request to the upstream, streaming both legs. */
function proxyHttp(config: UpstreamConfig, target: string, req: IncomingMessage, res: ServerResponse): void {
  const headers = { ...req.headers }
  stripHopByHop(headers)
  const url = new URL(config.origin)
  const upstream = requesterFor(config.origin)({
    hostname: url.hostname,
    port: url.port === '' ? undefined : Number.parseInt(url.port, 10),
    method: req.method,
    path: target,
    headers,
  })
  const timer = setTimeout(() => { upstream.destroy(new Error('upstream headers timeout')) }, UPSTREAM_TIMEOUT_MS)
  upstream.on('response', (upstreamRes) => {
    clearTimeout(timer)
    const outHeaders = { ...upstreamRes.headers }
    stripHopByHop(outHeaders)
    res.writeHead(upstreamRes.statusCode ?? 502, outHeaders)
    upstreamRes.pipe(res)
  })
  upstream.on('error', () => {
    clearTimeout(timer)
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`dsh-sidebar-vscode: vscode upstream ${config.origin}${config.basePath || '/'} unreachable`)
  })
  req.on('aborted', () => { clearTimeout(timer); upstream.destroy() })
  res.on('close', () => { clearTimeout(timer); upstream.destroy() })
  req.pipe(upstream)
}

/** Serialize one header map back to wire format (arrays joined). */
function renderHead(statusLine: string, headers: Record<string, string | string[] | number | undefined>): Buffer {
  const lines = [statusLine]
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
  }
  lines.push('', '')
  return Buffer.from(`${lines.join('\r\n')}`, 'ascii')
}

/**
 * Forward one WebSocket upgrade to the upstream: re-issue the browser's
 * handshake verbatim (same path+query+headers — upgrade paths are always
 * identity-mapped, and serve-web's handleUpgrade ignores the connection
 * token), relay the 101 (or the refusal), then pipe the two raw sockets
 * both ways until either closes.
 */
function proxyUpgrade(config: UpstreamConfig, req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(config.origin)
  const upstream = requesterFor(config.origin)({
    hostname: url.hostname,
    port: url.port === '' ? undefined : Number.parseInt(url.port, 10),
    method: 'GET',
    path: req.url,
    headers: { ...req.headers },
  })
  const drop = (): void => {
    clearTimeout(timer)
    upstream.destroy()
    socket.destroy()
  }
  const timer = setTimeout(() => { upstream.destroy(new Error('upstream upgrade timeout')) }, UPSTREAM_TIMEOUT_MS)
  upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    clearTimeout(timer)
    socket.write(renderHead('HTTP/1.1 101 Switching Protocols', upstreamRes.headers))
    if (upstreamHead.length > 0) socket.write(upstreamHead)
    if (head.length > 0) upstreamSocket.write(head)
    upstreamSocket.pipe(socket)
    socket.pipe(upstreamSocket)
    upstreamSocket.on('error', drop)
    socket.on('error', drop)
    upstreamSocket.on('close', () => { socket.destroy() })
    socket.on('close', () => { upstreamSocket.destroy() })
  })
  upstream.on('response', (upstreamRes) => {
    clearTimeout(timer)
    // The upgrade was refused upstream: mirror the verdict byte-for-byte.
    socket.write(renderHead(
      `HTTP/1.1 ${upstreamRes.statusCode ?? 502} ${upstreamRes.statusMessage ?? ''}`.trimEnd(),
      upstreamRes.headers,
    ))
    upstreamRes.pipe(socket)
    upstreamRes.on('end', () => { socket.end() })
    upstreamRes.on('error', drop)
  })
  upstream.on('error', drop)
  socket.on('error', drop)
  upstream.end()
}

/**
 * Extract the workbench resource prefix (`<quality>-<commit>`, e.g.
 * `stable-08d4889f…`) from the serve-web index HTML: the first
 * `/<quality>-<40-hex>/` path segment any referenced resource carries.
 */
export function discoverResourcePrefix(html: string): string | null {
  const match = /\/([A-Za-z0-9][A-Za-z0-9-]*)-([0-9a-f]{40})\//.exec(html)
  return match === null ? null : `${match[1]}-${match[2]}`
}

/**
 * Extract the `serverBasePath` serve-web baked into the index HTML (the
 * workbench's own absolute URLs are all rooted there — ground truth for
 * routing, whatever path the probe URL carried). Accepts both the plain
 * JSON spelling and the `&quot;`-escaped `data-settings` attribute form;
 * root servers bake `/` or nothing — normalized to ''.
 */
export function discoverServerBasePath(html: string): string {
  const match = /serverBasePath(?:&quot;|")\s*:\s*(?:&quot;|")([^"&]+)(?:&quot;|")/.exec(html)
  const baked = match?.[1]
  if (baked === undefined) return ''
  const path = baked.trim().replace(/\/+$/, '')
  return path === '/' ? '' : path
}

/** One fetched index page: the HTML plus the origin it finally came from. */
export interface FetchedIndex {
  /** The index HTML (capped, decoded as UTF-8). */
  readonly html: string
  /**
   * The origin of the FINAL response: a redirect to another origin (an
   * enforced http→https hop, a redirecting gateway) is adopted, matching
   * where the browser itself would end up — discovery AND forwarding use it.
   */
  readonly origin: string
}

/** One probe hop: either the page HTML or the redirect target to follow. */
type IndexHop =
  | { readonly kind: 'page', readonly html: string }
  | { readonly kind: 'redirect', readonly url: URL }

/** Fetch one hop of the index page, capped and timed out. */
async function fetchIndexHop(origin: string, target: string, timeoutMs: number): Promise<IndexHop> {
  return await new Promise((resolve, reject) => {
    const url = new URL(origin)
    const upstream = requesterFor(origin)({
      hostname: url.hostname,
      port: url.port === '' ? undefined : Number.parseInt(url.port, 10),
      method: 'GET',
      path: target,
      headers: { accept: 'text/html' },
    })
    const timer = setTimeout(() => { upstream.destroy(new Error('probe timeout')) }, timeoutMs)
    const chunks: Buffer[] = []
    let size = 0
    upstream.on('response', (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 0
      if (status >= 300 && status < 400) {
        const location = upstreamRes.headers.location
        upstream.destroy()
        if (typeof location !== 'string' || location === '') {
          reject(new Error(`upstream answered ${status} without a location`))
          return
        }
        resolve({ kind: 'redirect', url: new URL(location, `${origin}${target}`) })
        return
      }
      if (status >= 400) {
        upstream.destroy(new Error(`upstream answered ${status}`))
        return
      }
      upstreamRes.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > INDEX_CAP_BYTES) {
          upstream.destroy(new Error('index too large'))
          return
        }
        chunks.push(chunk)
      })
      upstreamRes.on('end', () => {
        clearTimeout(timer)
        resolve({ kind: 'page', html: Buffer.concat(chunks).toString('utf8') })
      })
      upstreamRes.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    upstream.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    upstream.end()
  })
}

/**
 * Fetch one upstream's index HTML (following up to {@link MAX_REDIRECTS}
 * redirects within one shared time budget) and report the final origin.
 */
async function fetchIndex(config: UpstreamConfig, timeoutMs = PROBE_TIMEOUT_MS): Promise<FetchedIndex> {
  const deadline = Date.now() + timeoutMs
  let origin = config.origin
  // staticMounts always lists PROXY_MOUNT, so the map always matches.
  let target = mapRequestUrl(`${PROXY_MOUNT}/`, staticMounts(config), config.extraQuery) ?? '/'
  for (let hop = 0; ; hop += 1) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('probe timeout')
    const outcome = await fetchIndexHop(origin, target, remaining)
    if (outcome.kind === 'page') return { html: outcome.html, origin }
    if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
    if (outcome.url.protocol !== 'http:' && outcome.url.protocol !== 'https:') {
      throw new Error(`redirect to unsupported scheme "${outcome.url.protocol}"`)
    }
    const port = outcome.url.port === '' ? '' : `:${outcome.url.port}`
    origin = `${outcome.url.protocol}//${outcome.url.hostname}${port}`
    target = `${outcome.url.pathname}${outcome.url.search}`
  }
}

/** The live proxy handle the settings route drives. */
export interface VscodeProxyHandle {
  /**
   * Adopt (or, with null, drop) the settings-sourced upstream. The route's
   * already-fetched index may ride along as `seed` — discovery then reuses
   * it instead of refetching the page (one fetch, two uses).
   */
  configure(config: UpstreamConfig | null, seed?: FetchedIndex): void
  /**
   * One bounded liveness probe against a candidate upstream: the fetched
   * index page, or null when unreachable (bad URL, refused, timed out).
   */
  probeUpstream(config: UpstreamConfig): Promise<FetchedIndex | null>
  /**
   * Live mounting state — the browser half asks before choosing an iframe
   * base: `mounted` (the mount route is claimed) with the mount prefix,
   * plus `serving` (the last probe succeeded and every planned route is
   * live) — the workbench may target the mount only while serving, and a
   * direct fallback keeps polling `serving` to graduate late.
   */
  status(): { mounted: boolean, prefix: string | null, serving: boolean }
  /** Resolves after the initial (env/default) activation probe. */
  readonly ready: Promise<boolean>
}

/**
 * Install the `/vscode` proxy machinery on the webserver. Nothing is
 * claimed until an upstream is known (settings `configure()` or the
 * env/default probe loop); see the module doc for the routing plan.
 * @param ctx - host cordis context (structural face, see index.ts).
 */
export function createVscodeProxy(ctx: ProxyPluginContext): VscodeProxyHandle {
  const envRaw = process.env[UPSTREAM_ENV]
  const envConfig = isDisabledValue(envRaw) ? null : parseUpstreamUrl(envRaw ?? DEFAULT_UPSTREAM)
  if (envConfig === null && envRaw !== undefined && !isDisabledValue(envRaw)) {
    // Set but unusable (not an http(s) URL, or carries embedded
    // credentials): say so instead of idling silently. The raw value is
    // deliberately not echoed into logs — it may hold those credentials.
    ctx.logger.warn(`[dsh-sidebar-vscode] vscode proxy: ${UPSTREAM_ENV} is set but is not a usable http(s) URL (embedded credentials are unsupported) — proxy idle`)
  }

  let disposed = false
  let settingsConfig: UpstreamConfig | null = null
  let active: UpstreamConfig | null = null
  let disabledByConflict = false
  let qualityCommit: string | null = null
  let lastRefresh = 0
  let inflightProbe: Promise<boolean> | null = null
  /** Index page the settings route already fetched for the pending config. */
  let pendingSeed: FetchedIndex | null = null
  /** Bumped by every activate(): in-flight probes discard stale discovery. */
  let generation = 0
  const mounts = new Map<string, () => void>()
  const upgradeRoutes = new Map<string, () => void>()

  /**
   * The config routing is planned from: `active` until the first probe,
   * then RECONCILED — serve-web bakes its own `serverBasePath` (from
   * `--server-base-path`) into the index HTML, and the workbench's
   * absolute URLs follow THAT, whatever path the probe URL carried (a
   * server at `/vscode` answers `/` with the same `/vscode`-rooted
   * page); a redirecting entry adopts the final origin the same way. The
   * URL names the entry point; the HTML names the routing.
   */
  let routingBasePath: string | null = null
  let routingOrigin: string | null = null
  const routing = (): UpstreamConfig | null => {
    if (active === null) return null
    const basePath = routingBasePath === null || routingBasePath === active.basePath ? active.basePath : routingBasePath
    const origin = routingOrigin === null || routingOrigin === active.origin ? active.origin : routingOrigin
    return basePath === active.basePath && origin === active.origin ? active : { ...active, basePath, origin }
  }

  const face = (): ProxyWebServerFace | undefined => (ctx as unknown as { webServer?: ProxyWebServerFace }).webServer

  /**
   * The live webRuntime face the browser-trust fence reads (structural;
   * an absent service leaves an empty trustedHosts list, which fences to
   * loopback only — the same fail-closed default the /api routes use).
   */
  const runtime = (): { trustedHosts: readonly string[] } | undefined =>
    (ctx as unknown as { webRuntime?: { trustedHosts: readonly string[] } }).webRuntime

  /**
   * The browser-trust gate for BOTH proxy legs: cross-site pages must not
   * reach the workbench through this mount — firing an HTTP request needs
   * no CORS (and serve-web's side-effectful callbacks ride the token the
   * mount itself appends), and WebSocket handshakes are not CORS-checked
   * at all, so an unfenced upgrade leg is a cross-site-hijack tunnel into
   * the victim's VS Code server (serve-web's `handleUpgrade` ignores the
   * connection token). Same fence as every other plugin route (index.ts);
   * the same-origin page, the embedded iframe, and direct bookmark
   * navigations (`sec-fetch-site: none`, no Origin) all pass.
   */
  const fenceOk = (req: IncomingMessage): boolean =>
    isTrustedApiRequest(req, runtime()?.trustedHosts ?? [])

  /** Registered mount prefixes → their current rewrite targets. */
  const mountTargets = new Map<string, string>()

  /** Every registered mount, longest-prefix order is mapRequestUrl's job. */
  const currentMounts = (): readonly ProxyMount[] =>
    [...mounts.keys()].map(prefix => ({ prefix, upstreamBase: mountTargets.get(prefix) ?? prefix }))

  const handleHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!fenceOk(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh-sidebar-vscode: cross-site request refused')
      return
    }
    // Reconciled config: a redirect-adopted origin must carry into
    // forwarding too, not just into route planning.
    const config = routing()
    if (config === null) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh-sidebar-vscode: proxy reconfiguring')
      return
    }
    const target = mapRequestUrl(req.url ?? '/', currentMounts(), config.extraQuery)
    if (target === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh-sidebar-vscode: no mount matches')
      return
    }
    await maybeRefresh(req, target)
    // The awaited refresh may have RECONCILED the routing (first-boot
    // discovery, a base-path/origin adoption) while this request waited:
    // forward with the fresh config and mounts, or the very page load the
    // discovery was awaited for would be served from the stale routing.
    const finalConfig = routing() ?? config
    const finalTarget = mapRequestUrl(req.url ?? '/', currentMounts(), finalConfig.extraQuery) ?? target
    proxyHttp(finalConfig, finalTarget, req, res)
  }

  /** On page GETs: await a pending discovery (first boot race), else a
   * throttled background re-probe picks up serve-web version changes. */
  const maybeRefresh = async (req: IncomingMessage, target: string): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return
    const pathOnly = target.split('?')[0]
    const pagePath = joinUrl(routing()?.basePath ?? '', '/')
    if (pathOnly !== pagePath) return
    const now = Date.now()
    const pending = !fullyRegistered()
    if (!pending && now - lastRefresh < REFRESH_THROTTLE_MS) return
    lastRefresh = now
    if (!pending) {
      void probe()
      return
    }
    await Promise.race([probe(), new Promise(resolve => { setTimeout(resolve, DISCOVERY_WAIT_MS) })])
  }

  const registerMount = (mount: ProxyMount): void => {
    // Re-pointing an already-claimed prefix only swaps its rewrite target.
    if (mounts.has(mount.prefix)) {
      mountTargets.set(mount.prefix, mount.upstreamBase)
      return
    }
    if (disabledByConflict) return
    const webServer = face()
    if (webServer === undefined) {
      disabledByConflict = true
      ctx.logger.warn('[dsh-sidebar-vscode] vscode proxy: webserver service absent — feature off')
      return
    }
    try {
      const stop = webServer.register({ kind: 'prefix', path: mount.prefix, handler: handleHttp })
      mounts.set(mount.prefix, stop)
      mountTargets.set(mount.prefix, mount.upstreamBase)
      ctx.effect(() => stop, `dsh-sidebar-vscode: ${mount.prefix} proxy route`)
    } catch (error) {
      disabledByConflict = true
      ctx.logger.warn(`[dsh-sidebar-vscode] vscode proxy: route ${mount.prefix} already owned — feature off:`, error)
    }
  }

  /** Dispose one registered mount (leaves foreign keys untouched). */
  const dropMount = (prefix: string): void => {
    const stop = mounts.get(prefix)
    if (stop === undefined) return
    mounts.delete(prefix)
    mountTargets.delete(prefix)
    try {
      stop()
    } catch {
      // Already gone with the context.
    }
  }

  /**
   * Bring the registered static mounts in line with one routing config:
   * add or re-point what it wants, drop what it no longer lists (mirror
   * removal on base-path changes) — the discovery shim is pruned too.
   */
  const syncStaticMounts = (config: UpstreamConfig): void => {
    const wanted = staticMounts(config)
    for (const mount of wanted) registerMount(mount)
    for (const prefix of [...mounts.keys()]) {
      if (wanted.some(mount => mount.prefix === prefix)) continue
      if (qualityCommit !== null && prefix === `/${qualityCommit}`) continue
      dropMount(prefix)
    }
  }

  const registerUpgrade = (path: string): void => {
    if (disabledByConflict || upgradeRoutes.has(path)) return
    const webServer = face()
    if (webServer === undefined) return
    if (active === null) return
    try {
      const configAtRegistration = active
      const stop = webServer.registerUpgrade({
        path,
        handler: (req, socket, head) => {
          // The fence first (WebSocket handshakes are not CORS-checked by
          // browsers, and serve-web's handleUpgrade ignores the connection
          // token — see fenceOk): a cross-site socket never reaches the
          // tunnel. Then resolve routing live per upgrade: it may have
          // reconciled (an origin adopted from a redirect) since this
          // route registered.
          if (!fenceOk(req)) {
            socket.destroy()
            return
          }
          proxyUpgrade(routing() ?? configAtRegistration, req, socket, head)
        },
      })
      upgradeRoutes.set(path, stop)
      ctx.effect(() => stop, `dsh-sidebar-vscode: ${path} WebSocket proxy`)
      while (upgradeRoutes.size > MAX_UPGRADE_ROUTES) {
        const oldest = upgradeRoutes.keys().next().value as string
        const dispose = upgradeRoutes.get(oldest)
        upgradeRoutes.delete(oldest)
        try {
          dispose?.()
        } catch {
          // Already gone with the context.
        }
      }
    } catch (error) {
      ctx.logger.warn(`[dsh-sidebar-vscode] vscode proxy: upgrade route ${path} taken — WebSocket passthrough off:`, error)
    }
  }

  const fullyRegistered = (): boolean => {
    const config = routing()
    if (config === null || qualityCommit === null) return false
    for (const mount of staticMounts(config)) {
      if (!mounts.has(mount.prefix)) return false
    }
    if (!upgradeRoutes.has(upgradePathFor(config, qualityCommit))) return false
    if (config.basePath === '' && !mounts.has(`/${qualityCommit}`)) return false
    return true
  }

  const stopAll = (): void => {
    for (const stop of mounts.values()) {
      try {
        stop()
      } catch {
        // Already gone with the context.
      }
    }
    mounts.clear()
    mountTargets.clear()
    for (const stop of upgradeRoutes.values()) {
      try {
        stop()
      } catch {
        // Already gone with the context.
      }
    }
    upgradeRoutes.clear()
    qualityCommit = null
    routingBasePath = null
    routingOrigin = null
    lastRefresh = 0
  }

  const activate = (): void => {
    stopAll()
    // Invalidate every in-flight probe: its discovery belongs to the OLD
    // upstream and must never be applied to the new one (mixed routing).
    generation += 1
    active = settingsConfig ?? envConfig
    if (active === null) {
      ctx.logger.info('[dsh-sidebar-vscode] vscode proxy idle (no upstream configured)')
      return
    }
    // The settings source registers its static mounts immediately — the
    // user asked for this upstream, so an unreachable one must answer
    // honest 502s instead of hiding behind the SPA fallback. The env
    // source stays probe-gated: an unused default claims nothing.
    if (settingsConfig !== null) {
      syncStaticMounts(active)
    }
  }

  const probe = (): Promise<boolean> => {
    if (inflightProbe !== null) return inflightProbe
    // NOTE: the promise is assigned AFTER the IIFE's synchronous prefix —
    // a probe that returns before its first await (e.g. the idle initial
    // probe with no upstream) must not leave the settled promise latched
    // in `inflightProbe` forever, so completion is observed via
    // promise.finally (a microtask) rather than an in-body finally.
    const promise = (async () => {
      if (disposed || disabledByConflict || active === null) return false
      const config = active
      const observedGeneration = generation
      try {
        let fetched: FetchedIndex
        if (pendingSeed !== null) {
          // The settings route already fetched this very upstream's index
          // (adopted in the same synchronous step as the seed) — reuse it.
          fetched = pendingSeed
          pendingSeed = null
        } else {
          fetched = await fetchIndex(config)
          // A configure()/dispose() landing mid-fetch invalidates this
          // discovery: applying the OLD page's base/commit onto the NEW
          // upstream produced mixed routing that looked fully registered
          // while serving 404s. Discard; the next probe (the configure
          // call's own, or the page-GET/interval retry) speaks for the
          // new state.
          if (disposed || observedGeneration !== generation) return false
        }
        const html = fetched.html
        const discovered = discoverResourcePrefix(html)
        if (discovered === null) return false
        qualityCommit = discovered
        // Reconcile the routing with what the page baked / redirected to:
        // the probe URL's own path is only the entry point (a `/vscode`
        // server answers `/` with the same `/vscode`-rooted workbench).
        routingBasePath = discoverServerBasePath(html)
        routingOrigin = fetched.origin
        const reconciled = routing() ?? config
        syncStaticMounts(reconciled)
        if (reconciled.basePath === '') {
          registerMount({ prefix: `/${discovered}`, upstreamBase: `/${discovered}` })
        } else {
          dropMount(`/${discovered}`)
        }
        registerUpgrade(upgradePathFor(reconciled, discovered))
        return true
      } catch {
        return false
      }
    })()
    inflightProbe = promise
    void promise.finally(() => {
      if (inflightProbe === promise) inflightProbe = null
    })
    return promise
  }

  const timer = setInterval(() => {
    if (active !== null && !fullyRegistered()) void probe()
  }, PROBE_INTERVAL_MS)
  timer.unref?.()

  ctx.effect(() => () => {
    disposed = true
    clearInterval(timer)
    stopAll()
  }, 'dsh-sidebar-vscode: vscode proxy lifecycle')

  activate()
  const ready = probe().then((ok) => {
    if (ok && !disposed) {
      const config = routing()
      if (config !== null) {
        ctx.logger.info(
          `[dsh-sidebar-vscode] proxy live: ${PROXY_MOUNT}/ → ${config.origin}${config.basePath || '/'} (upgrade ${upgradePathFor(config, qualityCommit ?? '?')})`,
        )
      }
    }
    return ok
  }, () => false)

  return {
    configure(config, seed) {
      settingsConfig = config
      pendingSeed = config === null || seed === undefined ? null : seed
      activate()
      // A probe for the PREVIOUS upstream may still be mid-fetch: it already
      // discards its own discovery through the generation bump activate()
      // made, so drop the latch — the probe below then speaks for the NEW
      // upstream immediately instead of waiting for the interval tick (the
      // .finally guard keeps an already-settling old promise harmless).
      inflightProbe = null
      if (active !== null) void probe()
    },
    status() {
      // `mounted`: the mount route is claimed (settings mode claims at
      // configure() — honest 502s while unreachable). `serving`: the last
      // probe succeeded AND every planned route (mounts, mirror/shim,
      // upgrade) is live — the iframe may target the mount only then.
      const mounted = !disposed && active !== null && mounts.has(PROXY_MOUNT)
      const serving = mounted && fullyRegistered()
      return { mounted, prefix: mounted ? PROXY_MOUNT : null, serving }
    },
    async probeUpstream(config) {
      if (disposed) return null
      try {
        return await fetchIndex(config)
      } catch {
        return null
      }
    },
    ready,
  }
}
