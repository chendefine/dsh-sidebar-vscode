/**
 * The vscode-selection mention codec shared verbatim by the host half
 * (pre-step parsing and context injection) and the browser half (chip
 * serialization). Pure logic only: no Node builtins, no `@deepseek-ai/*`
 * value imports, so the same module passes the client bundle's purity gate.
 *
 * Wire form (the `ref` of every composer chip whose source is
 * 'vscode-reference', and the exact text the trigger codec serializes it to):
 *
 * ```
 * @[<escaped label>](dsh-vscode:<base64url(json payload)>)
 * ```
 *
 * The payload is self-contained — path, 1-based inclusive line range, the
 * captured snapshot text, its content hash, and capture-time flags — so the
 * draft text alone carries everything the host needs at `agent/pre-step`.
 * This mirrors the canonical-URI discipline of dsh-session references
 * (`dsh-session:`): decode must re-encode to the identical URI.
 *
 * @module dsh-sidebar-vscode/mentionCodec
 */

/** URI scheme reserved for VS Code editor-selection references. */
export const VSCODE_MENTION_SCHEME = 'dsh-vscode:'

/** URI scheme reserved for VS Code explorer file/folder references. */
export const VSCODE_RESOURCE_SCHEME = 'dsh-vscode-res:'

/** One captured editor selection riding inside a mention URI. */
export interface VscodeRefPayload {
  /** Codec version; only 1 exists. */
  readonly v: 1
  /** DSH-side path: workspace-relative when under the session cwd, else absolute. */
  readonly path: string
  /** First selected line, 1-based inclusive. */
  readonly start: number
  /** Last selected line, 1-based inclusive. */
  readonly end: number
  /** VS Code language id, omitted when unknown. */
  readonly lang?: string
  /** Captured snapshot text (line endings normalized; when truncated, the kept head and tail halves joined by a newline — the omission marker is rendered by the host, not stored here). */
  readonly text: string
  /** sha-256 hex prefix (16 chars) of the hash-normalized text; '' when unknown. */
  readonly hash: string
  /** Present only when the snapshot was truncated at capture (middle omitted). */
  readonly truncated?: boolean
  /** When truncated: char length of the kept head half inside `text` (the tail starts after the following newline). */
  readonly headLen?: number
  /** When truncated: whole lines omitted from the middle (0 when only bytes were cut). */
  readonly omitLines?: number
  /** When truncated: UTF-8 bytes omitted at char level beyond the omitted lines (extends the same gap at both seams). */
  readonly omitBytes?: number
  /** Present only when the editor buffer was unsaved at capture. */
  readonly dirty?: boolean
}

/** One explorer file/folder reference riding inside a resource mention URI. */
export interface VscodeResourcePayload {
  /** Codec version; only 1 exists. */
  readonly v: 1
  /** DSH-side path: workspace-relative when under the session cwd, else absolute. */
  readonly path: string
  /** Whether the referenced path is a folder (anything else is a file). */
  readonly type: 'file' | 'folder'
}

/** Either payload kind that can ride inside a vscode mention URI. */
export type VscodeMentionPayload = VscodeRefPayload | VscodeResourcePayload

/** Error thrown when an explicit `dsh-vscode:` mention or bare URI is malformed. */
export class VscodeMentionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'VscodeMentionError'
  }
}

// ---- base64url (browser-safe: atob/btoa + TextCoder work on host and web) ----

/** UTF-8 string → base64url without padding. */
export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url → UTF-8 string; throws on malformed input. */
export function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// ---- canonical URI codec ----

/** Whether the value structurally matches {@link VscodeRefPayload} (v1). */
export function isVscodeRefPayload(value: unknown): value is VscodeRefPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<VscodeRefPayload>
  return candidate.v === 1
    && typeof candidate.path === 'string' && candidate.path !== ''
    && typeof candidate.start === 'number' && Number.isInteger(candidate.start) && candidate.start >= 1
    && typeof candidate.end === 'number' && Number.isInteger(candidate.end) && candidate.end >= candidate.start
    && (candidate.lang === undefined || (typeof candidate.lang === 'string' && candidate.lang !== ''))
    && typeof candidate.text === 'string'
    && typeof candidate.hash === 'string' && /^[0-9a-f]{0,16}$/.test(candidate.hash)
    && (candidate.truncated === undefined || typeof candidate.truncated === 'boolean')
    && (candidate.headLen === undefined || (typeof candidate.headLen === 'number' && Number.isInteger(candidate.headLen) && candidate.headLen >= 0))
    && (candidate.omitLines === undefined || (typeof candidate.omitLines === 'number' && Number.isInteger(candidate.omitLines) && candidate.omitLines >= 0))
    && (candidate.omitBytes === undefined || (typeof candidate.omitBytes === 'number' && Number.isInteger(candidate.omitBytes) && candidate.omitBytes >= 0))
    && (candidate.dirty === undefined || typeof candidate.dirty === 'boolean')
}

