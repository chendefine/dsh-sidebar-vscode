/**
 * Browser half of `dsh-sidebar-vscode`: a thin composition root. The
 * plugin's client-side mechanisms live in their own modules — the tab
 * view (VscodeView.tsx and its controllers), the reference pipeline
 * (references.ts / composer.tsx / referencePipeline.ts), the takeover
 * family (takeovers.ts), the settings panel (settingsRows.tsx) — and this
 * entry only wires them to the services:
 *
 * - the better-sidebar tab ('dsh-sidebar-vscode:vscode') embedding the
 *   VS Code web workbench at the current session workspace;
 * - an `@`-trigger source named 'vscode-reference' whose codec serializes
 *   this plugin's occurrence chips back to their canonical mention at
 *   submit (the input machine routes serialization by source name);
 * - a reference lander shared by the clipboard bridge (tab component) and
 *   the paste fallback (composer dock): payload → chips on the addressed
 *   session's composer, plain-text mention as the degraded path;
 * - the takeover family (takeovers.ts): chat file opens and the settings
 *   page's「打开配置文件」button rerouted into the VSCode tab, all behind
 *   the openAsDefault switch and the open blocklist;
 * - the default-tab watcher (defaultTab.ts): brand-new sessions open the
 *   VSCode tab instead of better-sidebar's seeded Files tab.
 *
 * When better-sidebar is absent (optional peer), tab registration and the
 * takeovers silently skip; the reference plumbing still works for the
 * paste fallback.
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
