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
import type { IncomingHttpHeaders } from 'node:http';
/** The request facts the fence reads (structural subset of IncomingMessage). */
interface ApiTrustRequest {
    headers: IncomingHttpHeaders;
}
/** Whether a normalized URL hostname names the local loopback authority. */
export declare function isLoopbackHostname(hostname: string): boolean;
/**
 * Decide whether one plugin route request may proceed.
 * @param request - node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 * @param bindHost - the listener's own bind IP literal (webServer.host), accepted on any port independently of `trustedHosts`; undefined on dsh ≤0.2.0.
 * @param protocol - listener protocol (webServer.protocol) for default Host ports; HTTP when unknown.
 * @returns true when the Host is ours (loopback, the bind address, or trusted) and any attached browser markers are same-origin.
 */
export declare function isTrustedApiRequest(request: ApiTrustRequest, trustedHosts: readonly string[], bindHost?: string, protocol?: 'http:' | 'https:'): boolean;
/**
 * The structural face {@link bindFenceAuthorities} needs from a plugin
 * context: cordis' scoped `ctx.inject` (the only sanctioned way to touch a
 * service this plugin does not statically inject).
 */
interface FenceContextFace {
    inject(dependencies: readonly string[], callback: (scoped: unknown) => void): unknown;
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
export declare function bindFenceAuthorities(ctx: FenceContextFace): () => readonly string[];
export {};
