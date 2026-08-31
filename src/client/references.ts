/**
 * Client-side vscode-selection references: building composer chips from a
 * decoded clipboard payload, inserting them through the conversation input
 * machine, recovering pasted mention copies back into chips, and computing
 * the reference-rail view over the live occurrence table.
 *
 * Everything here is structurally typed against the ui-conversation /
 * ui-input-trigger contracts (the browser bundle's purity gate forbids
 * `@deepseek-ai/*` value imports, and the shapes are frozen public seams).
 *
 * TWO host generations are served, keyed by one structural probe
 * ({@link isLexicalInput} — the Lexical-era shell owns an `editor`; the
 * textarea-era machine does not):
 *
 * - Lexical hosts (DSH ≥ 0.1.2-alpha.2): the draft is the CLIPBOARD
 *   projection (each chip expands to its `clipboardText` — here the full
 *   canonical mention) while `TokenSpan`s are DETECT-projection offsets
 *   (each chip is one `￼` char); the two planes diverge as soon as any chip
 *   exists. Insertion still goes through `SessionInput.insertReference`
 *   with a revision-CAS'd detect span; plain-text degradation rides the
 *   scoped `'slash/input-insert-text'` bail event (a span-addressed editor
 *   write that never flattens other chips — unlike `setDraft`, which
 *   replaces the whole editor as plain text); chip removal rides
 *   `'slash/input-consume-token'`. Spans and returned carets are detect
 *   offsets; {@link detectLengthOf}/{@link detectOfClipboard}/
 *   {@link clipboardOfDetect} translate between the planes through the
 *   occurrence table.
 *
 * - Textarea-era hosts: one text plane — the draft itself. The historical
 *   span math (draft-tail append, `setDraft` splice with an edit range)
 *   stays exactly as it was.
 *
 * In both worlds every chip is an atomic occurrence: backspace deletes it
 * whole, submit serializes it through this plugin's trigger-source codec,
 * and the draft text (not any side table) is the single store of what will
 * be injected at `agent/pre-step`.
 *
 * @module dsh-sidebar-vscode/client/references
 */

import { reverseMapPath } from './paths.ts'
import {
  MAX_BYTES_DEFAULT,
  MAX_BYTES_MAX,
  MAX_BYTES_MIN,
  MAX_LINES_DEFAULT,
  MAX_LINES_MAX,
  MAX_LINES_MIN,
  clampCap,
} from './settings.ts'
import type { ResourceListPayload, SelectionPayload } from './selection.ts'
import {
  formatVscodeMention,
  formatVscodeResourceMention,
  decodeVscodeRefUri,
  decodeVscodeResourceUri,
  hashPrefix,
  isVscodeResourcePayload,
  normalizeForHash,
  referenceLabel,
  resourceLabel,
  scanRecoveredMentions,
  truncateSnapshot,
  type RecoveredVscodeMention,
  type VscodeRefPayload,
  type VscodeResourcePayload,
} from '../mentionCodec.ts'

/** The occurrence/source name this plugin registers in the trigger registry. */
export const VSCODE_SOURCE = 'vscode-reference'

// ---- structural faces of the frozen ui-conversation / runtime contracts ----

/** One inline reference chip insertion (ui-input-trigger `ReferenceInsert`). */
export interface ReferenceInsertLike {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance?: 'session' | 'file' | 'folder'
  readonly clipboardText: string
}

