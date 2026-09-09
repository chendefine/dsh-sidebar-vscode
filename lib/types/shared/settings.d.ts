/**
 * The `vscode-sidebar` settings model, shared by both plugin halves.
 *
 * The settings live in the OFFICIAL user-settings document under one
 * namespace (`vscode-sidebar`), not in any sidebar plugin's private blob:
 * the Host half registers the section (`src/settingsSection.ts`) so the
 * settings serve it, and the「设置 → 插件 → 插件配置」tab pairs that
 * namespace with this plugin's browser-registered card
 * (`settings.plugin.item`, keyed by the same string).
 *
 * This module is the ONE source of truth both halves compile against —
 * the Host half's schema defaults and the browser half's
 * settings-not-ready-yet fallbacks must never disagree:
 *
 * - `openAsDefault` gates the two file-open takeovers (chat-originated
 *   opens through `ctx.sidebarRight.openResource`, and the settings
 *   page's「打开配置文件」button). The better-sidebar-era meaning —
 *   swapping a fresh session's seeded Files tab — is gone with that
 *   system (the official sidebar seeds the guide page and keeps layout
 *   in memory only); the switch keeps its takeover roles.
 * - `openBlocklist` carries the unset-versus-empty rule through the
 *   settings document's own layering: the composition base IS the
 *   default list, an explicit `[]` is the stored decision "block
 *   nothing".
 *
 * @module dsh-sidebar-vscode/shared/settings
 */
/** The settings namespace this plugin owns (lowercase, per the Host pattern). */
export declare const VSCODE_SIDEBAR_SETTINGS_NAMESPACE = "vscode-sidebar";
/** The stored user preference for the VSCode sidebar tab. */
export interface VscodeSidebarSettings {
    /** Whether the two file-open takeovers are active (see module doc). */
    readonly openAsDefault: boolean;
    /**
     * File extensions the takeovers must not claim (blocklist order kept).
     * Mutable-array shaped to match the schemastery schema's inference;
     * every consumer treats it as read-only.
     */
    readonly openBlocklist: string[];
    /** The `code serve-web` base address ('' = the code default). */
    readonly serverUrl: string;
    /** DSH path prefix → VS Code container prefix rules ('' = no mapping). */
    readonly pathMap: string;
    /** Line cap for one injected reference. */
    readonly maxLines: number;
    /** UTF-8 byte cap for one injected reference. */
    readonly maxBytes: number;
}
/** The out-of-the-box blocklist: common binary/Office/image types. */
export declare const DEFAULT_OPEN_BLOCKLIST: readonly string[];
/** Default / bounds of the `maxLines` cap (rendered reference lines). */
export declare const MAX_LINES_DEFAULT = 200;
export declare const MAX_LINES_MIN = 1;
export declare const MAX_LINES_MAX = 2000;
/** Default / bounds of the `maxBytes` cap (rendered reference UTF-8 bytes). */
export declare const MAX_BYTES_DEFAULT = 20000;
export declare const MAX_BYTES_MIN = 1000;
export declare const MAX_BYTES_MAX = 200000;
/** Upper bound on stored blocklist entries (junk guard). */
export declare const OPEN_BLOCKLIST_MAX_ENTRIES = 64;
/**
 * The composition base: what every unset field resolves to. The Host half
 * registers this as the section's `base` layer, and the browser half uses
 * it verbatim whenever the settings scope has not answered yet (or this
 * deployment serves no settings provider at all).
 */
export declare const VSCODE_SIDEBAR_SETTINGS_BASE: Readonly<VscodeSidebarSettings>;
