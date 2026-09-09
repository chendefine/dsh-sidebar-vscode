/**
 * The Host half's `vscode-sidebar` settings section: the schema the
 * settings provider serves, and the one install helper the plugin body
 * calls.
 *
 * The official「插件配置」card tab renders the INTERSECTION of the
 * namespaces the Host serves and the cards registered in the browser —
 * registering this section is what makes the plugin's card appear at
 * 设置 → 插件 → 插件配置 → VSCode 侧边栏. Everything user-visible is
 * edited by the browser half's card (`src/client/settingsCard.tsx`)
 * through `ctx.settingsScope`; the Host side only describes, validates,
 * and persists.
 *
 * The section is registered through the optional `settings` service
 * (`ctx.inject(['settings'], …)`, fail-soft): a deployment without a
 * settings provider simply never serves the namespace, the card never
 * appears, and the browser half falls back to the code defaults.
 *
 * @module dsh-sidebar-vscode/settingsSection
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type VscodeSidebarSettings } from './shared/settings.ts';
/**
 * The section's schema. Defaults mirror {@link VSCODE_SIDEBAR_SETTINGS_BASE}
 * exactly (the composition base wins for unset fields anyway; the schema
 * defaults are the same values so a section resolved from defaults alone
 * equals the base). Numeric caps carry their declared bounds here, so a
 * hand-edited document section outside them is refused at write time by
 * the settings provider itself.
 */
export declare function vscodeSidebarSettingsSchema(): z<VscodeSidebarSettings>;
/**
 * Register the `vscode-sidebar` section on the settings provider, for the
 * caller's lifetime (the provider unregisters with the plugin's fiber).
 *
 * The host half reads nothing from the section itself — every consumer is
 * browser-side — so `setSource` parks on a no-op and `onChange` is one
 * too; the section is `live` (the browser reads per call / per render).
 *
 * @param ctx - the plugin's host context (the section's owner).
 * @param settings - the settings service the provider mounted (structural;
 * a foreign shape installs nothing).
 */
export declare function installVscodeSidebarSettings(ctx: Context, settings: unknown): void;