/** Draft-time span with revision CAS (ui-input-trigger `TokenSpan`). */
export interface TokenSpanLike {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** One settled chip row in the input machine's occurrence table. */
export interface OccurrenceLike {
  readonly occurrenceId: number
  readonly source: string
  readonly ref: string
  readonly offset: number
  readonly length: number
  readonly label: string
  /** Clipboard/persistence projection of the chip (Lexical hosts carry it). */
  readonly clipboardText?: string
  readonly invalid?: boolean
}

/** Published per-session input state (the InputZone currency). */
export interface InputStateLike {
  readonly draft: string
  readonly draftRev: number
  readonly phase: string
  readonly occurrences: readonly OccurrenceLike[]
}

/** Per-session input facade (structural `SessionInput`). */
export interface SessionInputFace {
  insertReference(ref: ReferenceInsertLike, span: TokenSpanLike): boolean
  /**
   * Whole-draft write. On Lexical hosts this REPLACES the editor content as
   * plain text — flattening every chip — so it is this plugin's last-resort
   * fallback only; the textarea-era machine treated it as a splice and kept
   * its occurrences reconciled by diff-scan.
   */
  setDraft(text: string, editRange?: { readonly start: number, readonly end: number, readonly insertedLength: number }): void
  readonly state: { getSnapshot(): InputStateLike }
}

/**
 * The Lexical-era composer keyboard face (`conversation.input.keyboard(id)`
 * answers the per-session shell structurally). `caretSpan` reads the live
 * editor selection — the user's last caret — in detect coordinates.
 */
export interface ComposerKeyboardFace {
  caretSpan(): { readonly start: number, readonly end: number }
}

/** Sessions service face: session-scope context resolution. */
export interface SessionsServiceFace {
  scope(id: string): unknown | undefined
}

/** Conversation service face: the per-session input resolver. */
export interface ConversationServiceFace {
  readonly input: {
    for(actx: unknown): SessionInputFace
    /** Lexical hosts: the per-session keyboard face (may throw on unknown ids). */
    keyboard?(sessionId: string): ComposerKeyboardFace
  }
}

/**
 * Scoped input-mutation events the Lexical-era hub listens for on every
 * session scope (declared public in the ui-conversation input contract —
 * the host's own trigger pipeline dispatches through the same seam).
 * Structural and optional: absence simply keeps the legacy write paths.
 */
export interface SessionScopeFace {
  bail?(
    thisArg: unknown,
    event: 'slash/input-insert-text' | 'slash/input-consume-token',
    request: unknown,
  ): boolean | undefined
}

// ---- host generation probe + projection-plane translation ----

/**
 * Whether one input facade is the Lexical-era shell. The shell owns its
 * editor (`readonly editor: LexicalEditor`); the textarea-era machine never
 * did. Everything plane-sensitive branches on this single probe.
 */
export function isLexicalInput(input: SessionInputFace): boolean {
  return 'editor' in input && (input as { editor?: unknown }).editor !== undefined
}

/** Occurrence table sorted by offset (the machine's published invariant). */
function sortedOccurrences(occurrences: readonly OccurrenceLike[]): readonly OccurrenceLike[] {
  return [...occurrences].sort((a, b) => a.offset - b.offset)
}

/**
 * Length of the detect projection: the clipboard draft minus every chip's
 * expansion beyond its single detect character.
 */
export function detectLengthOf(snapshot: { readonly draft: string, readonly occurrences: readonly OccurrenceLike[] }): number {
  const chips = snapshot.occurrences.reduce((sum, occ) => sum + Math.max(0, occ.length - 1), 0)
  return Math.max(0, snapshot.draft.length - chips)
}

/**
 * Clipboard offset → detect offset (host parity with
 * `detectOffsetOfClipboardOffset`): offsets before a chip map before it;
 * offsets at or inside a chip's expansion snap to the chip's trailing edge.
 */
export function detectOfClipboard(clipboardOffset: number, occurrences: readonly OccurrenceLike[]): number {
  let adjust = 0
  for (const occ of sortedOccurrences(occurrences)) {
    const end = occ.offset + occ.length
    if (clipboardOffset >= end) {
      adjust += Math.max(0, occ.length - 1)
      continue
    }
    if (clipboardOffset <= occ.offset) return clipboardOffset - adjust
    // Inside the expansion: the chip's trailing detect edge.
    return occ.offset - adjust + 1
  }
  return clipboardOffset - adjust
}

/**
 * Detect offset → clipboard offset: the inverse of {@link detectOfClipboard}.
 * A detect offset at a chip's leading edge maps before its expansion; at the
 * trailing edge (leading+1) it maps after it.
 */
export function clipboardOfDetect(detectOffset: number, occurrences: readonly OccurrenceLike[]): number {
  let adjust = 0
  for (const occ of sortedOccurrences(occurrences)) {
    const detectStart = occ.offset - adjust
    if (detectOffset >= detectStart + 1) {
      adjust += Math.max(0, occ.length - 1)
      continue
    }
    break
  }
  return detectOffset + adjust
}

// ---- payload → reference chips ----

/** Capture bounds and path translation applied to one clipboard payload. */
export interface RefBuildOptions {
  /** Path-translation rules (container path → DSH path), from parsePathMap. */
  readonly reverseRules?: readonly { from: string, to: string }[]
  /** The session's authoritative cwd, used to relativize DSH absolute paths. */
  readonly cwd?: string
  /** Rendered code-line cap (unset → 200; clamped to 1–2000). */
  readonly maxLines?: number
  /** Rendered code byte cap (unset → 20000; clamped to 1000–200000). */
  readonly maxBytes?: number
}

/**
 * Resolve the model-facing path for one captured path: reverse-map the
 * container absolute path into DSH space when possible, then relativize
 * against the session cwd when the result sits underneath it. The same
 * resolution serves editor selections and explorer resources.
 *
 * @param path - the container-side absolute path.
 * @param relative - the workspace-relative path (when the VS Code workspace
 * matches the DSH workspace root), the next best form when no rule matches.
 */
export function resolveWorkspacePath(
  path: string,
  relative: string | undefined,
  reverseRules: readonly { from: string, to: string }[] | undefined,
  cwd: string | undefined,
): string {
  let absolute: string | undefined
  if (reverseRules !== undefined) absolute = reverseMapPath(path, reverseRules) ?? undefined
  if (absolute === undefined) {
    // No reverse mapping: the workspace-relative path (when the VS Code
    // workspace matches the DSH workspace root) is the next best form.
    return relative !== undefined && relative !== '' ? relative : path
  }
  if (cwd !== undefined && cwd !== '' && absolute.startsWith(`${cwd}/`)) {
    return absolute.slice(cwd.length + 1)
  }
  return absolute
}

/** sha-256 hex prefix of the hash-normalized snapshot; '' when unavailable. */
export async function hashSnapshot(text: string): Promise<string> {
  const normalized = normalizeForHash(text)
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) return ''
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return hashPrefix(hex)
}

/**
 * Build one atomic composer chip per selection span of a decoded payload.
 * @param payload - the decoded clipboard envelope payload.
 * @param options - path translation and capture bounds.
 * @returns one {@link ReferenceInsertLike} per span, in editor order.
 */
