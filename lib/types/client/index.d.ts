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
 *   whitespace-mangled or canonical mention text — back into chips.
 *
 * When better-sidebar is absent (optional peer), tab registration silently
 * skips; the reference plumbing still works for the paste fallback.
 *
 * @module dsh-sidebar-vscode/client
 */
import type { TabDescriptor } from 'dsh-better-sidebar';
/** Services required before mounting: the sidebar service, the slot registry,
 * the locale service, the session registry, the conversation input service,
 * and the trigger registry (chip serialization routing). */
export declare const inject: string[];
/** The tab descriptor this plugin registers. */
export declare function vscodeTab(): TabDescriptor;
/**
 * Client plugin body.
 * @param ctx - the client cordis context (sidebar + slots + locale + sessions
 * + conversation + inputTriggers services).
 */
export declare function apply(ctx: unknown): void;
