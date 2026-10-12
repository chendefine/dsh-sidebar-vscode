/**
 * Browser-trust fence for this plugin's routes, behaviorally identical to
 * the /api gateway's fence in @deepseek-ai/dsh-client-connection (the
 * package does not export these helpers, so the small surface is mirrored
 * here with attribution; BSD-3-Clause). Host-header loopback, a configured
 * trusted authority, or the listener's own bind address passes; cross-site
 * browser markers refuse. This is a DNS-rebinding / cross-site defense,
 * not authentication.
 *
 * The mirror tracks the 0.2.1-alpha.2 fence shape: `bindHost` (the
 * listener's concrete bind literal, accepted on any port — the replacement
 * for ≤0.2.0's webRuntime-broadcast lanAddresses) and `protocol` (native
 * HTTPS listeners normalize default ports under their own scheme). On
 * dsh ≤0.2.0 the webServer face exposes no `host`/`protocol` and the call
 * sites pass undefined, which reproduces that generation's fence exactly.
 *
 * @module dsh-sidebar-vscode/trust-fence
 */
import type { IncomingHttpHeaders } from 'node:http'

/** The request facts the fence reads (structural subset of IncomingMessage). */
interface ApiTrustRequest {
  headers: IncomingHttpHeaders
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Normalized URL of a bare authority (hostname lowercased, default port
 * stripped, IPv6 bracketed), or undefined when unparsable.
 * @param authority - `host` or `host:port` text.
 * @param scheme - special scheme to parse under; its default port is the one stripped.
 */
function parseAuthority(authority: string, scheme: 'http:' | 'https:' = 'http:'): URL | undefined {
  try {
    // http: and https: are WHATWG "special schemes": parsing yields a non-empty hostname or throws.
    return new URL(`${scheme}//${authority}`)
  } catch {
    return undefined
  }
}

/** Whether a normalized URL hostname names the local loopback authority. */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. The port is judged from URL parses under both special
 * schemes (their default ports differ, so `:80` and `:443` still count as
 * explicit), never from the raw string, where WHATWG trimming would misread
 * shapes like `host:port ` as port-less.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== ''
    ? entryUrl.port
    : new URL(`${entryUrl.protocol === 'http:' ? 'https:' : 'http:'}//${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority matches a `trustedHosts` entry. An entry with
 * an explicit port matches that exact authority; a port-less entry matches the
 * hostname on any port. Both sides compare through WHATWG normalization,
 * so case and a redundant scheme-default port never decide trust.
 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[], protocol: 'http:' | 'https:'): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry, protocol)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Whether a parsed authority names the deployment's own bind address. A browser
 * dialing that literal sends it as Host, and accepting it grants nothing
 * further: the literal is no rebinding target, the Origin and cross-site checks
 * still apply, and it stays outside `trustedHosts`. Matching ignores the port,
 * like a port-less entry, and any `%zone` id (an interface selector, not
 * address text). The 0.2.x replacement for ≤0.2.0's auto-broadcast LAN
 * addresses: `--host <literal>` deployments serve /api on their bind IP, and
 * this plugin's routes follow.
 */
function isBindAddressAuthority(hostUrl: URL, bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  // webServer.host is unbracketed IPv6 text ("ready to be a URL host" — the brackets are URL syntax).
  const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname
}

/**
 * Compare Host under the Origin's HTTP(S) scheme so default ports normalize
 * consistently. The transport may remain HTTP behind an HTTPS proxy.
 * @param origin - verbatim Origin header value.
 * @param host - verbatim Host header value already accepted by the Host fence.
 * @returns true only when the Origin is this listener's own `http(s)` authority.
 */
function isSameAuthorityOrigin(origin: string, host: string): boolean {
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  // Only http(s) can name this listener; every other scheme (file:, ftp:, the
  // opaque "null") is refused rather than matching by hostname alone.
  const scheme = originUrl.protocol === 'https:' ? 'https:'
    : originUrl.protocol === 'http:' ? 'http:'
      : undefined
  if (scheme === undefined) return false
  const hostUrl = parseAuthority(host, scheme)
  return hostUrl !== undefined && originUrl.host === hostUrl.host
}

/**
 * Decide whether one plugin route request may proceed.
 * @param request - node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 * @param bindHost - the listener's own bind IP literal (webServer.host), accepted on any port independently of `trustedHosts`; undefined on dsh ≤0.2.0.
 * @param protocol - listener protocol (webServer.protocol) for default Host ports; HTTP when unknown.
 * @returns true when the Host is ours (loopback, the bind address, or trusted) and any attached browser markers are same-origin.
 */
export function isTrustedApiRequest(
  request: ApiTrustRequest,
  trustedHosts: readonly string[],
  bindHost?: string,
  protocol: 'http:' | 'https:' = 'http:',
): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host, protocol)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)
    && !isTrustedAuthority(hostUrl, trustedHosts, protocol)
    && !isBindAddressAuthority(hostUrl, bindHost)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  return isSameAuthorityOrigin(origin, host)
}

/**
 * The structural face {@link bindFenceAuthorities} needs from a plugin
 * context: cordis' scoped `ctx.inject` (the only sanctioned way to touch a
 * service this plugin does not statically inject).
 */
interface FenceContextFace {
  inject(dependencies: readonly string[], callback: (scoped: unknown) => void): unknown
}

/**
 * Bind the fence's live trustedHosts across dsh generations and answer a
 * getter for the current value.
 *
 * Cordis guards service properties: reading `ctx.<service>` on a context
 * that does not inject it throws `cannot get property … without inject`
 * (harness postmortem 0001) — so the fence must NOT reach for either
 * service directly. dsh ≤0.2.0 carries the authorities on `webRuntime`;
 * 0.2.1-alpha.2 removed that service and moved them to `webStartup`.
 * Each scoped `ctx.inject` callback below fires when (and only while) its
 * service exists, refreshing the held value; on any single dsh generation
 * exactly one of the two services exists, so which callback wins is
 * deterministic there. Before either has arrived the getter answers `[]`,
 * which fences to loopback only — the same fail-closed default the /api
 * routes use. Once a value was bound it stays until a later callback
 * replaces it (a withdrawal without a successor leaves the last value in
 * place; both services are startup-immutable snapshots, so this only
 * matters at teardown, when no further requests arrive).
 *
 * @param ctx - the plugin context (structural: needs only `inject`).
 * @returns a getter for the most recently provided trustedHosts value.
 */
export function bindFenceAuthorities(ctx: FenceContextFace): () => readonly string[] {
  let trustedHosts: readonly string[] = []
  ctx.inject(['webRuntime'], (runtimeCtx) => {
    trustedHosts = (runtimeCtx as { webRuntime?: { trustedHosts?: readonly string[] } })
      .webRuntime?.trustedHosts ?? []
  })
  ctx.inject(['webStartup'], (startupCtx) => {
    trustedHosts = (startupCtx as { webStartup?: { trustedHosts?: readonly string[] } })
      .webStartup?.trustedHosts ?? []
  })
  return () => trustedHosts
}
