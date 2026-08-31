/**
 * Pure logic for the clipboard envelope shared with the VS Code extension:
 * the wire codec and payload validation. No DOM, no React — unit-testable in
 * isolation.
 *
 * Wire format (the string the extension hands to
 * `vscode.env.clipboard.writeText`):
 *
 * ```
 * @@DSH_REF::<base64url(payload json)>::
 * <human-readable fallback snippet>
 * ```
 *
 * The payload is kind-discriminated: editor selections decode to a
 * {@link SelectionPayload} (no `kind` field — the historical shape), while
 * explorer file/folder selections decode to a {@link ResourceListPayload}
 * (`kind: 'resource'`, path + kind per item, never any content).
 *
 * The base64url alphabet contains no ':', so the closing '::' is an
 * unambiguous terminator. When the workbench runs inside this plugin's
 * iframe, the clipboard bridge intercepts the write before it reaches the
 * real clipboard, decodes the payload, and lands composer reference chips
 * (see references.ts); on a successful landing nothing touches the real
 * clipboard — the human-readable part is written only as a fallback when
 * the landing fails. Standalone (no bridge), the envelope lands on the
 * clipboard and the composer-side paste fallback recognizes the marker
 * instead.
 *
 * @module dsh-sidebar-vscode/client/selection
 */

/** Envelope marker prefix (must match the VS Code extension's constant). */
export const SELECTION_MARKER = '@@DSH_REF::'

/** One selection span: 1-based inclusive line range plus the exact text. */
export interface SelectionSpan {
  readonly startLine: number
  readonly endLine: number
  readonly text: string
}

/** The decoded payload the VS Code extension sends for editor selections. */
export interface SelectionPayload {
  /** Absolute path of the file inside the embedded VS Code server. */
  readonly path: string
  /** Path relative to the opened workspace folder (posix separators), when any. */
  readonly relative?: string
  /** VS Code language id of the document (fence hint). */
  readonly language?: string
  /** Whether the editor buffer was unsaved when the selection was sent. */
  readonly dirty?: boolean
  /** The selected spans, in editor order. */
  readonly spans: readonly SelectionSpan[]
}

/** One explorer-selected resource: a path plus its kind. No content rides along. */
export interface ResourceItem {
  /** Absolute path inside the embedded VS Code server. */
  readonly path: string
  /** Path relative to the opened workspace folder (posix separators), when any. */
  readonly relative?: string
  /** Whether the selection is a folder (files are anything not a directory). */
  readonly type: 'file' | 'folder'
}

/** The decoded payload the VS Code extension sends for explorer selections. */
export interface ResourceListPayload {
  readonly kind: 'resource'
  /** The selected resources, in explorer order. */
  readonly resources: readonly ResourceItem[]
}

/** Anything the envelope can carry: an editor selection or an explorer resource list. */
export type ClipboardPayload = SelectionPayload | ResourceListPayload

/** Whether one decoded payload is an explorer resource list (else an editor selection). */
export function isResourceList(payload: ClipboardPayload): payload is ResourceListPayload {
  return 'kind' in payload && payload.kind === 'resource'
}

/** Whether the value is a well-formed SelectionPayload. */
function isSelectionPayload(value: unknown): value is SelectionPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<SelectionPayload>
  if (typeof candidate.path !== 'string' || candidate.path === '') return false
  if (candidate.relative !== undefined && typeof candidate.relative !== 'string') return false
  if (candidate.language !== undefined && typeof candidate.language !== 'string') return false
  if (candidate.dirty !== undefined && typeof candidate.dirty !== 'boolean') return false
  if (!Array.isArray(candidate.spans) || candidate.spans.length === 0) return false
  return candidate.spans.every((span) => {
    if (typeof span !== 'object' || span === null) return false
    const s = span as Partial<SelectionSpan>
    return typeof s.startLine === 'number'
      && typeof s.endLine === 'number'
      && typeof s.text === 'string'
      && Number.isFinite(s.startLine)
      && Number.isFinite(s.endLine)
      // Integer lattice only: the canonical mention codec rejects fractional
      // lines, and a chip built from one would throw at agent/pre-step
      // instead of degrading.
      && Number.isInteger(s.startLine)
      && Number.isInteger(s.endLine)
      && s.startLine >= 1
      && s.endLine >= s.startLine
  })
}

/** Whether the value is a well-formed ResourceListPayload. */
function isResourceListPayload(value: unknown): value is ResourceListPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ResourceListPayload>
  if (candidate.kind !== 'resource') return false
  if (!Array.isArray(candidate.resources) || candidate.resources.length === 0) return false
  return candidate.resources.every((item) => {
    if (typeof item !== 'object' || item === null) return false
    const r = item as Partial<ResourceItem>
    return typeof r.path === 'string' && r.path !== ''
      && (r.relative === undefined || typeof r.relative === 'string')
      && (r.type === 'file' || r.type === 'folder')
  })
}

/** Whether the value is any well-formed envelope payload. */
function isClipboardPayload(value: unknown): value is ClipboardPayload {
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    return isResourceListPayload(value)
  }
  return isSelectionPayload(value)
}

/** base64url → UTF-8 string (browser-safe, no Buffer). */
function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** UTF-8 string → base64url (used by tests to build envelopes). */
export function encodeEnvelopePayload(payload: ClipboardPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Parse one clipboard string into a {@link ClipboardPayload}.
 * Returns null for anything that is not our envelope.
 */
export function parseClipboardEnvelope(text: string): ClipboardPayload | null {
  if (!text.startsWith(SELECTION_MARKER)) return null
  const close = text.indexOf('::', SELECTION_MARKER.length)
  if (close < 0) return null
  const encoded = text.slice(SELECTION_MARKER.length, close)
  if (encoded === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeBase64Url(encoded))
  } catch {
    return null
  }
  return isClipboardPayload(parsed) ? parsed : null
}

/**
 * The human-readable part of an envelope: everything after the marker line.
 * Falls back to the full string when it is not an envelope.
 */
export function envelopeReadablePart(text: string): string {
  if (!text.startsWith(SELECTION_MARKER)) return text
  const close = text.indexOf('::', SELECTION_MARKER.length)
  if (close < 0) return text
  return text.slice(close + 2).replace(/^\r?\n/, '')
}
