/**
 * Browser-trust fence for this plugin's routes, behaviorally identical to
 * the /api gateway's fence in @deepseek-ai/dsh-client-connection (and to
 * dsh-better-sidebar's copy of the same logic — the package does not export
 * these helpers, so the small surface is mirrored here with attribution;
 * both are BSD-3-Clause). Host-header loopback or a configured trusted
 * authority passes; cross-site browser markers refuse. This is a
 * DNS-rebinding / cross-site defense, not authentication.
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
 * @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
 */
export declare function isTrustedApiRequest(request: ApiTrustRequest, trustedHosts: readonly string[]): boolean;
export {};
