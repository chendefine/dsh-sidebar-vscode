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
import type { ResourceListPayload, SelectionPayload } from './selection.ts';
import { type RecoveredVscodeMention } from '../mentionCodec.ts';
/** The occurrence/source name this plugin registers in the trigger registry. */
export declare const VSCODE_SOURCE = "vscode-reference";
/** One inline reference chip insertion (ui-input-trigger `ReferenceInsert`). */
export interface ReferenceInsertLike {
    readonly source: string;
    readonly ref: string;
    readonly label: string;
    readonly appearance?: 'session' | 'file' | 'folder';
    readonly clipboardText: string;
}
/** Draft-time span with revision CAS (ui-input-trigger `TokenSpan`). */
export interface TokenSpanLike {
    readonly start: number;
    readonly end: number;
    readonly draftRev: number;
}
/** One settled chip row in the input machine's occurrence table. */
export interface OccurrenceLike {
    readonly occurrenceId: number;
    readonly source: string;
    readonly ref: string;
    readonly offset: number;
    readonly length: number;
    readonly label: string;
    readonly invalid?: boolean;
}
/** Published per-session input state (the InputZone currency). */
export interface InputStateLike {
    readonly draft: string;
    readonly draftRev: number;
    readonly phase: string;
    readonly occurrences: readonly OccurrenceLike[];
}
/** Per-session input facade (structural `SessionInput`). */
export interface SessionInputFace {
    insertReference(ref: ReferenceInsertLike, span: TokenSpanLike): boolean;
    /**
     * Draft write; the machine's own face also accepts the DOM-observed edit
     * shape (narrowing the occurrence reconciliation), passed through as the
     * optional second argument when the caller knows the paste's range.
     */
    setDraft(text: string, editRange?: {
        readonly start: number;
        readonly end: number;
        readonly insertedLength: number;
    }): void;
    readonly state: {
        getSnapshot(): InputStateLike;
    };
}
/** Sessions service face: session-scope context resolution. */
export interface SessionsServiceFace {
    scope(id: string): unknown | undefined;
}
/** Conversation service face: the per-session input resolver. */
export interface ConversationServiceFace {
    readonly input: {
        for(actx: unknown): SessionInputFace;
    };
}
/** Capture bounds and path translation applied to one clipboard payload. */
export interface RefBuildOptions {
    /** Path-translation rules (container path → DSH path), from parsePathMap. */
    readonly reverseRules?: readonly {
        from: string;
        to: string;
    }[];
    /** The session's authoritative cwd, used to relativize DSH absolute paths. */
    readonly cwd?: string;
    /** Rendered code-line cap (unset → 200; clamped to 1–2000). */
    readonly maxLines?: number;
    /** Rendered code byte cap (unset → 20000; clamped to 1000–200000). */
    readonly maxBytes?: number;
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
export declare function resolveWorkspacePath(path: string, relative: string | undefined, reverseRules: readonly {
    from: string;
    to: string;
}[] | undefined, cwd: string | undefined): string;
/** sha-256 hex prefix of the hash-normalized snapshot; '' when unavailable. */
export declare function hashSnapshot(text: string): Promise<string>;
/**
 * Build one atomic composer chip per selection span of a decoded payload.
 * @param payload - the decoded clipboard envelope payload.
 * @param options - path translation and capture bounds.
 * @returns one {@link ReferenceInsertLike} per span, in editor order.
 */
export declare function buildRefsFromPayload(payload: SelectionPayload, options: RefBuildOptions): Promise<ReferenceInsertLike[]>;
/** Path translation applied to one explorer resource payload (no caps — nothing is captured). */
export interface ResourceRefOptions {
    /** Path-translation rules (container path → DSH path), from parsePathMap. */
    readonly reverseRules?: readonly {
        from: string;
        to: string;
    }[];
    /** The session's authoritative cwd, used to relativize DSH absolute paths. */
    readonly cwd?: string;
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
export declare function buildResourceRefsFromPayload(payload: ResourceListPayload, options: ResourceRefOptions): ReferenceInsertLike[];
/** Outcome of landing a batch of references on one session's composer. */
export interface InsertOutcome {
    /** References that landed as atomic chips. */
    readonly inserted: number;
    /** References that landed as plain-text mentions (machine refused the chip). */
    readonly textFallback: number;
    /**
     * Draft offset just past the last landed reference (the restored caret);
     * undefined when nothing landed or no session composer resolved at all.
     */
    readonly caret?: number;
    /** True when no session composer could be resolved at all. */
    readonly failed: boolean;
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
export declare function insertVscodeReferences(sessions: SessionsServiceFace | undefined, conversation: ConversationServiceFace | undefined, sessionId: string | undefined, refs: readonly ReferenceInsertLike[], at?: {
    readonly start: number;
    readonly end: number;
}): Promise<InsertOutcome>;
/** One mention-carrying paste segment: verbatim prose or one reference chip. */
export type RecoveredPastePart = {
    readonly kind: 'text';
    readonly text: string;
} | {
    readonly kind: 'ref';
    readonly ref: ReferenceInsertLike;
};
/** Parsed paste: interleaved prose and mention parts, plus the chips alone. */
export interface RecoveredPaste {
    readonly parts: readonly RecoveredPastePart[];
    readonly refs: readonly ReferenceInsertLike[];
}
/**
 * Build one atomic composer chip per recovered mention payload. The payload
 * already carries its (possibly truncated) capture snapshot and resolved
 * path, so nothing is re-derived — the chip identity is the canonical
 * mention rebuilt from the payload, exactly like a freshly captured one.
 * @param mentions - recovered mentions (either kind), in text order.
 * @returns one {@link ReferenceInsertLike} per mention.
 */
export declare function refsFromRecoveredMentions(mentions: readonly RecoveredVscodeMention[]): ReferenceInsertLike[];
/**
 * Parse pasted text into prose parts plus reference chips for every
 * recovered mention copy (see {@link scanRecoveredMentions}). Edge
 * whitespace is trimmed — copying a rendered item drags surrounding blank
 * lines that a paste should not re-insert — while interior text stays
 * verbatim so a prose-and-mention paste keeps its shape.
 * @param text - the pasted plain text.
 * @returns the parsed paste, or null when no mention copy is recoverable.
 */
export declare function parseRecoveredPaste(text: string): RecoveredPaste | null;
/** Outcome of landing one recovered paste on a session's composer. */
export interface PasteLandingOutcome extends InsertOutcome {
    /**
     * Draft offset just past the landed paste region (the restored caret);
     * undefined when no session composer resolved at all.
     */
    readonly caret?: number;
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
export declare function pasteRecoveredMentions(sessions: SessionsServiceFace | undefined, conversation: ConversationServiceFace | undefined, sessionId: string | undefined, parts: readonly RecoveredPastePart[], selection: {
    readonly start: number;
    readonly end: number;
}): Promise<PasteLandingOutcome>;
/** One rail tag: a distinct vscode-selection reference in the draft. */
export interface RailTag {
    /** Canonical mention — the identity shared by every chip of this reference. */
    readonly ref: string;
    /** Display label (insert-time cache of the first occurrence). */
    readonly label: string;
    /** Whether the captured snapshot was truncated. */
    readonly truncated: boolean;
    /** Whether this tag cites a folder resource (file/folder icon pick). */
    readonly folder: boolean;
    /** Whether every chip of this reference lost its owner (renders invalid). */
    readonly invalid: boolean;
    /** How many chips in the draft cite this reference. */
    readonly count: number;
    /** Draft ranges of every citing chip, ascending. */
    readonly ranges: readonly {
        readonly offset: number;
        readonly length: number;
    }[];
}
/**
 * Project the rail view over the input machine's occurrence table: distinct
 * vscode-selection references in first-appearance order, each with the ranges
 * of every chip citing it.
 * @param occurrences - the live occurrence table.
 */
export declare function groupRailTags(occurrences: readonly OccurrenceLike[]): RailTag[];
/**
 * Compute the next draft with every chip citing one reference removed:
 * ranges splice high-to-low, a doubled space at a seam collapses to one, and
 * a draft left whitespace-only clears to ''.
 * @param draft - the current draft text.
 * @param occurrences - the live occurrence table.
 * @param ref - the canonical mention to remove.
 * @returns the next draft to write through `inputActions.setDraft`.
 */
export declare function removeRefRanges(draft: string, occurrences: readonly OccurrenceLike[], ref: string): string;
