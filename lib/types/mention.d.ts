/**
 * The Host-side vscode-selection context: recognizes canonical
 * `dsh-vscode:` (editor selections) and `dsh-vscode-res:` (explorer
 * file/folder references) mentions in outgoing user messages, replaces each
 * with its readable label (preserving the message id), stamps the citations'
 * readable labels into the citing message's durable source
 * (`vscodeReferences` — what the browser half's user-row seat renders as the
 * reference tag), and injects one
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
import type { MessageSourceMap, UserMessage } from '@deepseek-ai/dsh-llm';
import type { PreStepDecision } from '@deepseek-ai/dsh-agent';
import { type VscodeMentionPayload, type VscodeRefPayload, type VscodeResourcePayload } from './mentionCodec.ts';
/** Freshness verdict for one unique reference against the live filesystem. */
export type FreshnessState = 'fresh' | 'stale' | 'unknown';
/**
 * Filesystem dependency of the expansion core: the exact text of lines
 * `[start, end]` (1-based inclusive, LF-joined) at `path` confined to `cwd`,
 * or null when the range cannot be verified. Injected so the boundary logic
 * is unit-testable without a real filesystem.
 */
export type RangeReader = (cwd: string, path: string, start: number, end: number, signal: AbortSignal) => Promise<string | null>;
/** The durable source record carried by every injected context message. */
export interface VscodeMentionSource {
    kind: 'vscode-mention';
    /** Semantic context form: a one-off account of a capture that supersedes nothing. */
    form: 'notice';
    version: 1;
    /** Path as captured (workspace-relative when under the session cwd). */
    path: string;
    startLine: number;
    endLine: number;
    /** VS Code language id when known. */
    language?: string;
    /** sha-256 hex prefix of the hash-normalized snapshot ('' when unknown). */
    contentHash: string;
    /** UTF-8 byte length of the snapshot text. */
    bytes: number;
    /** Whether capture-time truncation removed content. */
    truncated: boolean;
    /** Whether the editor buffer was unsaved at capture. */
    dirty: boolean;
    /**
     * Whether the on-disk range verifiably differs from the snapshot. A
     * truncated snapshot verifies by its kept head and tail halves, so
     * truncation alone never marks a reference stale.
     */
    stale: boolean;
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'vscode-mention': VscodeMentionSource;
        'vscode-resource': VscodeResourceSource;
        'user-vscode': VscodeUserSource;
    }
}
/**
 * The citing user message's durable source once this boundary stamped it: a
 * `kind: 'user'` message (every consumer's `source.kind === 'user'` check
 * keeps matching) that additionally carries the readable labels of the vscode
 * references it cited, in citation order. Chat's ordinary context rows are
 * hidden by the stock transcript visibility policy (dsh ≥0.1.7), so this
 * record is the durable material the browser half's
 * `conversation.chat.user.before` seat elects to render the reference tag
 * above the user bubble — the same discipline session-controller's
 * `'user-rpc'` source uses for its own extras.
 */
export interface VscodeUserSource {
    kind: 'user';
    /** Readable citation labels (`path L10-L12` / `path`), deduplicated, first-seen order. */
    readonly vscodeReferences: readonly string[];
}
/**
 * Build the readable label list of one message's citations: selections as
 * `path L10-L12`, resources as the bare `path` — exactly the labels the
 * inline rewrite leaves in the message text, deduplicated preserving
 * first-seen order.
 * @param payloads - every reference parsed from the citing message.
 * @returns the deduplicated label list (empty when nothing cited).
 */
export declare function vscodeReferenceLabels(payloads: readonly VscodeMentionPayload[]): string[];
/**
 * Stamp the citation labels onto one user message's durable source. The
 * spread keeps every existing member (e.g. session-controller's rpc
 * correlation fields), so nothing already riding the source is lost.
 * @param source - the citing message's user-shaped source.
 * @param labels - the non-empty deduplicated label list.
 * @returns the stamped source, typed as the `'user-vscode'` map member.
 */
export declare function withVscodeReferences(source: MessageSourceMap['user'] | VscodeUserSource, labels: readonly string[]): VscodeUserSource;
/** The durable source record of one injected explorer-resource context message. */
export interface VscodeResourceSource {
    kind: 'vscode-resource';
    /** Semantic context form: a one-off account of a capture that supersedes nothing. */
    form: 'notice';
    version: 1;
    /** Path as captured (workspace-relative when under the session cwd). */
    path: string;
    /** Whether the referenced path is a folder. */
    type: 'file' | 'folder';
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
export declare function renderSelectionTag(payload: VscodeRefPayload, stale: boolean): string;
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
export declare function renderResourceTag(payload: VscodeResourcePayload): string;
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
export declare function expandVscodeMentions(messages: readonly UserMessage[], cwd: string | undefined, readFileRange: RangeReader, signal: AbortSignal): Promise<UserMessage[]>;
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
export declare function vscodeMentionPreStep(cwd: string | undefined, readFileRange: RangeReader, messages: readonly UserMessage[], signal: AbortSignal, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>;
/**
 * Production {@link RangeReader}: resolves the path under the session cwd —
 * confining every resolution (absolute or relative: an absolute path is a
 * legitimate wire form, honored exactly when it lands inside the workspace)
 * and rejecting `..` escapes, so the freshness check can never read outside
 * the workspace — then bounds the read size and returns the exact
 * LF-joined range.
 * @returns the range text, or null when it cannot be verified.
 */
export declare function createFileRangeReader(maxFileBytes?: number): RangeReader;
