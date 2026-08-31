/**
 * The Host-side vscode-selection context: recognizes canonical
 * `dsh-vscode:` (editor selections) and `dsh-vscode-res:` (explorer
 * file/folder references) mentions in outgoing user messages, replaces each
 * with its readable label (preserving the message id), and injects one
 * bounded `<text-selection>` context message — or, for resources, one
 * content-less `<file-selection>`/`<folder-selection>` path marker —
 * immediately after the
 * first message that cited it. The selection snapshot content rides inside
 * the mention, so injection never depends on filesystem state; the
 * filesystem is consulted only to mark freshness (`stale`) when the on-disk
 * range no longer matches the capture. Resources carry no content at all:
 * the model is told the path and kind and reads the file when needed.
 *
 * Only `source.kind === 'user'` text is scanned, matching the
 * dsh-session-reference boundary. Duplicate references within one step are
 * collapsed per kind — selections by (path, range), resources by
 * (path, kind) — with the newest capture (last mention) winning; distinct
 * content under the same range replaces — never joins — the older snapshot.
 *
 * @module dsh-sidebar-vscode/mention
 */

import { createHash } from 'node:crypto'
import { isAbsolute, relative as pathRelative, resolve, sep } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import {
  decodeVscodeRefUri,
  formatVscodeMention,
  hashPrefix,
  isVscodeResourcePayload,
  normalizeForHash,
  parseVscodeMentions,
  rangeLabel,
  referenceLabel,
  type VscodeMentionPayload,
  type VscodeRefPayload,
  type VscodeResourcePayload,
} from './mentionCodec.ts'

/** The model-facing context tag name for editor text selections. */
const TAG_NAME = 'text-selection'

/** The model-facing context tag name for explorer file references. */
const FILE_TAG_NAME = 'file-selection'

/** The model-facing context tag name for explorer folder references. */
const FOLDER_TAG_NAME = 'folder-selection'

/** One-line guidance riding above every injected tag (capture semantics). */
const GUIDANCE
  = '<!-- User-captured VS Code selection (capture-time snapshot); re-read the'
  + ' file before editing. -->'

/** Extra guidance riding above the tag when capture-time truncation removed content. */
const TRUNCATION_NOTICE
  = '<!-- Selection exceeded the size limit: the middle is omitted, marked by'
  + ' "... (N lines omitted, L1-L2) ..."; read the file for the full text. -->'

/** Freshness verdict for one unique reference against the live filesystem. */
export type FreshnessState = 'fresh' | 'stale' | 'unknown'

/**
 * Filesystem dependency of the expansion core: the exact text of lines
 * `[start, end]` (1-based inclusive, LF-joined) at `path` confined to `cwd`,
 * or null when the range cannot be verified. Injected so the boundary logic
 * is unit-testable without a real filesystem.
 */
export type RangeReader = (
  cwd: string,
  path: string,
  start: number,
  end: number,
  signal: AbortSignal,
) => Promise<string | null>

/** The durable source record carried by every injected context message. */
export interface VscodeMentionSource {
  kind: 'vscode-mention'
  /** Semantic context form: a one-off account of a capture that supersedes nothing. */
  form: 'notice'
  version: 1
  /** Path as captured (workspace-relative when under the session cwd). */
  path: string
  startLine: number
  endLine: number
  /** VS Code language id when known. */
  language?: string
  /** sha-256 hex prefix of the hash-normalized snapshot ('' when unknown). */
  contentHash: string
  /** UTF-8 byte length of the snapshot text. */
  bytes: number
  /** Whether capture-time truncation removed content. */
  truncated: boolean
  /** Whether the editor buffer was unsaved at capture. */
  dirty: boolean
  /**
   * Whether the on-disk range verifiably differs from the snapshot. A
   * truncated snapshot verifies by its kept head and tail halves, so
   * truncation alone never marks a reference stale.
   */
  stale: boolean
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'vscode-mention': VscodeMentionSource
    'vscode-resource': VscodeResourceSource
  }
}

/** The durable source record of one injected explorer-resource context message. */
export interface VscodeResourceSource {
  kind: 'vscode-resource'
  /** Semantic context form: a one-off account of a capture that supersedes nothing. */
  form: 'notice'
  version: 1
  /** Path as captured (workspace-relative when under the session cwd). */
  path: string
  /** Whether the referenced path is a folder. */
  type: 'file' | 'folder'
}

