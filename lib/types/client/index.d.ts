/**
 * Browser half of `dsh-sidebar-vscode`: a thin composition root over the
 * OFFICIAL right-Sidebar system. The plugin's client-side mechanisms live
 * in their own modules — the tab body (VscodeView.tsx and its
 * controllers), the reference pipeline (references.ts / composer.tsx /
 * referencePipeline.ts), the takeover family (takeovers.ts), the settings
 * card (settingsCard.tsx) — and this entry only wires them to the
 * services:
 *
 * - the `vscode` tab type, registered in the official two stages: the
 *   static definition into `ctx.sidebarRightTabs` (guide-page entry box
 *   included) and the body into the keyed `sidebar.right.pane.tab` seat
 *   under the definition's id — the embedded VS Code web workbench at the
 *   session's workspace;
 * - an `@`-trigger source named 'vscode-reference' whose codec serializes
 *   this plugin's occurrence chips back to their canonical mention at
 *   submit (the input machine routes serialization by source name);
 * - a reference lander shared by the clipboard bridge (tab component) and
 *   the paste fallback (composer dock): payload → chips on the addressed
 *   session's composer, plain-text mention as the degraded path;
 * - the takeover family (takeovers.ts): the official
 *   `ctx.sidebarRight.openResource` funnel and the settings page's
 *   「打开配置文件」button rerouted into the workbench tab, all behind
 *   the openAsDefault switch and the open blocklist;
 * - the configuration card (settingsCard.tsx) inside the official
 *   设置 → 插件 → 插件配置 tab, keyed by the `vscode-sidebar` namespace
 *   the Host half serves.
 *
 * @module dsh-sidebar-vscode/client
 */
/** Services required before mounting: the official right-Sidebar's tab
 * registry and navigation controller, the slot registry (the tab body,
 * the composer dock, and the settings card seats), the locale service,
 * the session registry, the conversation input service, the trigger
 * registry (chip serialization routing), the settings scope (the
 * `vscode-sidebar` namespace), and the connection service (the legacy
 * settings.openDocument seam). */
export declare const inject: string[];
/**
 * Client plugin body.
 * @param ctx - the client cordis context (the official sidebar services +
 * slots + locale + sessions + conversation + inputTriggers + settingsScope
 * + connection).
 */
export declare function apply(ctx: unknown): void;
