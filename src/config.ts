/**
 * The Host half's plugin configuration: the `Config` schema the loader
 * resolves and the settings service derives this plugin's configuration
 * page from.
 *
 * Since dsh 0.1.7 a plugin's settings section IS its composition entry's
 * `Config` schema: every field marked `.volatile()` is editable live
 * (设置 → 插件 → this bundle's / this row's configuration page), and a
 * committed edit is pushed into the running entry's volatile references
 * without a remount — the browser half reads the very same values through
 * the shared `configForms` form keyed by the entry id
 * (`dsh-sidebar-vscode`, the id this plugin's `cordis.patch.yml`
 * declares), so an edit reaches the next render / the next click with no
 * restart. The old `settings.installSection` registration is gone with
 * that system; a hand-written section a user leaves in the profile is
 * validated by this same schema at write time.
 *
 * The browser half's card (`src/client/settingsCard.tsx`) edits these
 * fields through `ctx.configForms`; the tab body and the takeover gates
 * read them per render / per call. Nothing is consumed host-side, so
 * `apply` merely holds the resolved references.
 *
 * @module dsh-sidebar-vscode/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
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
  type VscodeSidebarSettings,
} from './shared/settings.ts'

/**
 * The config `apply` receives once the loader resolves the schema: every
 * field is a live reference whose snapshot a settings commit replaces in
 * place (the plugin never remounts for an edit). The Host half reads
 * none of them — every consumer is browser-side, through the shared
 * config form — so the references are simply held for contract parity
 * with the composition entry.
 */
export type VscodeSidebarPluginConfig = {
  readonly [K in keyof VscodeSidebarSettings]: Volatile<VscodeSidebarSettings[K]>
}

/**
 * The plugin's `Config` schema — the single description of the
 * `dsh-sidebar-vscode` settings section. Defaults mirror
 * {@link VSCODE_SIDEBAR_SETTINGS_BASE} exactly (the composition base the
 * patch ships wins for unset fields anyway; the schema defaults are the
 * same values, so a section resolved from defaults alone equals the
 * base). Numeric caps carry their declared bounds here, so a hand-edited
 * profile section outside them is refused at write time by the settings
 * service itself.
 */
export const Config = z.object({
  openAsDefault: z.boolean().default(VSCODE_SIDEBAR_SETTINGS_BASE.openAsDefault).volatile(),
  openBlocklist: z.array(z.string().max(16)).max(OPEN_BLOCKLIST_MAX_ENTRIES)
    .default([...VSCODE_SIDEBAR_SETTINGS_BASE.openBlocklist]).volatile(),
  serverUrl: z.string().default(VSCODE_SIDEBAR_SETTINGS_BASE.serverUrl).volatile(),
  pathMap: z.string().default(VSCODE_SIDEBAR_SETTINGS_BASE.pathMap).volatile(),
  maxLines: z.number().step(1).min(MAX_LINES_MIN).max(MAX_LINES_MAX).default(MAX_LINES_DEFAULT).volatile(),
  maxBytes: z.number().step(1).min(MAX_BYTES_MIN).max(MAX_BYTES_MAX).default(MAX_BYTES_DEFAULT).volatile(),
})