/** Escape one XML-like attribute value. */
function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** UTF-8 byte length of a string. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** sha-256 hex digest of a string (host side; the browser side uses crypto.subtle). */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The kept head and tail halves of a truncated snapshot (`tail` '' when none). */
function splitTruncated(payload: VscodeRefPayload): { head: string, tail: string } {
  const headLen = payload.headLen !== undefined && payload.headLen <= payload.text.length
    ? payload.headLen
    : payload.text.length
  // headLen === 0 means the head half is empty (truncateSnapshot filters it
  // out of the join), so the whole text IS the tail — slice(1) would eat the
  // tail's first character.
  if (headLen === 0) return { head: '', tail: payload.text }
  const tail = headLen < payload.text.length ? payload.text.slice(headLen + 1) : ''
  return { head: payload.text.slice(0, headLen), tail }
}

/** Render the inline omission marker naming what was dropped and where. */
function omissionMarker(payload: VscodeRefPayload): string {
  const parts: string[] = []
  if (payload.omitLines !== undefined && payload.omitLines > 0) {
    parts.push(`${payload.omitLines} line${payload.omitLines === 1 ? '' : 's'} omitted`)
    const { head } = splitTruncated(payload)
    const firstOmitted = payload.start + head.split('\n').length
    parts.push(rangeLabel(firstOmitted, firstOmitted + payload.omitLines - 1))
  }
  if (payload.omitBytes !== undefined && payload.omitBytes > 0) {
    parts.push(`${payload.omitBytes} byte${payload.omitBytes === 1 ? '' : 's'} omitted`)
  }
  return parts.length > 0 ? `... (${parts.join(', ')}) ...` : '... (truncated) ...'
}

/**
 * Render one injected context message body: the guidance comment plus the
 * `<text-selection>` tag. A truncated snapshot renders as head + omission
 * marker + tail so the model sees both ends of the selection and knows
 * exactly where the gap sits. When the snapshot itself contains the literal
 * closing tag, both tags carry a deterministic hash salt so the body cannot
 * forge the terminator (content changes ⇒ salt changes).
 * @param payload - the unique winning reference.
 * @param stale - filesystem freshness verdict.
 * @returns the complete model-facing text.
 */
export function renderSelectionTag(payload: VscodeRefPayload, stale: boolean): string {
  const attrs = [`path="${escapeAttribute(payload.path)}"`, `line="${rangeLabel(payload.start, payload.end)}"`]
  if (payload.lang !== undefined && payload.lang !== '') attrs.push(`lang="${escapeAttribute(payload.lang)}"`)
  if (payload.truncated === true) attrs.push('truncated="true"')
  if (payload.dirty === true) attrs.push('dirty="true"')
  if (stale) attrs.push('stale="true"')

  const guidance = payload.truncated === true ? `${GUIDANCE}\n${TRUNCATION_NOTICE}` : GUIDANCE
  const { head, tail } = splitTruncated(payload)
  const body = payload.truncated === true
    ? [head, omissionMarker(payload), tail].filter(part => part !== '').join('\n')
    : payload.text

  const open = `<${TAG_NAME}`
  const close = `</${TAG_NAME}>`
  if (body.includes(close)) {
    const salt = payload.hash.slice(0, 8)
    const saltedOpen = `<${TAG_NAME}-${salt}`
    const saltedClose = `</${TAG_NAME}-${salt}>`
    // The salt is a hash OF this very body, so a fixed point is computable
    // offline (content containing its own salted terminator, brute-forced
    // until the sha-256 prefix matches): re-check BOTH salted tags against
    // the body and only salt when neither appears.
    if (/^[0-9a-f]{8}$/.test(salt) && !body.includes(saltedClose) && !body.includes(saltedOpen)) {
      return `${guidance}\n${saltedOpen} ${attrs.join(' ')}>\n${body}\n${saltedClose}`
    }
    // No hash available to salt with — or the body forges the salted tags
    // too: escape the body instead of risking a forged terminator.
    const escaped = body.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    return `${guidance}\n${open} ${attrs.join(' ')}>\n${escaped}\n${close}`
  }
  return `${guidance}\n${open} ${attrs.join(' ')}>\n${body}\n${close}`
}

/**
 * Render one injected explorer-resource context body: a single self-closing
 * `<file-selection path="…"/>` or `<folder-selection path="…"/>` marker and
 * nothing else. By design there is no guidance comment and no content — the
 * reference only names a path, with the tag itself carrying the file/folder
 * kind; the model reads the file (or lists the folder) when it actually
 * needs the bytes.
 * @param payload - the unique winning resource reference.
 * @returns the complete model-facing text.
 */