export async function buildRefsFromPayload(
  payload: SelectionPayload,
  options: RefBuildOptions,
): Promise<ReferenceInsertLike[]> {
  // Unset caps fall back to the code defaults; explicit caps clamp to the
  // declared UI bounds (settings.ts is the single source of truth, so the
  // pipeline can never honor a value the settings field would not show).
  const maxLines = options.maxLines === undefined
    ? MAX_LINES_DEFAULT
    : clampCap(options.maxLines, MAX_LINES_MIN, MAX_LINES_MAX)
  const maxBytes = options.maxBytes === undefined
    ? MAX_BYTES_DEFAULT
    : clampCap(options.maxBytes, MAX_BYTES_MIN, MAX_BYTES_MAX)
  const path = resolveWorkspacePath(payload.path, payload.relative, options.reverseRules, options.cwd)
  const refs: ReferenceInsertLike[] = []
  for (const span of payload.spans) {
    const snapshot = truncateSnapshot(span.text, { maxLines, maxBytes })
    const chipPayload: VscodeRefPayload = {
      v: 1,
      path,
      start: span.startLine,
      end: span.endLine,
      ...(payload.language !== undefined && payload.language !== '' ? { lang: payload.language } : {}),
      text: snapshot.text,
      hash: await hashSnapshot(snapshot.text),
      ...(snapshot.truncated ? {
        truncated: true,
        headLen: snapshot.headLen,
        omitLines: snapshot.omitLines,
        omitBytes: snapshot.omitBytes,
      } : {}),
      ...(payload.dirty === true ? { dirty: true } : {}),
    }
    const mention = formatVscodeMention(chipPayload)
    refs.push({
      source: VSCODE_SOURCE,
      ref: mention,
      label: referenceLabel(chipPayload),
      appearance: 'file',
      clipboardText: mention,
    })
  }
  return refs
}

/** Path translation applied to one explorer resource payload (no caps — nothing is captured). */
export interface ResourceRefOptions {
  /** Path-translation rules (container path → DSH path), from parsePathMap. */
  readonly reverseRules?: readonly { from: string, to: string }[]
  /** The session's authoritative cwd, used to relativize DSH absolute paths. */
  readonly cwd?: string
}

/**
 * Build one atomic composer chip per explorer-selected resource. Unlike
 * selections, a resource chip carries no snapshot: the canonical mention
 * holds only the resolved path and the file/folder kind, and the host half
 * expands it into a content-less `<file-selection>`/`<folder-selection>`
 * context marker.
 * @param payload - the decoded clipboard envelope payload.
 * @param options - path translation.
 * @returns one {@link ReferenceInsertLike} per resource, in explorer order.
 */
export function buildResourceRefsFromPayload(
  payload: ResourceListPayload,
  options: ResourceRefOptions,
): ReferenceInsertLike[] {
  return payload.resources.map((item) => {
    const path = resolveWorkspacePath(item.path, item.relative, options.reverseRules, options.cwd)
    const chipPayload: VscodeResourcePayload = { v: 1, path, type: item.type }
    const mention = formatVscodeResourceMention(chipPayload)
    return {
      source: VSCODE_SOURCE,
      ref: mention,
      label: resourceLabel(chipPayload),
      appearance: item.type,
      clipboardText: mention,
    }
  })
}

// ---- chip insertion through the input machine ----

/** Outcome of landing a batch of references on one session's composer. */
export interface InsertOutcome {
  /** References that landed as atomic chips. */
  readonly inserted: number
  /** References that landed as plain-text mentions (machine refused the chip). */
  readonly textFallback: number
  /**
   * Offset just past the last landed reference (the restored caret), in the
   * plane the addressed composer's selection speaks — detect coordinates on
   * Lexical hosts, draft coordinates on textarea-era ones; undefined when
   * nothing landed or no session composer resolved at all.
   */
  readonly caret?: number
  /** True when no session composer could be resolved at all. */
  readonly failed: boolean
}

/** Await one macrotask tick (retry backoff). */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Append one mention as plain text onto a draft (separator-aware). */
function appendMention(draft: string, mention: string): string {
  const separator = draft !== '' && !/\s$/u.test(draft) ? ' ' : ''
  return `${draft}${separator}${mention} `
}

/** Clamp one caller-addressed range into [0, length] with start ≤ end. */
function clampSpan(range: { start: number, end: number }, length: number): { start: number, end: number } {
  const a = Math.max(0, Math.min(range.start, length))
  const b = Math.max(0, Math.min(range.end, length))
  return a <= b ? { start: a, end: b } : { start: b, end: a }
}

/** Dispatch one scoped input event (`'slash/input-insert-text'`); false when unhandled. */
function bailInsertText(actx: unknown, request: unknown): boolean {
  const scope = actx as SessionScopeFace | undefined
  if (scope === null || scope === undefined || typeof scope.bail !== 'function') return false
  try {
    return scope.bail(scope, 'slash/input-insert-text', request) === true
  } catch {
    return false
  }
}

/** Dispatch one scoped input event (`'slash/input-consume-token'`); false when unhandled. */
function bailConsumeToken(actx: unknown, request: unknown): boolean {
  const scope = actx as SessionScopeFace | undefined
  if (scope === null || scope === undefined || typeof scope.bail !== 'function') return false
  try {
    return scope.bail(scope, 'slash/input-consume-token', request) === true
  } catch {
    return false
  }
}

/**
 * The machine's trailing-gap rule, evaluated through the clipboard draft:
 * a chip (or mention) landing at `clipboardPoint` is followed by one space
 * unless the text there already starts with one — including at the draft
 * end, where the machine appends the gap itself.
 */
function trailingGapAt(snapshot: InputStateLike, clipboardPoint: number): string {
  return snapshot.draft[clipboardPoint] === ' ' ? '' : ' '
}

