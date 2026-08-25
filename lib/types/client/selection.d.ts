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
export declare const SELECTION_MARKER = "@@DSH_REF::";
/** One selection span: 1-based inclusive line range plus the exact text. */
export interface SelectionSpan {
    readonly startLine: number;
    readonly endLine: number;
    readonly text: string;
}
/** The decoded payload the VS Code extension sends for editor selections. */
export interface SelectionPayload {
    /** Absolute path of the file inside the embedded VS Code server. */
    readonly path: string;
    /** Path relative to the opened workspace folder (posix separators), when any. */
    readonly relative?: string;
    /** VS Code language id of the document (fence hint). */
    readonly language?: string;
    /** Whether the editor buffer was unsaved when the selection was sent. */
    readonly dirty?: boolean;
    /** The selected spans, in editor order. */
    readonly spans: readonly SelectionSpan[];
}
/** One explorer-selected resource: a path plus its kind. No content rides along. */
export interface ResourceItem {
    /** Absolute path inside the embedded VS Code server. */
    readonly path: string;
    /** Path relative to the opened workspace folder (posix separators), when any. */
    readonly relative?: string;
    /** Whether the selection is a folder (files are anything not a directory). */
    readonly type: 'file' | 'folder';
}
/** The decoded payload the VS Code extension sends for explorer selections. */
export interface ResourceListPayload {
    readonly kind: 'resource';
    /** The selected resources, in explorer order. */
    readonly resources: readonly ResourceItem[];
}
/** Anything the envelope can carry: an editor selection or an explorer resource list. */
export type ClipboardPayload = SelectionPayload | ResourceListPayload;
/** Whether one decoded payload is an explorer resource list (else an editor selection). */
export declare function isResourceList(payload: ClipboardPayload): payload is ResourceListPayload;
/** UTF-8 string → base64url (used by tests to build envelopes). */
export declare function encodeEnvelopePayload(payload: ClipboardPayload): string;
/**
 * Parse one clipboard string into a {@link ClipboardPayload}.
 * Returns null for anything that is not our envelope.
 */
export declare function parseClipboardEnvelope(text: string): ClipboardPayload | null;
/**
 * The human-readable part of an envelope: everything after the marker line.
 * Falls back to the full string when it is not an envelope.
 */
export declare function envelopeReadablePart(text: string): string;