export function renderResourceTag(payload: VscodeResourcePayload): string {
  const tag = payload.type === 'folder' ? FOLDER_TAG_NAME : FILE_TAG_NAME
  return `<${tag} path="${escapeAttribute(payload.path)}"/>`
}

/** Group key for within-step deduplication: kind-aware — same shape of reference ⇒ one context. */
function groupKey(payload: VscodeMentionPayload): string {
  return isVscodeResourcePayload(payload)
    ? `res\u0000${payload.path}\u0000${payload.type}`
    : `${payload.path}\u0000${payload.start}\u0000${payload.end}`
}

/** Verify one unique reference against the live filesystem range. */
async function freshnessOf(
  cwd: string | undefined,
  readFileRange: RangeReader,
  payload: VscodeRefPayload,
  signal: AbortSignal,
): Promise<FreshnessState> {
  if (cwd === undefined || !isAbsolute(cwd)) return 'unknown'
  const text = await readFileRange(cwd, payload.path, payload.start, payload.end, signal)
  if (text === null) return 'unknown'
  const disk = normalizeForHash(text)
  if (payload.truncated === true) {
    // A truncated snapshot keeps the head and tail of the range with the
    // middle omitted — it is neither the whole range nor a prefix of it, so
    // the hash comparison cannot apply. Verify the kept halves directly: the
    // disk range must start with the head, end with the tail, and still hold
    // at least one char between them. Edits inside the omitted middle are
    // not detectable (that region is not quoted).
    const { head, tail } = splitTruncated(payload)
    const headOk = disk === head || disk.startsWith(head)
    const tailOk = tail === '' || disk === tail || disk.endsWith(tail)
    return headOk && tailOk && disk.length >= head.length + tail.length + 1 ? 'fresh' : 'stale'
  }
  if (payload.hash === '') return 'unknown'
  return hashPrefix(sha256Hex(disk)) === payload.hash ? 'fresh' : 'stale'
}

/**
 * Build one unique selection reference's context message: freshness-check
 * against the live filesystem, then render the bounded `<text-selection>`
 * tag with its durable source record.
 */
async function selectionContext(
  payload: VscodeRefPayload,
  cwd: string | undefined,
  readFileRange: RangeReader,
  signal: AbortSignal,
): Promise<UserMessage> {
  const stale = (await freshnessOf(cwd, readFileRange, payload, signal)) === 'stale'
  return createUserMessage({
    content: [{ type: 'text', text: renderSelectionTag(payload, stale) }],
    source: {
      kind: 'vscode-mention',
      form: 'notice',
      version: 1,
      path: payload.path,
      startLine: payload.start,
      endLine: payload.end,
      ...(payload.lang !== undefined && payload.lang !== '' ? { language: payload.lang } : {}),
      contentHash: payload.hash,
      bytes: byteLength(payload.text),
      truncated: payload.truncated === true,
      dirty: payload.dirty === true,
      stale,
    } satisfies VscodeMentionSource,
  })
}

/** One unique reference (either kind) with the message index of its first citation. */
interface UniqueRef {
  readonly payload: VscodeMentionPayload
  readonly firstIndex: number
}

/**
 * Rewrite canonical mentions (either kind) in direct user messages and place
 * each unique reference's context immediately after the first message that
 * cited it.
 * @param messages - messages accepted by downstream pre-step listeners.
 * @param cwd - the session's workspace directory.
 * @param readFileRange - injected range reader for freshness checks
 * (selections only; resources verify nothing).
 * @param signal - active turn cancellation.
 * @returns the expanded message list (the input instance when nothing matched).
 */
