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
    /** Clipboard/persistence projection of the chip (Lexical hosts carry it). */
    readonly clipboardText?: string;
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
     * Whole-draft write. On Lexical hosts this REPLACES the editor content as
     * plain text — flattening every chip — so it is this plugin's last-resort
     * fallback only; the textarea-era machine treated it as a splice and kept
     * its occurrences reconciled by diff-scan.
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
/**
 * The Lexical-era composer keyboard face (`conversation.input.keyboard(id)`
 * answers the per-session shell structurally). `caretSpan` reads the live
 * editor selection — the user's last caret — in detect coordinates.
 */
export interface ComposerKeyboardFace {
    caretSpan(): {
        readonly start: number;
        readonly end: number;
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
        /** Lexical hosts: the per-session keyboard face (may throw on unknown ids). */
        keyboard?(sessionId: string): ComposerKeyboardFace;
    };
}
/**
 * Scoped input-mutation events the Lexical-era hub listens for on every
 * session scope (declared public in the ui-conversation input contract —
 * the host's own trigger pipeline dispatches through the same seam).
 * Structural and optional: absence simply keeps the legacy write paths.
 */
export interface SessionScopeFace {
    bail?(thisArg: unknown, event: 'slash/input-insert-text' | 'slash/input-consume-token', request: unknown): boolean | undefined;
}
/**
 * Whether one input facade is the Lexical-era shell. The shell owns its
 * editor (`readonly editor: LexicalEditor`); the textarea-era machine never
 * did. Everything plane-sensitive branches on this single probe.
 */
export declare function isLexicalInput(input: SessionInputFace): boolean;
/**
 * Length of the detect projection: the clipboard draft minus every chip's
 * expansion beyond its single detect character.
 */
export declare function detectLengthOf(snapshot: {
    readonly draft: string;
    readonly occurrences: readonly OccurrenceLike[];
}): number;
/**
 * Clipboard offset → detect offset (host parity with
 * `detectOffsetOfClipboardOffset`): offsets before a chip map before it;
 * offsets at or inside a chip's expansion snap to the chip's trailing edge.
 */
export declare function detectOfClipboard(clipboardOffset: number, occurrences: readonly OccurrenceLike[]): number;
/**
 * Detect offset → clipboard offset: the inverse of {@link detectOfClipboard}.
 * A detect offset at a chip's leading edge maps before its expansion; at the
 * trailing edge (leading+1) it maps after it.
 */
export declare function clipboardOfDetect(detectOffset: number, occurrences: readonly OccurrenceLike[]): number;
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
     * Offset just past the last landed reference (the restored caret), in the
     * plane the addressed composer's selection speaks — detect coordinates on
     * Lexical hosts, draft coordinates on textarea-era ones; undefined when
     * nothing landed or no session composer resolved at all.
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
 * historical end-of-draft append. Spans are detect-projection offsets on
 * Lexical hosts ({@link isLexicalInput}) and draft offsets on textarea-era
 * ones — `at` must come from the same plane (the keyboard face's
 * `caretSpan()`, the composer DOM mapping, or a textarea selection).
 *
 * Whenever the input machine refuses the chip transaction (mid-submit
 * phases, CAS loss after retry) the canonical mention lands as plain text
 * over the same point — on Lexical hosts through the span-addressed
 * `'slash/input-insert-text'` event so every OTHER chip survives intact,
 * and only on textarea-era hosts through the whole-draft `setDraft` write.
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
     * Offset just past the landed paste region (the restored caret), in the
     * plane the addressed composer's selection speaks; undefined when no
     * session composer resolved at all.
     */
    readonly caret?: number;
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
/** Outcome of removing one reference's chips from a session's composer. */
export interface RefRemovalOutcome {
    /** Chips removed as atomic occurrences. */
    readonly removed: number;
    /** True when the machine refused and the whole-draft fallback ran instead. */
    readonly degraded: boolean;
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
export declare function removeVscodeReferences(sessions: SessionsServiceFace | undefined, conversation: ConversationServiceFace | undefined, sessionId: string | undefined, ref: string): Promise<RefRemovalOutcome>;
