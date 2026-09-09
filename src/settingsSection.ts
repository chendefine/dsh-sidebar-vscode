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

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  MAX_BYTES_DEFAULT,
  MAX_BYTES_MAX,
  MAX_BYTES_MIN,
  MAX_LINES_DEFAULT,
  MAX_LINES_MAX,
  MAX_LINES_MIN,
  OPEN_BLOCKLIST_MAX_ENTRIES,
  VSCODE_SIDEBAR_SETTINGS_BASE,
  VSCODE_SIDEBAR_SETTINGS_NAMESPACE,
  type VscodeSidebarSettings,
} from './shared/settings.ts'

/**
 * The section's schema. Defaults mirror {@link VSCODE_SIDEBAR_SETTINGS_BASE}
 * exactly (the composition base wins for unset fields anyway; the schema
 * defaults are the same values so a section resolved from defaults alone
 * equals the base). Numeric caps carry their declared bounds here, so a
 * hand-edited document section outside them is refused at write time by
 * the settings provider itself.
 */
export function vscodeSidebarSettingsSchema(): z<VscodeSidebarSettings> {
  return z.object({
    openAsDefault: z.boolean().default(VSCODE_SIDEBAR_SETTINGS_BASE.openAsDefault),
    openBlocklist: z.array(z.string().max(16)).max(OPEN_BLOCKLIST_MAX_ENTRIES)
      .default([...VSCODE_SIDEBAR_SETTINGS_BASE.openBlocklist]),
    serverUrl: z.string().default(VSCODE_SIDEBAR_SETTINGS_BASE.serverUrl),
    pathMap: z.string().default(VSCODE_SIDEBAR_SETTINGS_BASE.pathMap),
    maxLines: z.number().step(1).min(MAX_LINES_MIN).max(MAX_LINES_MAX).default(MAX_LINES_DEFAULT),
    maxBytes: z.number().step(1).min(MAX_BYTES_MIN).max(MAX_BYTES_MAX).default(MAX_BYTES_DEFAULT),
  })
}

/** The structural settings-provider face the installer touches. */
interface SettingsServiceFace {
  installSection(
    owner: Context,
    ns: string,
    schema: z<VscodeSidebarSettings>,
    entry: VscodeSidebarSettings,
    hooks: {
      setSource(source: () => VscodeSidebarSettings): void
      validate?(value: VscodeSidebarSettings): void
      onChange(): void
    },
  ): void
}

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
export function installVscodeSidebarSettings(ctx: Context, settings: unknown): void {
  const service = settings as SettingsServiceFace | null
  if (service === null || typeof service.installSection !== 'function') return
  service.installSection(
    ctx,
    VSCODE_SIDEBAR_SETTINGS_NAMESPACE,
    vscodeSidebarSettingsSchema(),
    {
      openAsDefault: VSCODE_SIDEBAR_SETTINGS_BASE.openAsDefault,
      openBlocklist: [...VSCODE_SIDEBAR_SETTINGS_BASE.openBlocklist],
      serverUrl: VSCODE_SIDEBAR_SETTINGS_BASE.serverUrl,
      pathMap: VSCODE_SIDEBAR_SETTINGS_BASE.pathMap,
      maxLines: VSCODE_SIDEBAR_SETTINGS_BASE.maxLines,
      maxBytes: VSCODE_SIDEBAR_SETTINGS_BASE.maxBytes,
    },
    {
      setSource: () => {},
      onChange: () => {},
    },
  )
}
