/**
 * The open-blocklist contract: file types the chat-open takeover must NOT
 * claim. When the `openAsDefault` switch is on, every chat-originated file
 * open (tool-row path links, prose file mentions, produced-files chips)
 * is rerouted into the VSCode tab — but some files (Office documents,
 * images, PDFs) belong to the sidebar's viewer surface, not a code
 * editor. This module owns the whole pure contract both sides share:
 *
 * - the stored shape (the `vscode-sidebar` settings section's
 * `openBlocklist` field — a string array of file extensions) and its
 * base default (the seven common binary types below; the official
 * settings layering makes unset resolve to that base, so an explicit
 * `[]` remains the stored decision "block nothing");
 * - normalization (case-insensitive, dot-tolerant, charset-checked) and
 *   matching (a path is blocked when its lowercased BASE NAME ends with
 *   `'.' + extension` — one rule that covers single-part (`pdf`),
 *   treats `a.notpdf` as NOT matching `pdf`, needs no special case for
 *   extension-less files, and supports multi-part extensions such as
 *   `tar.gz` when the entry itself carries the dot).
 *
 * The read side is per-call (readOpenBlocklist): the takeover gate calls
 * it on every open, so settings edits apply to the very next click with
 * no re-wiring.
 *
 * Scope: ONLY the chat-open seam (openIntercept.ts's wrapper). The
 * settings-page「打开配置文件」takeover (settingsTakeover.ts)
 * deliberately ignores this list — it opens a text document through its
 * own resolve route, and honoring the list there would let a blacklisted
 * `yaml` break the button.
 *
 * Dependency-free by design so the contract is unit-testable in isolation.
 *
 * @module dsh-sidebar-vscode/client/openBlocklist
 */
import { type SettingsScopeFace } from './settings.ts';
/** The settings field the blocklist persists under (kept as the test handle). */
export declare const OPEN_BLOCKLIST_KEY = "openBlocklist";
/** The out-of-the-box blocklist (one source with the Host schema's base). */
export { DEFAULT_OPEN_BLOCKLIST } from '../shared/settings.ts';
/**
 * Suggestions the settings row's dropdown offers beyond what is already
 * listed: the defaults plus other types a code editor renders poorly.
 * Order matters only for display; the input stays free-form.
 */
export declare const BLOCKLIST_SUGGESTIONS: readonly string[];
/** Upper bound on stored entries (junk guards; a real list never hits it). */
export declare const OPEN_BLOCKLIST_MAX_ENTRIES = 64;
/**
 * Normalize one user-entered extension: trim, lowercase, drop a leading
 * '.'; reject anything but letters/digits with internal '.'/'-' (a
 * multi-part entry like `tar.gz` stays one entry) and lengths outside
 * 1–16. Returns null for junk the row must refuse to add.
 */
export declare function normalizeExtension(raw: string): string | null;
/**
 * Parse the stored `openBlocklist` value. A non-array (unset key, string,
 * number, null) yields the code default; an array is normalized, deduped
 * (first-seen order), and capped at {@link OPEN_BLOCKLIST_MAX_ENTRIES}.
 * An explicit empty array passes through unchanged — "block nothing" is a
 * stored decision, not a missing one.
 */
export declare function parseOpenBlocklist(raw: unknown): readonly string[];
/**
 * Whether one path is blocked by the list: the lowercased base name ends
 * with `'.' + extension` for some entry. Dot files need their own entry
 * (`.gitignore` matches only a `gitignore` entry — a plain `ignore` entry
 * does not hit); an extension-less base name never matches; an empty
 * entry can never match (it is rejected at parse time, and re-checked
 * here so hand-built lists stay safe).
 */
export declare function isBlockedPath(path: string, list: readonly string[]): boolean;
/**
 * The suggestion entries not already listed — the settings row's dropdown
 * contents. First-seen order, deduped against the current list.
 */
export declare function blocklistSuggestions(current: readonly string[]): readonly string[];
/** The minimal settings-scope face the settings read needs (mirrors settings.ts). */
type ScopeLike = SettingsScopeFace | undefined;
/**
 * The effective blocklist for one open decision: the resolved
 * `vscode-sidebar` section's `openBlocklist` value parsed per call
 * (absent scope = the code default, matching readSettings's
 * base-fallback contract).
 */
export declare function readOpenBlocklist(scope: ScopeLike): readonly string[];
