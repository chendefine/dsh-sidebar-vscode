/**
 * Composer dock: the reference rail and the paste fallbacks — the DSH-side
 * landing of VS Code selections that did not come through the iframe bridge.
 *
 * The rail projects the input machine's occurrence table (`input.occurrences`,
 * refreshed on every machine change) into one closable tag per distinct
 * vscode-selection reference. Closing a tag removes every chip citing that
 * reference from the draft — on Lexical hosts through the injected
 * chip-preserving removal (span-addressed consume-token transactions; see
 * `removeVscodeReferences`), falling back to the whole-draft `setDraft`
 * splice only where the inject face is absent.
 *
 * Two paste fallbacks cover what the bridge cannot: a clipboard envelope
 * (cross-origin or standalone editor windows) pasted into the composer
 * decodes back into the same reference chips the bridge path produces —
 * landing at the paste caret, like any paste — and a copied reference item
 * — the `@ [ label ]( dsh-vscode: … )` text a rendered chip yields on
 * copy, mangled or canonical — is recovered into chips at the caret with
 * its surrounding prose kept verbatim. Both address the modern
 * contenteditable composer (`div[data-composer-input]`, detect-coordinate
 * selection via the composer DOM mapping) and the textarea-era one alike.
 *
 * @module dsh-sidebar-vscode/client/composer
 */
import { type OccurrenceLike, type ReferenceInsertLike } from './references.ts';
import { type FallbackOptions, type MentionPaster, type ReferenceLander, type ReferenceRemover } from './referencePipeline.ts';
export type { FallbackOptions, MentionPaster, ReferenceLander, ReferenceRemover };
/** Props of the dock component (framework session kit + inject face). */
interface ComposerDockProps {
    /** The addressed session (the modern session-scoped dock owner prop). */
    session?: {
        readonly sessionId?: string;
    };
    /** Legacy dock props carried the bare id; kept for old hosts. */
    sessionId?: string;
    input: {
        readonly draft: string;
        readonly occurrences: readonly OccurrenceLike[];
    };
    inputActions: {
        setDraft(text: string): void;
    };
    lander: ReferenceLander;
    pasteMentions: MentionPaster;
    removeRef?: ReferenceRemover;
}
/**
 * The dock entry: renders the reference rail over the live occurrence table
 * and runs the paste fallbacks.
 */
export declare function ComposerDock(props: ComposerDockProps): React.ReactNode;
/**
 * Read the displayed composer's selection — the user's last caret or range,
 * which the surface keeps through focus loss into the VS Code iframe — in
 * the coordinates the displayed surface speaks: detect-projection offsets
 * for the modern contenteditable (see composerDom), draft offsets for the
 * textarea-era composer. Undefined whenever the composer is absent, inert,
 * or holds no addressable selection; the caller then falls back to the
 * draft tail.
 */
export declare function readActiveComposerSelection(): {
    start: number;
    end: number;
} | undefined;
/**
 * Restore the displayed composer's caret after an external landing. One
 * frame out — the editor's own commit settles first. Selection only, never
 * focus: the user's focus stays wherever they were working (typically
 * inside the VS Code iframe). Covers both surfaces: the contenteditable
 * mapping (a no-op without one) and the textarea's setSelectionRange.
 */
export declare function restoreActiveComposerCaret(caret: number): void;
/** Re-export for the plugin body's slot inject face typing. */
export type { ReferenceInsertLike };