/**
 * Insert references as atomic chips on the addressed session's composer,
 * at the caller's addressed point: the first reference replaces the `at`
 * range (a bare caret is the zero-width case), every following one splices
 * at the point just past its predecessor, and a missing `at` keeps the
 * historical end-of-draft append. Spans are detect-projection offsets on
 * Lexical hosts ({@link isLexicalInput}) and draft offsets on textarea-era
 * ones — `at` must come from the same plane (the keyboard face's
 * `caretSpan()`, the composer DOM mapping, or a textarea selection).
 *
 * Whenever the input machine refuses the chip transaction (mid-submit
 * phases, CAS loss after retry) the canonical mention lands as plain text
 * over the same point — on Lexical hosts through the span-addressed
 * `'slash/input-insert-text'` event so every OTHER chip survives intact
 * (the whole-draft `setDraft` write runs only when that host exposes no
 * event seam), and on textarea-era hosts directly through `setDraft`.
 * The host boundary parses plain-text mentions identically, so the text
 * path degrades only the chip affordance — never the context.
 *
 * @param sessions - the sessions service (scope resolution).
 * @param conversation - the conversation service (input resolver).
 * @param sessionId - the addressed session.
 * @param refs - references to land, in order.
 * @param at - the range the references replace (usually the composer
 * caret; a non-zero width is the selection it replaces). Undefined = append
 * at the draft tail.
 * @returns the per-path landing counts plus the post-landing caret.
 */
export async function insertVscodeReferences(
  sessions: SessionsServiceFace | undefined,
  conversation: ConversationServiceFace | undefined,
  sessionId: string | undefined,
  refs: readonly ReferenceInsertLike[],
  at?: { readonly start: number, readonly end: number },
): Promise<InsertOutcome> {
  if (refs.length === 0) return { inserted: 0, textFallback: 0, failed: false }
  const actx = sessionId !== undefined ? sessions?.scope(sessionId) : undefined
  if (actx === undefined || conversation === undefined) {
    return { inserted: 0, textFallback: 0, failed: true }
  }
  let input: SessionInputFace
  try {
    input = conversation.input.for(actx)
  } catch {
    return { inserted: 0, textFallback: 0, failed: true }
  }
  const lexical = isLexicalInput(input)
  /** The current span-addressable length: detect plane or the draft itself. */
  const planeLength = (snapshot: InputStateLike): number =>
    lexical ? detectLengthOf(snapshot) : snapshot.draft.length

  let inserted = 0
  let textFallback = 0
  let caret: number | undefined
  // The next span to address: the caller's range for the first reference,
  // the point just past the previous one afterwards. undefined until a
  // first range exists (and throughout when the caller addressed none).
  let next: { start: number, end: number } | undefined = at === undefined ? undefined : { start: at.start, end: at.end }
  for (const ref of refs) {
    let landed = false
    for (let attempt = 0; attempt < 2 && !landed; attempt++) {
      const snapshot = input.state.getSnapshot()
      if (snapshot.phase !== 'plain' && snapshot.phase !== 'claimed') {
        await delay(150)
        continue
      }
      const span = next === undefined
        ? { start: planeLength(snapshot), end: planeLength(snapshot) }
        : clampSpan(next, planeLength(snapshot))
      const beforeLen = planeLength(snapshot)
      landed = input.insertReference(ref, { ...span, draftRev: snapshot.draftRev })
      if (landed) {
        // The chip (plus its machine-added trailing gap) replaced [span):
        // the next point is exactly past the inserted region, measured off
        // the plane's own length delta so the machine's gap rule never has
        // to be copied.
        const afterLen = planeLength(input.state.getSnapshot())
        caret = span.start + (afterLen - beforeLen) + (span.end - span.start)
        next = { start: caret, end: caret }
      } else {
        await delay(150)
      }
    }
    if (landed) {
      inserted++
      continue
    }
    // Machine refused the chip transaction twice: land the canonical
    // mention as plain text — the host parses it exactly the same way.
    const snapshot = input.state.getSnapshot()
    if (next === undefined) {
      // No addressed point: the separator-aware tail append.
      const separator = snapshot.draft !== '' && !/\s$/u.test(snapshot.draft) ? ' ' : ''
      const text = `${separator}${ref.ref} `
      const tail = planeLength(snapshot)
      if (bailInsertText(actx, { text, span: { start: tail, end: tail, draftRev: snapshot.draftRev } })) {
        caret = tail + text.length
      } else {
        const draft = appendMention(snapshot.draft, ref.ref)
        input.setDraft(draft)
        caret = draft.length
      }
    } else {
      const span = clampSpan(next, planeLength(snapshot))
      if (lexical) {
        const clipboardStart = clipboardOfDetect(span.start, snapshot.occurrences)
        const clipboardEnd = clipboardOfDetect(span.end, snapshot.occurrences)
        const gap = trailingGapAt(snapshot, clipboardEnd)
        const text = `${ref.ref}${gap}`
        if (bailInsertText(actx, { text, span: { ...span, draftRev: snapshot.draftRev } })) {
          caret = span.start + text.length
        } else {
          input.setDraft(
            `${snapshot.draft.slice(0, clipboardStart)}${text}${snapshot.draft.slice(clipboardEnd)}`,
            { start: clipboardStart, end: clipboardEnd, insertedLength: text.length },
          )
          // The flattening setDraft rewrote the WHOLE document as plain
          // text, so the caret the new draft speaks is the clipboard-
          // projection offset — span.start (detect plane) would land inside
          // the flattened mention text of every chip before the point.
          caret = clipboardStart + text.length
        }
      } else {
        // Paste geometry (the mention plus the trailing-gap rule, no leading
        // separator) over the addressed draft range: the selection it
        // addresses is REPLACED, like any paste — not inserted before it.
        const point = span.start
        const tail = snapshot.draft.slice(span.end)
        const gap = tail.length === 0 || tail[0] !== ' ' ? ' ' : ''
        const replacement = `${ref.ref}${gap}`
        input.setDraft(
          `${snapshot.draft.slice(0, point)}${replacement}${tail}`,
          { start: point, end: span.end, insertedLength: replacement.length },
        )
        caret = point + replacement.length
      }
      next = { start: caret, end: caret }
    }
    textFallback++
  }
  return caret === undefined
    ? { inserted, textFallback, failed: false }
    : { inserted, textFallback, failed: false, caret }
}