export async function expandVscodeMentions(
  messages: readonly UserMessage[],
  cwd: string | undefined,
  readFileRange: RangeReader,
  signal: AbortSignal,
): Promise<UserMessage[]> {
  // Pass 1: rewrite citing messages, collecting payloads per message index.
  const rewritten = new Map<number, UserMessage>()
  const cited: { payload: VscodeMentionPayload; index: number }[] = []
  for (const [index, message] of messages.entries()) {
    if (message.source.kind !== 'user') continue
    let parsedAny = false
    const references: VscodeMentionPayload[] = []
    const content: ContentBlock[] = message.content.map((block): ContentBlock => {
      if (block.type !== 'text') return block
      const parsed = parseVscodeMentions(block.text)
      if (parsed.references.length === 0) return block
      parsedAny = true
      references.push(...parsed.references)
      return { type: 'text', text: parsed.text }
    })
    if (!parsedAny) continue
    rewritten.set(index, freezeMessage({ ...message, content }))
    for (const payload of references) cited.push({ payload, index })
  }
  if (cited.length === 0) return messages as UserMessage[]

  // Pass 2: collapse to one context per reference identity; the LAST capture
  // wins, first-citation order and placement are preserved.
  const uniques = new Map<string, UniqueRef>()
  for (const { payload, index } of cited) {
    const key = groupKey(payload)
    const existing = uniques.get(key)
    if (existing === undefined) {
      uniques.set(key, { payload, firstIndex: index })
    } else {
      uniques.set(key, { payload, firstIndex: existing.firstIndex })
    }
  }

  // Pass 3: build each unique reference's context — freshness-checked
  // selections, content-less resource markers.
  const injections = new Map<number, UserMessage[]>()
  for (const { payload, firstIndex } of uniques.values()) {
    signal.throwIfAborted()
    const context = isVscodeResourcePayload(payload)
      ? createUserMessage({
        content: [{ type: 'text', text: renderResourceTag(payload) }],
        source: {
          kind: 'vscode-resource',
          form: 'notice',
          version: 1,
          path: payload.path,
          type: payload.type,
        } satisfies VscodeResourceSource,
      })
      : await selectionContext(payload, cwd, readFileRange, signal)
    const bucket = injections.get(firstIndex)
    if (bucket === undefined) injections.set(firstIndex, [context])
    else bucket.push(context)
  }

  // Pass 4: assemble — each message followed by the contexts it first cited.
  return messages.flatMap((message, index) => {
    const direct = rewritten.get(index) ?? (message as UserMessage)
    const extra = injections.get(index)
    return extra === undefined ? [direct] : [direct, ...extra]
  })
}

/**
 * The `agent/pre-step` listener body: expand mentions in the accepted step
 * messages. Extracted so the boundary logic is unit-testable without an
 * assembled agent scope.
 * @param cwd - the session's workspace directory.
 * @param readFileRange - injected range reader for freshness checks.
 * @param messages - the claimed messages (the user's own words).
 * @param signal - caller lifetime.
 * @param next - the downstream waterfall.
 * @returns the decision with rewrites and injections, or the downstream decision.
 */
export async function vscodeMentionPreStep(
  cwd: string | undefined,
  readFileRange: RangeReader,
  messages: readonly UserMessage[],
  signal: AbortSignal,
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision> {
  const decision = await next()
  if (decision.kind === 'reject') return decision
  const expanded = await expandVscodeMentions(decision.messages, cwd, readFileRange, signal)
  if (expanded === (decision.messages as UserMessage[])) return decision
  return { kind: 'enter', messages: expanded }
}

/** Default freshness file-size cap: ranges inside larger files stay 'unknown'. */
const FRESHNESS_MAX_FILE_BYTES = 8 * 1024 * 1024

/**
 * Production {@link RangeReader}: resolves the path under the session cwd —
 * confining every resolution (absolute or relative: an absolute path is a
 * legitimate wire form, honored exactly when it lands inside the workspace)
 * and rejecting `..` escapes, so the freshness check can never read outside
 * the workspace — then bounds the read size and returns the exact
 * LF-joined range.
 * @returns the range text, or null when it cannot be verified.
 */
export function createFileRangeReader(maxFileBytes = FRESHNESS_MAX_FILE_BYTES): RangeReader {
  return async (cwd, path, start, end, signal): Promise<string | null> => {
    if (!isAbsolute(cwd)) return null
    const absolute = resolve(isAbsolute(path) ? path : resolve(cwd, path))
    const confined = pathRelative(cwd, absolute)
    if (confined === '..' || confined.startsWith(`..${sep}`) || isAbsolute(confined)) return null
    signal.throwIfAborted()
    try {
      const info = await stat(absolute)
      if (!info.isFile() || info.size > maxFileBytes) return null
      signal.throwIfAborted()
      const content = await readFile(absolute, 'utf8')
      const lines = content.replace(/\r\n?/g, '\n').split('\n')
      if (end > lines.length) return null
      return lines.slice(start - 1, end).join('\n')
    } catch {
      return null
    }
  }
}
