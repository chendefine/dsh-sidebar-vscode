/**
 * The open-blocklist contract: file types the chat-open takeover must NOT
 * claim. When the `openAsDefault` switch is on, every chat-originated file
 * open (turn-tail produced chips, tool-row path links, prose file mentions)
 * is rerouted into the VSCode tab — but some files (Office documents,
 * images, PDFs) belong to the sidebar's viewer surface (better-sidebar's
 * built-in Files tab), not a code editor. This module owns the whole pure
 * contract both sides share:
 *
 * - the stored shape (`pluginSettings['dsh-sidebar-vscode:vscode']
 *   .openBlocklist` — a string array of file extensions) and its code
 *   default (the seven common binary types below);
 * - the UNSET-VERSUS-EMPTY rule: a missing (or non-array) key means the
 *   code default (the feature works out of the box), while an explicitly
 *   stored `[]` means "block nothing" — the same unset-means-default
 *   discipline `serverUrl` and the capture caps follow;
 * - normalization (case-insensitive, dot-tolerant, charset-checked) and
 *   matching (a path is blocked when its lowercased BASE NAME ends with
 *   `'.' + extension` — one rule that covers single-part (`pdf`), treats
 *   `a.notpdf` as NOT matching `pdf`, needs no special case for
 *   extension-less files, and supports multi-part extensions such as
 *   `tar.gz` when the entry itself carries the dot).
 *
 * The read side is per-call (readOpenBlocklist): the takeover gates call
 * it on every open, so settings edits apply to the very next click with
 * no re-wiring.
 *
 * Scope: ONLY the two chat-open seams (openIntercept.ts's wrappers and
 * the turn-tail chips). The settings-page「打开配置文件」takeover
 * (settingsTakeover.ts) deliberately ignores this list — it opens a text
 * document through its own resolve route, and honoring the list there
 * would let a blacklisted `yaml` break the button.
 *
 * Dependency-free by design so the contract is unit-testable in isolation.
 *
 * @module dsh-sidebar-vscode/client/openBlocklist
 */

import { readSettingValue } from './settings.ts'

/** The pluginSettings key of the open blocklist (a string[] of extensions). */
export const OPEN_BLOCKLIST_KEY = 'openBlocklist'

/** The out-of-the-box blocklist: common binary/Office/image types. */
export const DEFAULT_OPEN_BLOCKLIST: readonly string[] = [
  'pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpeg', 'jpg',
]

/**
 * Suggestions the settings row's dropdown offers beyond what is already
 * listed: the defaults plus other types a code editor renders poorly.
 * Order matters only for display; the input stays free-form.
 */
export const BLOCKLIST_SUGGESTIONS: readonly string[] = [
  ...DEFAULT_OPEN_BLOCKLIST,
  'gif', 'webp', 'bmp', 'ico', 'svg', 'csv', 'zip', 'gz', 'tar.gz', '7z',
  'exe', 'dll', 'so', 'dylib', 'mp4', 'mov', 'mp3', 'wav',
]

/** Upper bound on stored entries (junk guards; a real list never hits it). */
export const OPEN_BLOCKLIST_MAX_ENTRIES = 64

/** Longest accepted extension (multi-part suffixes included). */
const MAX_EXTENSION_LENGTH = 16

/**
 * Normalize one user-entered extension: trim, lowercase, drop a leading
 * '.'; reject anything but letters/digits with internal '.'/'-' (a
 * multi-part entry like `tar.gz` stays one entry) and lengths outside
 * 1–16. Returns null for junk the row must refuse to add.
 */
export function normalizeExtension(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  while (value.startsWith('.')) value = value.slice(1)
  if (value.length < 1 || value.length > MAX_EXTENSION_LENGTH) return null
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(value)) return null
  return value
}

/**
 * Parse the stored `openBlocklist` value. A non-array (unset key, string,
 * number, null) yields the code default; an array is normalized, deduped
 * (first-seen order), and capped at {@link OPEN_BLOCKLIST_MAX_ENTRIES}.
 * An explicit empty array passes through unchanged — "block nothing" is a
 * stored decision, not a missing one.
 */
export function parseOpenBlocklist(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return DEFAULT_OPEN_BLOCKLIST
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const normalized = normalizeExtension(entry)
    if (normalized === null || seen.has(normalized)) continue
    if (out.length >= OPEN_BLOCKLIST_MAX_ENTRIES) break
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/** The file name of a path (both separators), before any extension match. */
function baseNameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * Whether one path is blocked by the list: the lowercased base name ends
 * with `'.' + extension` for some entry. Dot files need their own entry
 * (`.gitignore` matches only a `gitignore` entry — a plain `ignore` entry
 * does not hit); an extension-less base name never matches; an empty
 * entry can never match (it is rejected at parse time, and re-checked
 * here so hand-built lists stay safe).
 */
export function isBlockedPath(path: string, list: readonly string[]): boolean {
  const name = baseNameOf(path.trim()).toLowerCase()
  if (name === '' || !name.includes('.')) return false
  for (const extension of list) {
    if (extension === '') continue
    if (name.endsWith(`.${extension}`)) return true
  }
  return false
}

/**
 * The suggestion entries not already listed — the settings row's dropdown
 * contents. First-seen order, deduped against the current list.
 */
export function blocklistSuggestions(current: readonly string[]): readonly string[] {
  const listed = new Set(current)
  return BLOCKLIST_SUGGESTIONS.filter(entry => !listed.has(entry))
}

/** The minimal store face the settings read needs (mirrors settings.ts). */
interface StoreLike {
  getSnapshot(): { prefs: { pluginSettings: Record<string, Record<string, unknown>> } }
}

/**
 * The effective blocklist for one open decision: the stored
 * `openBlocklist` value parsed per call (absent store = the code default,
 * matching readSettingValue's undefined-for-no-store contract).
 */
export function readOpenBlocklist(store: StoreLike | undefined): readonly string[] {
  return parseOpenBlocklist(readSettingValue(store, OPEN_BLOCKLIST_KEY))
}