// ---- paste recovery: rendered-mention copies land back as chips ----

/** One mention-carrying paste segment: verbatim prose or one reference chip. */
export type RecoveredPastePart =
  | { readonly kind: 'text', readonly text: string }
  | { readonly kind: 'ref', readonly ref: ReferenceInsertLike }

/** Parsed paste: interleaved prose and mention parts, plus the chips alone. */
export interface RecoveredPaste {
  readonly parts: readonly RecoveredPastePart[]
  readonly refs: readonly ReferenceInsertLike[]
}

/**
 * Build one atomic composer chip per recovered mention payload. The payload
 * already carries its (possibly truncated) capture snapshot and resolved
 * path, so nothing is re-derived — the chip identity is the canonical
 * mention rebuilt from the payload, exactly like a freshly captured one.
 * @param mentions - recovered mentions (either kind), in text order.
 * @returns one {@link ReferenceInsertLike} per mention.
 */
export function refsFromRecoveredMentions(
  mentions: readonly RecoveredVscodeMention[],
): ReferenceInsertLike[] {
  return mentions.map(({ payload }) => {
    if (isVscodeResourcePayload(payload)) {
      const mention = formatVscodeResourceMention(payload)
      return {
        source: VSCODE_SOURCE,
        ref: mention,
        label: resourceLabel(payload),
        appearance: payload.type,
        clipboardText: mention,
      }
    }
    const mention = formatVscodeMention(payload)
    return {
      source: VSCODE_SOURCE,
      ref: mention,
      label: referenceLabel(payload),
      appearance: 'file',
      clipboardText: mention,
    }
  })
}

/**
 * Parse pasted text into prose parts plus reference chips for every
 * recovered mention copy (see {@link scanRecoveredMentions}). Edge
 * whitespace is trimmed — copying a rendered item drags surrounding blank
 * lines that a paste should not re-insert — while interior text stays
 * verbatim so a prose-and-mention paste keeps its shape.
 * @param text - the pasted plain text.
 * @returns the parsed paste, or null when no mention copy is recoverable.
 */
export function parseRecoveredPaste(text: string): RecoveredPaste | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const mentions = scanRecoveredMentions(trimmed)
  if (mentions.length === 0) return null
  const refs = refsFromRecoveredMentions(mentions)
  const parts: RecoveredPastePart[] = []
  let cursor = 0
  mentions.forEach((mention, index) => {
    if (mention.start > cursor) parts.push({ kind: 'text', text: trimmed.slice(cursor, mention.start) })
    parts.push({ kind: 'ref', ref: refs[index]! })
    cursor = mention.end
  })
  if (cursor < trimmed.length) parts.push({ kind: 'text', text: trimmed.slice(cursor) })
  return { parts, refs }
}

/** Outcome of landing one recovered paste on a session's composer. */
export interface PasteLandingOutcome extends InsertOutcome {
  /**
   * Offset just past the landed paste region (the restored caret), in the
   * plane the addressed composer's selection speaks; undefined when no
   * session composer resolved at all.
   */
  readonly caret?: number
}

/** Chip display text — what a chip occupies in the draft's text planes. */
function chipDisplay(ref: ReferenceInsertLike): string {
  return `@${ref.label}`
}

/**
 * Land one parsed paste on the addressed session's composer at the paste
 * selection: the prose inserts verbatim and every mention becomes an atomic
 * chip.
 *
 * Lexical hosts ({@link isLexicalInput}): one cursor walk over the parts in
 * detect coordinates — each prose run rides the span-addressed
 * `'slash/input-insert-text'` event and each mention a chip
 * `insertReference` at the cursor, the cursor advancing by the measured
 * detect delta after every step. Chips already in the draft survive
 * untouched (no whole-draft write ever happens), and a chip step the
 * machine refuses (transient phases, CAS loss) degrades that one mention
 * to its canonical plain text over the same range.
 *
 * Textarea-era hosts: the historical algorithm — ONE whole-draft write of
 * the pasted display text followed by per-chip upgrades from the LAST chip
 * backwards — stays verbatim.
 *
 * @param sessions - the sessions service (scope resolution).
 * @param conversation - the conversation service (input resolver).
 * @param sessionId - the addressed session.
 * @param parts - the parsed paste (see {@link parseRecoveredPaste}).
 * @param selection - the range the paste replaces (usually the caret), in
 * the plane the addressed composer's selection speaks.
 * @returns per-path landing counts plus the post-landing caret.
 */
export async function pasteRecoveredMentions(
  sessions: SessionsServiceFace | undefined,
  conversation: ConversationServiceFace | undefined,
  sessionId: string | undefined,
  parts: readonly RecoveredPastePart[],
  selection: { readonly start: number, readonly end: number },
): Promise<PasteLandingOutcome> {
  const refs = parts.filter((part): part is Extract<RecoveredPastePart, { kind: 'ref' }> => part.kind === 'ref')
  if (refs.length === 0) return { inserted: 0, textFallback: 0, failed: false }
  const actx = sessionId !== undefined ? sessions?.scope(sessionId) : undefined
  if (actx === undefined || conversation === undefined) {
    return { inserted: 0, textFallback: 0, failed: true }
  }
  let input: SessionInputFace
  try {
    input = conversation.input.for(actx)
  } catch {
    return { inserted: 0, textFallback: 0, failed: true }
  }

  if (isLexicalInput(input)) return pasteLexical(actx, input, parts, refs, selection)
  return pasteLegacy(input, parts, refs, selection)
}

