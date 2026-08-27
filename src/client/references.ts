/**
 * Client-side vscode-selection references: building composer chips from a
 * decoded clipboard payload, inserting them through the conversation input
 * machine, recovering pasted mention copies back into chips, and computing
 * the reference-rail view over the live occurrence table.
 *
 * Everything here is structurally typed against the ui-conversation /
 * ui-input-trigger contracts (the browser bundle's purity gate forbids
 * `@deepseek-ai/*` value imports, and the shapes are frozen public seams).
 * Insertion goes through the session's `SessionInput.insertReference` with a
 * revision-CAS'd span at the caller's addressed point — the composer's caret
 * (a selected range replaces it), the point just past the previous reference
 * for a batch, or the end-of-draft zero-width span when no point is
 * addressable — the same machine transaction the trigger-menu pipeline uses,
 * so every chip is an atomic occurrence:
 * backspace deletes it whole, submit serializes it through this plugin's
 * trigger-source codec, and the draft text (not any side table) is the single
 * store of what will be injected at `agent/pre-step`.
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
   * Draft write; the machine's own face also accepts the DOM-observed edit
   * shape (narrowing the occurrence reconciliation), passed through as the
   * optional second argument when the caller knows the paste's range.
   */
  setDraft(text: string, editRange?: { readonly start: number, readonly end: number, readonly insertedLength: number }): void
  readonly state: { getSnapshot(): InputStateLike }
}

/** Sessions service face: session-scope context resolution. */
export interface SessionsServiceFace {
  scope(id: string): unknown | undefined
}

/** Conversation service face: the per-session input resolver. */
export interface ConversationServiceFace {
  readonly input: { for(actx: unknown): SessionInputFace }
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
   * Draft offset just past the last landed reference (the restored caret);
   * undefined when nothing landed or no session composer resolved at all.
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

/**
 * Insert references as atomic chips on the addressed session's composer,
 * at the caller's addressed point: the first reference replaces the `at`
 * range (a bare caret is the zero-width case), every following one splices
 * at the point just past its predecessor, and a missing `at` keeps the
 * historical end-of-draft append. Whenever the input machine refuses the
 * chip transaction (mid-submit phases, CAS loss after retry) the canonical
 * mention lands as plain text over the same point — paste geometry when one
 * was addressed, the separator-aware tail append otherwise. The host
 * boundary parses plain-text mentions identically, so the text path
 * degrades only the chip affordance — never the context.
 *
 * @param sessions - the sessions service (scope resolution).
 * @param conversation - the conversation service (input resolver).
 * @param sessionId - the addressed session.
 * @param refs - references to land, in order.
 * @param at - the draft range the references replace (usually the composer
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
        ? { start: snapshot.draft.length, end: snapshot.draft.length }
        : clampSpan(next, snapshot.draft.length)
      const beforeLen = snapshot.draft.length
      landed = input.insertReference(ref, { ...span, draftRev: snapshot.draftRev })
      if (landed) {
        // The chip (plus its machine-added trailing gap) replaced [span):
        // the next point is exactly past the inserted region, measured off
        // the draft delta so the machine's gap rule never has to be copied.
        const afterLen = input.state.getSnapshot().draft.length
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
    // With an addressed point this is paste geometry (the mention plus the
    // machine's trailing-gap rule, no leading separator); without one it is
    // the historical separator-aware tail append.
    const snapshot = input.state.getSnapshot()
    if (next === undefined) {
      const draft = appendMention(snapshot.draft, ref.ref)
      input.setDraft(draft)
      caret = draft.length
    } else {
      const point = clampSpan(next, snapshot.draft.length).start
      const tail = snapshot.draft.slice(point)
      const gap = tail.length === 0 || tail[0] !== ' ' ? ' ' : ''
      const replacement = `${ref.ref}${gap}`
      input.setDraft(
        `${snapshot.draft.slice(0, point)}${replacement}${snapshot.draft.slice(point)}`,
        { start: point, end: point, insertedLength: replacement.length },
      )
      caret = point + replacement.length
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
   * Draft offset just past the landed paste region (the restored caret);
   * undefined when no session composer resolved at all.
   */
  readonly caret?: number
}

/** Chip display text — the exact range an occurrence occupies in the draft. */
function chipDisplay(ref: ReferenceInsertLike): string {
  return `@${ref.label}`
}

/**
 * Land one parsed paste on the addressed session's composer at the paste
 * selection: the prose inserts verbatim and every mention becomes an atomic
 * chip, in ONE draft write followed by per-chip upgrades from the LAST chip
 * backwards (earlier spans keep their offsets while later ones mutate the
 * draft). A chip upgrade the machine refuses (transient phases, CAS loss)
 * degrades that one mention to its canonical plain-text mention over the
 * same range — the host boundary parses it identically, so only the chip
 * affordance is lost, never the context.
 *
 * @param sessions - the sessions service (scope resolution).
 * @param conversation - the conversation service (input resolver).
 * @param sessionId - the addressed session.
 * @param parts - the parsed paste (see {@link parseRecoveredPaste}).
 * @param selection - the draft range the paste replaces (usually the caret).
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