/** Serialize one payload to its canonical URI (fixed key order; falsy flags omitted). */
export function encodeVscodeRefUri(payload: VscodeRefPayload): string {
  const wire: Record<string, unknown> = {
    v: 1,
    path: payload.path,
    start: payload.start,
    end: payload.end,
  }
  if (payload.lang !== undefined && payload.lang !== '') wire.lang = payload.lang
  wire.text = payload.text
  wire.hash = payload.hash
  if (payload.truncated === true) {
    wire.truncated = true
    if (payload.headLen !== undefined) wire.headLen = payload.headLen
    if (payload.omitLines !== undefined) wire.omitLines = payload.omitLines
    if (payload.omitBytes !== undefined) wire.omitBytes = payload.omitBytes
  }
  if (payload.dirty === true) wire.dirty = true
  return `${VSCODE_MENTION_SCHEME}${encodeBase64Url(JSON.stringify(wire))}`
}

/**
 * Decode and canonicalize one `dsh-vscode:` URI.
 * @param uri - complete URI string.
 * @returns the validated payload.
 * @throws VscodeMentionError when the URI is not a canonical v1 reference.
 */
export function decodeVscodeRefUri(uri: string): VscodeRefPayload {
  if (!uri.startsWith(VSCODE_MENTION_SCHEME)) {
    throw new VscodeMentionError(`not a vscode-selection URI: ${JSON.stringify(uri)}`)
  }
  const encoded = uri.slice(VSCODE_MENTION_SCHEME.length)
  if (encoded === '' || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new VscodeMentionError(`malformed vscode-selection URI payload`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeBase64Url(encoded))
  } catch (error: unknown) {
    throw new VscodeMentionError(`undecodable vscode-selection URI payload`, { cause: error })
  }
  if (!isVscodeRefPayload(parsed)) {
    throw new VscodeMentionError(`vscode-selection URI payload failed validation`)
  }
  const payload = parsed as VscodeRefPayload
  if (encodeVscodeRefUri(payload) !== uri) {
    throw new VscodeMentionError(`vscode-selection URI is not canonical`)
  }
  return payload
}

/** Whether the value structurally matches {@link VscodeResourcePayload} (v1). */
export function isVscodeResourcePayload(value: unknown): value is VscodeResourcePayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<VscodeResourcePayload>
  return candidate.v === 1
    && typeof candidate.path === 'string' && candidate.path !== ''
    && (candidate.type === 'file' || candidate.type === 'folder')
}

/** Serialize one resource payload to its canonical URI (fixed key order). */
export function encodeVscodeResourceUri(payload: VscodeResourcePayload): string {
  const wire: Record<string, unknown> = { v: 1, path: payload.path, type: payload.type }
  return `${VSCODE_RESOURCE_SCHEME}${encodeBase64Url(JSON.stringify(wire))}`
}

/**
 * Decode and canonicalize one `dsh-vscode-res:` URI.
 * @param uri - complete URI string.
 * @returns the validated payload.
 * @throws VscodeMentionError when the URI is not a canonical v1 resource.
 */
export function decodeVscodeResourceUri(uri: string): VscodeResourcePayload {
  if (!uri.startsWith(VSCODE_RESOURCE_SCHEME)) {
    throw new VscodeMentionError(`not a vscode-resource URI: ${JSON.stringify(uri)}`)
  }
  const encoded = uri.slice(VSCODE_RESOURCE_SCHEME.length)
  if (encoded === '' || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new VscodeMentionError(`malformed vscode-resource URI payload`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeBase64Url(encoded))
  } catch (error: unknown) {
    throw new VscodeMentionError(`undecodable vscode-resource URI payload`, { cause: error })
  }
  if (!isVscodeResourcePayload(parsed)) {
    throw new VscodeMentionError(`vscode-resource URI payload failed validation`)
  }
  const payload = parsed as VscodeResourcePayload
  if (encodeVscodeResourceUri(payload) !== uri) {
    throw new VscodeMentionError(`vscode-resource URI is not canonical`)
  }
  return payload
}

