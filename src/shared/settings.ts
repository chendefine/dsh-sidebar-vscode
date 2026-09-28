/**
 * The `vscode-sidebar` settings model, shared by both plugin halves.
 *
 * The settings live in the OFFICIAL profile composition, keyed by this
 * plugin's composition entry id (`dsh-sidebar-vscode`, the id its
 * `cordis.patch.yml` declares) — NOT in any sidebar plugin's private
 * blob: since dsh 0.1.7 the settings service derives a plugin's
 * configuration page from its composition entry's `Config` schema
 * (`src/config.ts`; every field `.volatile()`), and the「设置 → 插件」
 * page pairs that derived namespace with this plugin's browser-registered
 * card (`plugins.bundle.config` / `plugins.row.config`, keyed the same
 * way).
 *
 * This module is the ONE source of truth both halves compile against —
 * the Host half's schema defaults and the browser half's
 * settings-not-ready-yet fallbacks must never disagree:
 *
 * - `openAsDefault` gates the three file-open takeovers (chat-originated
 *   opens through `ctx.sidebarRight.openResource`, the collapsed column's
 *   expand button, and the settings page's「打开配置文件」button). The
 *   better-sidebar-era meaning — swapping a fresh session's seeded Files
 *   tab — is gone with that system (the official sidebar seeds the guide
 *   page and keeps layout in memory only); the switch keeps its takeover
 *   roles.
 * - `openBlocklist` carries the unset-versus-empty rule through the
 *   settings document's own layering: the composition base IS the
 *   default list, an explicit `[]` is the stored decision "block
 *   nothing".
 *
 * @module dsh-sidebar-vscode/shared/settings
 */

/**
 * The settings namespace this plugin's configuration lives under: the
 * composition entry id (what the loader's patch declares and the settings
 * service keys the derived section by).
 */
export const VSCODE_SIDEBAR_SETTINGS_NAMESPACE = 'dsh-sidebar-vscode'

/** The stored user preference for the VSCode sidebar tab. */
export interface VscodeSidebarSettings {
  /** Whether the three file-open takeovers are active (see module doc). */
  readonly openAsDefault: boolean
  /**
   * File extensions the takeovers must not claim (blocklist order kept).
   * Mutable-array shaped to match the schemastery schema's inference;
   * every consumer treats it as read-only.
   */
  readonly openBlocklist: string[]
  /** The `code serve-web` base address ('' = the code default). */
  readonly serverUrl: string
  /** DSH path prefix → VS Code container prefix rules ('' = no mapping). */
  readonly pathMap: string
  /** Line cap for one injected reference. */
  readonly maxLines: number
  /** UTF-8 byte cap for one injected reference. */
  readonly maxBytes: number
}

/** The out-of-the-box blocklist: common binary/Office/image types. */
export const DEFAULT_OPEN_BLOCKLIST: readonly string[] = [
  'pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpeg', 'jpg',
]

/** Default / bounds of the `maxLines` cap (rendered reference lines). */
export const MAX_LINES_DEFAULT = 200
export const MAX_LINES_MIN = 1
export const MAX_LINES_MAX = 2000

/** Default / bounds of the `maxBytes` cap (rendered reference UTF-8 bytes). */
export const MAX_BYTES_DEFAULT = 20_000
export const MAX_BYTES_MIN = 1_000
export const MAX_BYTES_MAX = 200_000

/** Upper bound on stored blocklist entries (junk guard). */
export const OPEN_BLOCKLIST_MAX_ENTRIES = 64

/**
 * The composition base: what every unset field resolves to. The patch's
 * entry config carries this as the section's `base` layer, and the
 * browser half uses it verbatim whenever the config form has not
 * answered yet (or this deployment serves no settings provider at all).
 */
export const VSCODE_SIDEBAR_SETTINGS_BASE: Readonly<VscodeSidebarSettings> = Object.freeze({
  openAsDefault: false,
  openBlocklist: [...DEFAULT_OPEN_BLOCKLIST],
  serverUrl: '',
  pathMap: '',
  maxLines: MAX_LINES_DEFAULT,
  maxBytes: MAX_BYTES_DEFAULT,
})