/** The Lexical-host paste: a detect-coordinate cursor walk over the parts. */
async function pasteLexical(
  actx: unknown,
  input: SessionInputFace,
  parts: readonly RecoveredPastePart[],
  refs: readonly { readonly kind: 'ref' }[],
  selection: { readonly start: number, readonly end: number },
): Promise<PasteLandingOutcome> {
  // Frozen phases (mid-submit) still accept span-addressed text writes: the
  // paste lands as canonical mention text for the next message instead of
  // evaporating — without flattening whatever chips the draft still shows.
  const before = input.state.getSnapshot()
  if (before.phase !== 'plain' && before.phase !== 'claimed') {
    const textual = parts.map(part => part.kind === 'text' ? part.text : `${part.ref.ref} `).join('')
    const span = clampSpan(selection, detectLengthOf(before))
    if (bailInsertText(actx, { text: textual, span: { ...span, draftRev: before.draftRev } })) {
      return { inserted: 0, textFallback: refs.length, failed: false, caret: span.start + textual.length }
    }
    const clipboardStart = clipboardOfDetect(span.start, before.occurrences)
    const clipboardEnd = clipboardOfDetect(span.end, before.occurrences)
    input.setDraft(
      `${before.draft.slice(0, clipboardStart)}${textual}${before.draft.slice(clipboardEnd)}`,
      { start: clipboardStart, end: clipboardEnd, insertedLength: textual.length },
    )
    // Clipboard-plane caret: the flattening setDraft rewrote the whole
    // document as plain text (see insertVscodeReferences' twin branch).
    return { inserted: 0, textFallback: refs.length, failed: false, caret: clipboardStart + textual.length }
  }

  // Cursor walk: every step re-reads the machine (fresh revision) and
  // measures its own delta, so concurrent edits only ever cost a retry.
  let cursor = clampSpan(selection, detectLengthOf(before))
  let inserted = 0
  let textFallback = 0
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.text !== '') {
        // Advance the cursor only when the prose actually applied: a failed
        // write (persistent CAS loss) leaves the document unchanged, so the
        // following parts must land at the SAME point, not shift past text
        // that never arrived.
        let applied = false
        for (let attempt = 0; attempt < 2 && !applied; attempt++) {
          const snapshot = input.state.getSnapshot()
          // Clamp per attempt like the chip step below: a concurrent shrink
          // (a submit clearing the draft) must not strand the prose span
          // past the fresh end, where the hub would refuse the write.
          applied = bailInsertText(actx, {
            text: part.text,
            span: { ...clampSpan(cursor, detectLengthOf(snapshot)), draftRev: snapshot.draftRev },
          })
        }
        if (applied) cursor = { start: cursor.start + part.text.length, end: cursor.start + part.text.length }
      }
      continue
    }
    let landed = false
    for (let attempt = 0; attempt < 2 && !landed; attempt++) {
      const snapshot = input.state.getSnapshot()
      if (snapshot.phase !== 'plain' && snapshot.phase !== 'claimed') {
        await delay(150)
        continue
      }
      const span = clampSpan(cursor, detectLengthOf(snapshot))
      const beforeLen = detectLengthOf(snapshot)
      landed = input.insertReference(part.ref, { ...span, draftRev: snapshot.draftRev })
      if (landed) {
        // The chip (plus its machine-added trailing gap) replaced [span).
        const afterLen = detectLengthOf(input.state.getSnapshot())
        const caret = span.start + (afterLen - beforeLen) + (span.end - span.start)
        cursor = { start: caret, end: caret }
      } else {
        await delay(150)
      }
    }
    if (landed) {
      inserted++
      continue
    }
    // Refused (transient phase, CAS loss): splice the canonical mention
    // over the same range, with the machine's own trailing-gap rule — the
    // host boundary parses it identically, so only the chip affordance is
    // lost, never the context.
    const snapshot = input.state.getSnapshot()
    const span = clampSpan(cursor, detectLengthOf(snapshot))
    const clipboardStart = clipboardOfDetect(span.start, snapshot.occurrences)
    const clipboardEnd = clipboardOfDetect(span.end, snapshot.occurrences)
    const gap = trailingGapAt(snapshot, clipboardEnd)
    const text = `${part.ref.ref}${gap}`
    if (bailInsertText(actx, { text, span: { ...span, draftRev: snapshot.draftRev } })) {
      cursor = { start: span.start + text.length, end: span.start + text.length }
    } else {
      input.setDraft(
        `${snapshot.draft.slice(0, clipboardStart)}${text}${snapshot.draft.slice(clipboardEnd)}`,
        { start: clipboardStart, end: clipboardEnd, insertedLength: text.length },
      )
      cursor = { start: span.start + text.length, end: span.start + text.length }
    }
    textFallback++
  }
  return { inserted, textFallback, failed: false, caret: cursor.start }
}

