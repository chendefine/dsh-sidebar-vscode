/**
 * Browser half of `dsh-sidebar-vscode`: registers one better-sidebar tab
 * ('dsh-sidebar-vscode:vscode') that embeds the VS Code web workbench
 * opened at the current session workspace, plus the composer-side
 * plumbing for VS Code selection references:
 *
 * - an `@`-trigger source named 'vscode-reference' whose codec serializes
 *   this plugin's occurrence chips back to their canonical mention at submit
 *   (the input machine routes serialization by source name);
 * - a reference lander shared by the clipboard bridge (tab component) and
 *   the paste fallback (composer dock): payload → chips on the addressed
 *   session's composer, plain-text mention as the degraded path;
 * - a mention paster (composer dock) that recovers copied reference items —
 *   whitespace-mangled or canonical mention text — back into chips;
 * - the chat-open takeover (openIntercept.ts / turnTail.tsx): the
 *   produced-files row and the runtime's chat file-open funnel (the
 *   gateway-era `remote.session.openWorkspacePath` Host Remote, or the
 *   legacy `workspaces.openPath` client service) are rerouted so chat file
 *   clicks open inside the VSCode tab, gated by the same `openAsDefault`
 *   switch as the default-tab swap;
 * - the settings-open takeover (settingsTakeover.ts): the settings page's
 *   「打开配置文件」button resolves the configuration file through this
 *   plugin's fenced node-half route and opens it inside the VSCode tab
 *   instead of the Host OS opener, gated by the same switch.
 *
 * When better-sidebar is absent (optional peer), tab registration silently
 * skips; the reference plumbing still works for the paste fallback.
 *
 * @module dsh-sidebar-vscode/client
 */
import type { TabDescriptor } from 'dsh-better-sidebar';
/** Services required before mounting: the sidebar service, the slot registry
 * (the turn-tail claim), the locale service, the session registry, the
 * conversation input service, the trigger registry (chip serialization
 * routing), the client workspaces service (the openPath seam), and the
 * connection service (the settings.openDocument seam). */
export declare const inject: string[];
/** The tab descriptor this plugin registers. */
export declare function vscodeTab(): TabDescriptor;
/**
 * Client plugin body.
 * @param ctx - the client cordis context (sidebar + slots + locale + sessions
 * + conversation + inputTriggers services).
 */
export declare function apply(ctx: unknown): void;
