/**
 * DOM face of the modern DSH composer: the Lexical contenteditable that
 * replaced the textarea stack (DSH ≥ 0.1.2-alpha.2, PR #2852).
 *
 * The editable surface is `div[data-composer-input][contenteditable]` inside
 * `[data-composer-card]`; its document is Lexical's plain-text tree —
 * paragraph blocks (`<p>`), text nodes (wrapped in
 * `span[data-lexical-text]`), `<br>` line breaks, and one
 * `span[data-composer-chip][contenteditable=false]` per reference chip whose
 * decorator content (the boxed label) must never be descended into.
 *
 * The machine addresses edits in the DETECT projection (every chip counts as
 * ONE `￼` character; paragraphs join with one `\n`), so this module maps DOM
 * selection boundaries ⇄ detect offsets: the replacement for the textarea's
 * `selectionStart`/`setSelectionRange` pair the old composer exposed.
 *
 * The walk is written against a structural node face so the mapping logic is
 * unit-testable without a DOM; real DOM nodes satisfy the shape at runtime.
 *
 * @module dsh-sidebar-vscode/client/composerDom
 */
/** The minimal node face the walk reads. */
export interface NodeLike {
    readonly nodeType: number;
    readonly nodeName: string;
    /** Text nodes only. */
    readonly data?: string;
    readonly childNodes: readonly NodeLike[];
    readonly parentNode: NodeLike | null;
    getAttribute?(name: string): string | null;
}
/** A DOM selection boundary: (container node, offset into it). */
export interface DomPoint {
    readonly container: NodeLike;
    readonly offset: number;
}
/** The walk product: everything the boundary mapping needs. */
export interface ComposerLayoutMap {
    readonly detectLength: number;
    /** DOM boundary → detect offset; null when the boundary is foreign. */
    detectOffsetOf(point: DomPoint): number | null;
    /** Detect offset → DOM boundary; null when out of range. */
    domPointOf(detectOffset: number): DomPoint | null;
}
/**
 * Build the detect-projection map over one composer editable.
 *
 * Block gaps: between every consecutive pair of the root's child nodes —
 * mirroring the host's own `$composerLayout` (a gap is one `\n` regardless
 * of what the two neighbors are; empty paragraphs still get their seams).
 *
 * @param root - the contenteditable element (any structural node works).
 */
export declare function buildComposerLayoutMap(root: NodeLike): ComposerLayoutMap;
/** Structural face of a real DOM element/document this module touches. */
interface DocumentLike {
    readonly querySelector: (selector: string) => unknown;
    getSelection?(): SelectionLike | null;
}
/** Structural selection face (read side + the restore writes). */
interface SelectionLike {
    readonly rangeCount: number;
    readonly anchorNode: NodeLike | null;
    readonly anchorOffset: number;
    readonly focusNode: NodeLike | null;
    readonly focusOffset: number;
    removeAllRanges?(): void;
    addRange?(range: unknown): void;
}
/** Replace the document face (tests). */
export declare function setComposerDocument(next: DocumentLike | undefined): void;
/**
 * Locate the displayed conversation's editable composer surface. Only an
 * EDITABLE surface answers: the no-session hero card renders the same
 * attributes inert (a workspace trigger, not an input).
 */
export declare function findComposerEditable(): NodeLike | null;
/**
 * Read the live DOM selection of the displayed composer in detect
 * coordinates — the user's last caret or range, which the contenteditable
 * keeps through focus loss into the VS Code iframe. Undefined whenever the
 * composer is absent or the selection is not wholly inside it.
 */
export declare function readComposerSelectionDetect(): {
    readonly start: number;
    readonly end: number;
} | undefined;
/**
 * Place the DOM caret of the displayed composer at one detect offset — the
 * contenteditable replacement for the textarea's `setSelectionRange`.
 * Selection only, never focus: the user's focus stays wherever they were
 * working (typically inside the VS Code iframe); Lexical adopts the DOM
 * selection when the surface regains focus. One frame out so a concurrent
 * controlled-value render settles first. Best-effort by design.
 */
export declare function restoreComposerCaretDetect(caret: number): void;
export {};