/** The textarea-era paste algorithm, kept verbatim for old hosts. */
async function pasteLegacy(
  input: SessionInputFace,
  parts: readonly RecoveredPastePart[],
  refs: readonly { readonly kind: 'ref' }[],
  selection: { readonly start: number, readonly end: number },
): Promise<PasteLandingOutcome> {
  const before = input.state.getSnapshot()
  // Frozen phases (mid-submit) still accept plain draft writes: the paste
  // lands as canonical mention text for the next message instead of evaporating.
  if (before.phase !== 'plain' && before.phase !== 'claimed') {
    const textual = parts.map(part => part.kind === 'text' ? part.text : `${part.ref.ref} `).join('')
    input.setDraft(
      `${before.draft.slice(0, selection.start)}${textual}${before.draft.slice(selection.end)}`,
      { start: selection.start, end: selection.end, insertedLength: textual.length },
    )
    return { inserted: 0, textFallback: refs.length, failed: false, caret: selection.start + textual.length }
  }

  const display = parts.map(part => part.kind === 'text' ? part.text : chipDisplay(part.ref)).join('')
  input.setDraft(
    `${before.draft.slice(0, selection.start)}${display}${before.draft.slice(selection.end)}`,
    { start: selection.start, end: selection.end, insertedLength: display.length },
  )

  // Chip display spans inside the pasted region, collected ascending…
  const spans: { start: number, end: number, ref: ReferenceInsertLike }[] = []
  let offset = selection.start
  for (const part of parts) {
    if (part.kind === 'text') {
      offset += part.text.length
      continue
    }
    spans.push({ start: offset, end: offset + chipDisplay(part.ref).length, ref: part.ref })
    offset += chipDisplay(part.ref).length
  }
  // …upgraded descending: a chip's insertReference mutates only offsets at
  // or after its own span, so spans below it stay valid.
  let inserted = 0
  let textFallback = 0
  for (const span of [...spans].reverse()) {
    const snapshot = input.state.getSnapshot()
    if (input.insertReference(span.ref, { start: span.start, end: span.end, draftRev: snapshot.draftRev })) {
      inserted++
      continue
    }
    // Refused (transient phase, CAS loss): splice the canonical mention over
    // the plain display range, with the machine's own trailing-gap rule.
    const current = input.state.getSnapshot()
    const tail = current.draft.slice(span.end)
    const gap = tail.length === 0 || tail[0] !== ' ' ? ' ' : ''
    const replacement = `${span.ref.ref}${gap}`
    input.setDraft(
      `${current.draft.slice(0, span.start)}${replacement}${current.draft.slice(span.end)}`,
      { start: span.start, end: span.end, insertedLength: replacement.length },
    )
    textFallback++
  }

  const after = input.state.getSnapshot()
  const caret = selection.start + (after.draft.length - before.draft.length) + (selection.end - selection.start)
  return { inserted, textFallback, failed: false, caret }
}

// ---- the reference rail over the occurrence table ----

/** One rail tag: a distinct vscode-selection reference in the draft. */
export interface RailTag {
  /** Canonical mention — the identity shared by every chip of this reference. */
  readonly ref: string
  /** Display label (insert-time cache of the first occurrence). */
  readonly label: string
  /** Whether the captured snapshot was truncated. */
  readonly truncated: boolean
  /** Whether this tag cites a folder resource (file/folder icon pick). */
  readonly folder: boolean
  /** Whether every chip of this reference lost its owner (renders invalid). */
  readonly invalid: boolean
  /** How many chips in the draft cite this reference. */
  readonly count: number
  /** Draft ranges of every citing chip, ascending. */
  readonly ranges: readonly { readonly offset: number, readonly length: number }[]
}

/**
 * Project the rail view over the input machine's occurrence table: distinct
 * vscode-selection references in first-appearance order, each with the ranges
 * of every chip citing it.
 * @param occurrences - the live occurrence table.
 */
export function groupRailTags(occurrences: readonly OccurrenceLike[]): RailTag[] {
  const tags: RailTag[] = []
  const groups = new Map<string, { label: string, truncated: boolean, folder: boolean, invalid: boolean, count: number, ranges: { offset: number, length: number }[] }>()
  for (const occurrence of occurrences) {
    if (occurrence.source !== VSCODE_SOURCE) continue
    const existing = groups.get(occurrence.ref)
    if (existing === undefined) {
      let truncated = false
      let folder = false
      try {
        // The ref is the canonical mention; the payload rides inside it.
        const resMatch = /\(dsh-vscode-res:([A-Za-z0-9_-]+)\)/u.exec(occurrence.ref)
        if (resMatch !== null) {
          folder = decodeVscodeResourceUri(`dsh-vscode-res:${resMatch[1]}`).type === 'folder'
        } else {
          const match = /\(dsh-vscode:([A-Za-z0-9_-]+)\)/u.exec(occurrence.ref)
          if (match !== null) truncated = decodeVscodeRefUri(`dsh-vscode:${match[1]}`).truncated === true
        }
      } catch {
        // A hand-mangled ref still groups and removes; only the badges are lost.
      }
      const group = {
        label: occurrence.label,
        truncated,
        folder,
        invalid: occurrence.invalid === true,
        count: 1,
        ranges: [{ offset: occurrence.offset, length: occurrence.length }],
      }
      groups.set(occurrence.ref, group)
      tags.push({ ref: occurrence.ref, ...group, ranges: [...group.ranges] })
    } else {
      existing.count++
      existing.ranges.push({ offset: occurrence.offset, length: occurrence.length })
      existing.invalid = existing.invalid && occurrence.invalid === true
    }
  }
  // The pushed tag objects own shallow copies; refresh their aggregates.
  return tags.map(tag => ({ ...tag, ...groups.get(tag.ref)!, ranges: [...groups.get(tag.ref)!.ranges] }))
}

/**
 * Compute the next draft with every chip citing one reference removed:
 * ranges splice high-to-low, a doubled space at a seam collapses to one, and
 * a draft left whitespace-only clears to ''.
 * @param draft - the current draft text.
 * @param occurrences - the live occurrence table.
 * @param ref - the canonical mention to remove.
 * @returns the next draft to write through `inputActions.setDraft`.
 */
export function removeRefRanges(
  draft: string,
  occurrences: readonly OccurrenceLike[],
  ref: string,
): string {
  const ranges = occurrences
    .filter(occurrence => occurrence.source === VSCODE_SOURCE && occurrence.ref === ref)
    .map(occurrence => ({ start: occurrence.offset, end: occurrence.offset + occurrence.length }))
    .sort((a, b) => b.start - a.start)
  let next = draft
  for (const { start, end } of ranges) {
    let cutStart = start
    let cutEnd = end
    if (next[cutEnd] === ' ' && (cutStart === 0 || next[cutStart - 1] === ' ')) {
      if (cutStart === 0) cutEnd++
      else cutStart--
    }
    next = next.slice(0, cutStart) + next.slice(cutEnd)
  }
  return next.trim() === '' ? '' : next.replace(/[ \t]+$/u, '')
}