// ---- label + mention formatting ----

/** Escape `\` and `]` so a label cannot break out of the `@[…](…)` form. */
function escapeLabel(label: string): string {
  return label.replace(/[\\\]]/gu, match => `\\${match}`)
}

/** Reverse {@link escapeLabel}. */
function unescapeLabel(label: string): string {
  return label.replace(/\\(.)/gu, '$1')
}

/** Line-range label: `L10` for single lines, `L10-L25` otherwise. */
export function rangeLabel(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-L${end}`
}

/** Chip label / readable mention replacement: `path L10-L12`. */
export function referenceLabel(payload: Pick<VscodeRefPayload, 'path' | 'start' | 'end'>): string {
  return `${payload.path} ${rangeLabel(payload.start, payload.end)}`
}

/** Chip label / readable resource mention replacement: the bare path. */
export function resourceLabel(payload: Pick<VscodeResourcePayload, 'path'>): string {
  return payload.path
}

/** Render the canonical Markdown mention for one payload. */
export function formatVscodeMention(payload: VscodeRefPayload): string {
  return `@[${escapeLabel(referenceLabel(payload))}](${encodeVscodeRefUri(payload)})`
}

/** Render the canonical Markdown mention for one resource payload. */
export function formatVscodeResourceMention(payload: VscodeResourcePayload): string {
  return `@[${escapeLabel(resourceLabel(payload))}](${encodeVscodeResourceUri(payload)})`
}

/** Result of extracting vscode-selection mentions from one text value. */
export interface ParsedVscodeMentions {
  /** Text with every canonical mention replaced by its `@`-prefixed readable label. */
  text: string
  /** Decoded payloads (either kind) in first-appearance order (duplicates preserved). */
  references: VscodeMentionPayload[]
}

/**
 * Extract Markdown mentions and bare canonical URIs from one text value,
 * replacing each with its readable label prefixed by `@` — the outgoing
 * message keeps the familiar `@path L10-L12` (selections) / `@path`
 * (resources) reference shape. Both schemes match: `dsh-vscode:` for
 * selections and `dsh-vscode-res:` for explorer file/folder references (the
 * two prefixes are mutually exclusive — a `:` must directly follow the
 * scheme name, so neither alternative can over-match the other).
 *
 * A second, fail-soft pass then recovers *rendered-mention copies*: text
 * pasted back from a rendered chip (conversation bubble, context row,
 * external editor) where the Markdown sigils drift apart with whitespace —
 * `@ [ label ]( dsh-vscode: payload )` — or the mention lost its wrapper
 * and only the bare (possibly padded) URI survives. Every recovered
 * candidate must still decode as a canonical URI; anything else is left
 * untouched (recovery never throws, mirroring how such text was silently
 * ignored before the shapes were recognized).
 *
 * Mirrors the dsh-session discipline: an explicit Markdown mention fails on
 * any malformed URI; bare text counts as a reference only when a base64url
 * shape follows the scheme, and still fails when that candidate is not
 * canonical. The replacement exists only inside the per-turn pre-step model
 * view; the persisted transcript keeps the canonical `@[…](dsh-vscode:…)`
 * markdown, so the rewrite never leaks into stored history.
 *
 * @param text - text to normalize.
 * @returns readable text plus payloads in appearance order.
 * @throws VscodeMentionError on malformed explicit mentions.
 */
export function parseVscodeMentions(text: string): ParsedVscodeMentions {
  const references: VscodeMentionPayload[] = []
  const pattern = /@\[((?:\\.|[^\\\]])*)\]\((dsh-vscode(?:-res)?:[^\s)]*)\)|(dsh-vscode(?:-res)?:[A-Za-z0-9_-]+)/gu
  let rendered = text.replace(pattern, (_match, rawLabel: string | undefined, markdownUri: string | undefined, bareUri: string | undefined) => {
    const uri = markdownUri ?? bareUri
    /* v8 ignore next -- the two-alternative regex always captures exactly one URI group. */
    if (uri === undefined) throw new VscodeMentionError('vscode-selection URI is missing')
    if (uri.startsWith(VSCODE_RESOURCE_SCHEME)) {
      const resource = decodeVscodeResourceUri(uri)
      const label = rawLabel === undefined ? resourceLabel(resource) : unescapeLabel(rawLabel)
      references.push(resource)
      return `@${label}`
    }
    const payload = decodeVscodeRefUri(uri)
    const label = rawLabel === undefined ? referenceLabel(payload) : unescapeLabel(rawLabel)
    references.push(payload)
    return `@${label}`
  })
  // Recovery pass over whatever the strict scan left behind: whitespace-
  // padded copies of rendered mentions, plus bare padded URIs. Fail-soft by
  // construction — scanRecoveredMentions only returns decodable candidates.
  const recovered = scanRecoveredMentions(rendered)
  if (recovered.length > 0) {
    let out = ''
    let cursor = 0
    for (const mention of recovered) {
      out += `${rendered.slice(cursor, mention.start)}@${mention.label}`
      cursor = mention.end
      references.push(mention.payload)
    }
    rendered = `${out}${rendered.slice(cursor)}`
  }
  return { text: rendered, references }
}

// ---- recovery of rendered-mention copies ----

/** Markdown mention shape with whitespace-drifted sigils (rendered-chip copies). */
const RECOVERED_MD_RE
  = /@[ \t]*\[[^\]\n]*\][ \t]*\([ \t]*(dsh-vscode(?:-res)?):[ \t]*([A-Za-z0-9_-]+)[ \t]*\)/gu

/** Bare URI shape, canonical or with whitespace drifted around the colon. */
const RECOVERED_BARE_RE = /\b(dsh-vscode(?:-res)?):[ \t]*([A-Za-z0-9_-]+)/gu

/** One mention recovered from arbitrary text: payload, projections, and range. */
export interface RecoveredVscodeMention {
  /** Decoded, canonically validated payload (either kind). */
  readonly payload: VscodeMentionPayload
  /** Canonical mention rebuilt from the payload — the chip identity. */
  readonly mention: string
  /** Readable label rebuilt from the payload (the copied label is untrusted). */
  readonly label: string
  /** Half-open [start, end) range of the matched text. */
  readonly start: number
  /** Companion of {@link start}. */
  readonly end: number
}

/** Project one recovered payload onto its mention/label projections. */
function projectRecovered(payload: VscodeMentionPayload, start: number, end: number): RecoveredVscodeMention {
  return isVscodeResourcePayload(payload)
    ? {
        payload,
        mention: formatVscodeResourceMention(payload),
        label: resourceLabel(payload),
        start,
        end,
      }
    : {
        payload,
        mention: formatVscodeMention(payload),
        label: referenceLabel(payload),
        start,
        end,
      }
}

/** Decode one `scheme` + base64url pair; null when it is not a canonical URI. */
function recoverPayload(scheme: string, encoded: string): VscodeMentionPayload | null {
  const uri = `${scheme}:${encoded}`
  try {
    return scheme === VSCODE_RESOURCE_SCHEME.slice(0, -1)
      ? decodeVscodeResourceUri(uri)
      : decodeVscodeRefUri(uri)
  } catch {
    return null
  }
}

/**
 * Scan arbitrary text (typically a paste) for mention copies: the canonical
 * `@[…](dsh-vscode:…)` form, whitespace-padded renderings of it, and bare
 * (possibly padded) URIs — both schemes. Every candidate must decode as a
 * canonical URI or it is skipped: the copied label is never trusted (chips
 * render lossy basenames), so all projections are rebuilt from the payload.
 * A bare URI nested inside a Markdown-shaped match is claimed by the wrapper
 * (valid or not); one inside a wrapper that failed to decode still recovers
 * on its own — a copy truncated past the closing paren keeps its reference.
 *
 * @param text - text to scan.
 * @returns recovered mentions in text order (may be empty; never throws).
 */
export function scanRecoveredMentions(text: string): RecoveredVscodeMention[] {
  const found: RecoveredVscodeMention[] = []
  const claimed: { start: number, end: number }[] = []
  for (const match of text.matchAll(RECOVERED_MD_RE)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const recovered = recoverPayload(match[1] ?? '', match[2] ?? '')
    claimed.push({ start, end })
    if (recovered === null) continue
    found.push(projectRecovered(recovered, start, end))
  }
  for (const match of text.matchAll(RECOVERED_BARE_RE)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (claimed.some(range => start < range.end && end > range.start)) continue
    const recovered = recoverPayload(match[1] ?? '', match[2] ?? '')
    if (recovered === null) continue
    found.push(projectRecovered(recovered, start, end))
  }
  return found.sort((a, b) => a.start - b.start)
}

// ---- snapshot normalization, hashing input, and capture-time truncation ----

/** Hash-normalize snapshot text: LF line endings, no trailing newline. */
export function normalizeForHash(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
}

/** Bounds applied to a captured snapshot before it enters a payload. */
export interface SnapshotLimits {
  /** Maximum rendered code lines kept. */
  readonly maxLines: number
  /** Maximum UTF-8 bytes kept (may cut mid-line). */
  readonly maxBytes: number
}

/** Result of capture-time truncation. */
export interface TruncatedSnapshot {
  /** The kept text, LF-normalized: head and tail halves joined by one newline when the middle was omitted. */
  readonly text: string
  /** Whether either limit removed content. */
  readonly truncated: boolean
  /** Char length of the head half inside `text` (undefined when nothing was omitted). */
  readonly headLen?: number
  /** Whole lines omitted from the middle (0 when only bytes were cut; undefined when nothing was omitted). */
  readonly omitLines?: number
  /** UTF-8 bytes omitted at char level beyond the omitted lines (undefined when nothing was omitted). */
  readonly omitBytes?: number
}

/**
 * Normalize and bound one snapshot: LF endings, drop the trailing newline,
 * then cap by line count and encoded byte length — keeping the HEAD and TAIL
 * halves and omitting the MIDDLE (never the tail alone), so the model keeps
 * both the opening context and the closing statements of the selection. The
 * gap is described by the returned counters; the host renders the inline
 * `... (N lines omitted, L1-L2) ...` marker from them. Neither counter
 * includes the marker itself.
 */
export function truncateSnapshot(text: string, limits: SnapshotLimits): TruncatedSnapshot {
  const normalized = normalizeForHash(text)
  const maxLines = Math.max(1, Math.floor(limits.maxLines))
  const maxBytes = Math.max(1, Math.floor(limits.maxBytes))
  const encoder = new TextEncoder()
  const byteLengthOf = (value: string): number => encoder.encode(value).length

  /** Longest prefix of `value` whose UTF-8 length stays within `budget` (multi-byte safe). */
  const prefixWithin = (value: string, budget: number): string => {
    let lo = 0
    let hi = value.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (byteLengthOf(value.slice(0, mid)) <= budget) lo = mid
      else hi = mid - 1
    }
    return value.slice(0, lo)
  }
  /** Longest suffix of `value` whose UTF-8 length stays within `budget` (multi-byte safe). */
  const suffixWithin = (value: string, budget: number): string => {
    // Binary-search the smallest drop count whose remaining suffix fits.
    let lo = 0
    let hi = value.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (byteLengthOf(value.slice(mid)) <= budget) hi = mid
      else lo = mid + 1
    }
    return value.slice(lo)
  }

  // Gate 1 — line cap: keep the first and last half of the whole lines,
  // drop the lines in between.
  let head = normalized
  let tail = ''
  let omitLines = 0
  const lines = normalized.split('\n')
  if (lines.length > maxLines) {
    const headCount = Math.ceil(maxLines / 2)
    const tailCount = maxLines - headCount
    omitLines = lines.length - maxLines
    head = lines.slice(0, headCount).join('\n')
    tail = tailCount > 0 ? lines.slice(lines.length - tailCount).join('\n') : ''
  }

  // Gate 2 — byte cap: shrink the head from its end and the tail from its
  // start, extending the same omitted gap at both seams. When no line split
  // exists yet (single gate-2 hit), the tail half is carved out of the
  // head's own end so char-level cuts also omit the middle, never the tail.
  let omitBytes = 0
  if (byteLengthOf(head) + byteLengthOf(tail) > maxBytes) {
    const headBudget = Math.ceil(maxBytes / 2)
    const tailBudget = maxBytes - headBudget
    const keptHead = prefixWithin(head, headBudget)
    const keptTail = suffixWithin(tail === '' ? head : tail, tailBudget)
    omitBytes = byteLengthOf(head) + byteLengthOf(tail) - byteLengthOf(keptHead) - byteLengthOf(keptTail)
    head = keptHead
    tail = keptTail
  }

  if (omitLines === 0 && omitBytes === 0) return { text: normalized, truncated: false }
  return {
    text: [head, tail].filter(part => part !== '').join('\n'),
    truncated: true,
    headLen: head.length,
    omitLines,
    omitBytes,
  }
}

/** Prefix length of the sha-256 hex digest carried in payloads and tags. */
export const HASH_HEX_LENGTH = 16

/** First {@link HASH_HEX_LENGTH} hex chars of a sha-256 digest hex string. */
export function hashPrefix(hexDigest: string): string {
  return hexDigest.slice(0, HASH_HEX_LENGTH)
}
