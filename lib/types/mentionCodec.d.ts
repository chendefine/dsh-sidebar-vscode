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
export declare const VSCODE_MENTION_SCHEME = "dsh-vscode:";
/** URI scheme reserved for VS Code explorer file/folder references. */
export declare const VSCODE_RESOURCE_SCHEME = "dsh-vscode-res:";
/** One captured editor selection riding inside a mention URI. */
export interface VscodeRefPayload {
    /** Codec version; only 1 exists. */
    readonly v: 1;
    /** DSH-side path: workspace-relative when under the session cwd, else absolute. */
    readonly path: string;
    /** First selected line, 1-based inclusive. */
    readonly start: number;
    /** Last selected line, 1-based inclusive. */
    readonly end: number;
    /** VS Code language id, omitted when unknown. */
    readonly lang?: string;
    /** Captured snapshot text (line endings normalized; when truncated, the kept head and tail halves joined by a newline — the omission marker is rendered by the host, not stored here). */
    readonly text: string;
    /** sha-256 hex prefix (16 chars) of the hash-normalized text; '' when unknown. */
    readonly hash: string;
    /** Present only when the snapshot was truncated at capture (middle omitted). */
    readonly truncated?: boolean;
    /** When truncated: char length of the kept head half inside `text` (the tail starts after the following newline). */
    readonly headLen?: number;
    /** When truncated: whole lines omitted from the middle (0 when only bytes were cut). */
    readonly omitLines?: number;
    /** When truncated: UTF-8 bytes omitted at char level beyond the omitted lines (extends the same gap at both seams). */
    readonly omitBytes?: number;
    /** Present only when the editor buffer was unsaved at capture. */
    readonly dirty?: boolean;
}
/** One explorer file/folder reference riding inside a resource mention URI. */
export interface VscodeResourcePayload {
    /** Codec version; only 1 exists. */
    readonly v: 1;
    /** DSH-side path: workspace-relative when under the session cwd, else absolute. */
    readonly path: string;
    /** Whether the referenced path is a folder (anything else is a file). */
    readonly type: 'file' | 'folder';
}
/** Either payload kind that can ride inside a vscode mention URI. */
export type VscodeMentionPayload = VscodeRefPayload | VscodeResourcePayload;
/** Error thrown when an explicit `dsh-vscode:` mention or bare URI is malformed. */
export declare class VscodeMentionError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** UTF-8 string → base64url without padding. */
export declare function encodeBase64Url(text: string): string;
/** base64url → UTF-8 string; throws on malformed input. */
export declare function decodeBase64Url(value: string): string;
/** Whether the value structurally matches {@link VscodeRefPayload} (v1). */
export declare function isVscodeRefPayload(value: unknown): value is VscodeRefPayload;
/** Serialize one payload to its canonical URI (fixed key order; falsy flags omitted). */
export declare function encodeVscodeRefUri(payload: VscodeRefPayload): string;
/**
 * Decode and canonicalize one `dsh-vscode:` URI.
 * @param uri - complete URI string.
 * @returns the validated payload.
 * @throws VscodeMentionError when the URI is not a canonical v1 reference.
 */
export declare function decodeVscodeRefUri(uri: string): VscodeRefPayload;
/** Whether the value structurally matches {@link VscodeResourcePayload} (v1). */
export declare function isVscodeResourcePayload(value: unknown): value is VscodeResourcePayload;
/** Serialize one resource payload to its canonical URI (fixed key order). */
export declare function encodeVscodeResourceUri(payload: VscodeResourcePayload): string;
/**
 * Decode and canonicalize one `dsh-vscode-res:` URI.
 * @param uri - complete URI string.
 * @returns the validated payload.
 * @throws VscodeMentionError when the URI is not a canonical v1 resource.
 */
export declare function decodeVscodeResourceUri(uri: string): VscodeResourcePayload;
/** Line-range label: `L10` for single lines, `L10-L25` otherwise. */
export declare function rangeLabel(start: number, end: number): string;
/** Chip label / readable mention replacement: `path L10-L12`. */
export declare function referenceLabel(payload: Pick<VscodeRefPayload, 'path' | 'start' | 'end'>): string;
/** Chip label / readable resource mention replacement: the bare path. */
export declare function resourceLabel(payload: Pick<VscodeResourcePayload, 'path'>): string;
/** Render the canonical Markdown mention for one payload. */
export declare function formatVscodeMention(payload: VscodeRefPayload): string;
/** Render the canonical Markdown mention for one resource payload. */
export declare function formatVscodeResourceMention(payload: VscodeResourcePayload): string;
/** Result of extracting vscode-selection mentions from one text value. */
export interface ParsedVscodeMentions {
    /** Text with every canonical mention replaced by its `@`-prefixed readable label. */
    text: string;
    /** Decoded payloads (either kind) in first-appearance order (duplicates preserved). */
    references: VscodeMentionPayload[];
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
export declare function parseVscodeMentions(text: string): ParsedVscodeMentions;
/** One mention recovered from arbitrary text: payload, projections, and range. */
export interface RecoveredVscodeMention {
    /** Decoded, canonically validated payload (either kind). */
    readonly payload: VscodeMentionPayload;
    /** Canonical mention rebuilt from the payload — the chip identity. */
    readonly mention: string;
    /** Readable label rebuilt from the payload (the copied label is untrusted). */
    readonly label: string;
    /** Half-open [start, end) range of the matched text. */
    readonly start: number;
    /** Companion of {@link start}. */
    readonly end: number;
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
export declare function scanRecoveredMentions(text: string): RecoveredVscodeMention[];
/** Hash-normalize snapshot text: LF line endings, no trailing newline. */
export declare function normalizeForHash(text: string): string;
/** Bounds applied to a captured snapshot before it enters a payload. */
export interface SnapshotLimits {
    /** Maximum rendered code lines kept. */
    readonly maxLines: number;
    /** Maximum UTF-8 bytes kept (may cut mid-line). */
    readonly maxBytes: number;
}
/** Result of capture-time truncation. */
export interface TruncatedSnapshot {
    /** The kept text, LF-normalized: head and tail halves joined by one newline when the middle was omitted. */
    readonly text: string;
    /** Whether either limit removed content. */
    readonly truncated: boolean;
    /** Char length of the head half inside `text` (undefined when nothing was omitted). */
    readonly headLen?: number;
    /** Whole lines omitted from the middle (0 when only bytes were cut; undefined when nothing was omitted). */
    readonly omitLines?: number;
    /** UTF-8 bytes omitted at char level beyond the omitted lines (undefined when nothing was omitted). */
    readonly omitBytes?: number;
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
export declare function truncateSnapshot(text: string, limits: SnapshotLimits): TruncatedSnapshot;
/** Prefix length of the sha-256 hex digest carried in payloads and tags. */
export declare const HASH_HEX_LENGTH = 16;
/** First {@link HASH_HEX_LENGTH} hex chars of a sha-256 digest hex string. */
export declare function hashPrefix(hexDigest: string): string;