/**
 * Compute one chip's removal window in the draft's own coordinates: the
 * occurrence range, widened by the seam rule (a doubled space around the
 * chip collapses to one; at the draft head the following space is eaten).
 * @param draft - the clipboard-projection draft.
 * @param range - the occurrence's [start, end) window.
 * @returns the widened window to cut.
 */
function removalWindow(draft: string, range: { readonly start: number, readonly end: number }): { readonly start: number, readonly end: number } {
  let cutStart = range.start
  let cutEnd = range.end
  if (draft[cutEnd] === ' ' && (cutStart === 0 || draft[cutStart - 1] === ' ')) {
    if (cutStart === 0) cutEnd++
    else cutStart--
  }
  return { start: cutStart, end: cutEnd }
}

/** Upper bound on chips currently in the draft (the removal loop budget). */
function snapshotBudget(input: SessionInputFace): number {
  return input.state.getSnapshot().occurrences.length
}

/** Outcome of removing one reference's chips from a session's composer. */
export interface RefRemovalOutcome {
  /** Chips removed as atomic occurrences. */
  readonly removed: number
  /** True when the machine refused and the whole-draft fallback ran instead. */
  readonly degraded: boolean
}

/**
 * Remove every chip citing one reference from the addressed session's
 * draft — the reference rail's close affordance.
 *
 * Lexical hosts: one span-addressed `'slash/input-consume-token'`
 * transaction per chip (highest offset first, fresh snapshot before each),
 * so every OTHER chip in the draft survives with its rendering intact —
 * `setDraft` would flatten them all to raw mention text. The seam rule is
 * the same {@link removalWindow} the legacy splice used. A whitespace-only
 * remainder clears to the empty draft. A machine that refuses every
 * transaction degrades to the whole-draft `setDraft` write once.
 *
 * Textarea-era hosts: the historical whole-draft splice
 * ({@link removeRefRanges}) directly.
 *
 * @param sessions - the sessions service (scope resolution).
 * @param conversation - the conversation service (input resolver).
 * @param sessionId - the addressed session.
 * @param ref - the canonical mention to remove.
 * @returns how many chips left the draft, and whether the write degraded.
 */
export async function removeVscodeReferences(
  sessions: SessionsServiceFace | undefined,
  conversation: ConversationServiceFace | undefined,
  sessionId: string | undefined,
  ref: string,
): Promise<RefRemovalOutcome> {
  const actx = sessionId !== undefined ? sessions?.scope(sessionId) : undefined
  if (actx === undefined || conversation === undefined) {
    return { removed: 0, degraded: true }
  }
  let input: SessionInputFace
  try {
    input = conversation.input.for(actx)
  } catch {
    return { removed: 0, degraded: true }
  }

  let removed = 0
  if (isLexicalInput(input)) {
    let refusals = 0
    let degrade = false
    // Defensive cap: every applied transaction removes one chip, so the
    // table can only shrink — a misbehaving listener that answers true
    // without applying must not spin the loop forever.
    let budget = snapshotBudget(input) * 2 + 4
    for (;;) {
      if (budget-- <= 0) {
        degrade = true
        break
      }
      const snapshot = input.state.getSnapshot()
      const targets = snapshot.occurrences
        .filter(occurrence => occurrence.source === VSCODE_SOURCE && occurrence.ref === ref)
      if (targets.length === 0) break
      const last = targets[targets.length - 1]!
      const window = removalWindow(snapshot.draft, { start: last.offset, end: last.offset + last.length })
      const span = {
        start: detectOfClipboard(window.start, snapshot.occurrences),
        end: detectOfClipboard(window.end, snapshot.occurrences),
        draftRev: snapshot.draftRev,
      }
      if (bailConsumeToken(actx, { guard: { kind: 'span', span } })) {
        removed++
        refusals = 0
        continue
      }
      // Refused (a concurrent edit moved the revision): the next iteration
      // re-reads the fresh snapshot; two consecutive refusals degrade.
      refusals++
      if (refusals >= 2) {
        degrade = true
        break
      }
      await delay(150)
    }
    if (!degrade) {
      // A whitespace-only remainder clears, matching the legacy splice.
      const settled = input.state.getSnapshot()
      const length = detectLengthOf(settled)
      if (settled.draft.trim() === '' && length > 0) {
        bailConsumeToken(actx, { guard: { kind: 'span', span: { start: 0, end: length, draftRev: settled.draftRev } } })
      }
      return { removed, degraded: false }
    }
  } else {
    const snapshot = input.state.getSnapshot()
    const next = removeRefRanges(snapshot.draft, snapshot.occurrences, ref)
    if (next !== snapshot.draft) {
      input.setDraft(next)
      removed = snapshot.occurrences
        .filter(occurrence => occurrence.source === VSCODE_SOURCE && occurrence.ref === ref)
        .length
      return { removed, degraded: false }
    }
    return { removed: 0, degraded: false }
  }

  // Lexical machine refused every transaction: the whole-draft splice.
  const snapshot = input.state.getSnapshot()
  input.setDraft(removeRefRanges(snapshot.draft, snapshot.occurrences, ref))
  return {
    removed: snapshot.occurrences
      .filter(occurrence => occurrence.source === VSCODE_SOURCE && occurrence.ref === ref)
      .length,
    degraded: true,
  }
}
