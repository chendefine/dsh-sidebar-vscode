/**
 * Composer dock: the reference rail and the paste fallbacks — the DSH-side
 * landing of VS Code selections that did not come through the iframe bridge.
 *
 * The rail projects the input machine's occurrence table (`input.occurrences`,
 * refreshed on every machine change) into one closable tag per distinct
 * vscode-selection reference. Closing a tag removes every chip citing that
 * reference from the draft through `inputActions.setDraft` — the machine's
 * diff-scan reconciles the occurrence table, and once no canonical mention
 * remains in the draft there is nothing for the host boundary to inject.
 *
 * Two paste fallbacks cover what the bridge cannot: a clipboard envelope
 * (cross-origin or standalone editor windows) pasted into the composer
 * textarea decodes back into the same reference chips the bridge path
 * produces — landing at the paste caret, like any paste — and a copied
 * reference item — the `@ [ label ]( dsh-vscode: … )` text a rendered chip
 * yields on copy, mangled or canonical — is recovered into chips at the
 * caret with its surrounding prose kept verbatim.
 *
 * @module dsh-sidebar-vscode/client/composer
 */
import { type InsertOutcome, type OccurrenceLike, type PasteLandingOutcome, type RecoveredPastePart, type ReferenceInsertLike } from './references.ts';
import { type ClipboardPayload } from './selection.ts';
/** Options kept fresh by the VSCode tab render (paste fallback path). */
export interface FallbackOptions {
    readonly reverseRules?: readonly {
        from: string;
        to: string;
    }[];
    readonly cwd?: string;
    readonly maxLines?: number;
    readonly maxBytes?: number;
}
/**
 * Land one decoded payload's reference chips on the addressed session.
 * Implemented by the plugin body (which owns the service context) and handed
 * in through the slot's inject face. The payload can be an editor selection
 * or an explorer file/folder list. `at` is the draft range the chips replace
 * (usually the composer caret); when omitted the implementation resolves the
 * insertion point itself — the displayed composer's caret for the addressed
 * session, else the draft tail — and owns the post-landing caret restore.
 */
export type ReferenceLander = (sessionId: string | undefined, payload: ClipboardPayload, options: FallbackOptions, at?: {
    readonly start: number;
    readonly end: number;
}) => Promise<InsertOutcome>;
/**
 * Land one parsed mention-carrying paste on the addressed session at the
 * paste selection. Implemented by the plugin body beside the lander.
 */
export type MentionPaster = (sessionId: string | undefined, parts: readonly RecoveredPastePart[], selection: {
    start: number;
    end: number;
}) => Promise<PasteLandingOutcome>;
/** Props of the dock component (framework session kit + inject face). */
interface ComposerDockProps {
    sessionId: string;
    input: {
        readonly draft: string;
        readonly occurrences: readonly OccurrenceLike[];
    };
    inputActions: {
        setDraft(text: string): void;
    };
    lander: ReferenceLander;
    pasteMentions: MentionPaster;
}
/**
 * Idempotently install the rail stylesheet into `document.head`. Tokens and
 * layout variables are host globals, so the stylesheet stands alone.
 * @returns a disposer that removes the element (safe to call twice).
 */
export declare function adoptRailStyles(): () => void;
/**
 * The dock entry: renders the reference rail over the live occurrence table
 * and runs the paste fallbacks.
 */
export declare function ComposerDock(props: ComposerDockProps): React.ReactNode;
/** Refresh the paste-fallback options (VSCode tab render path). */
export declare function setFallbackOptions(options: FallbackOptions): void;
/** Install the module-level lander handle (plugin body). */
export declare function setReferenceLander(instance: ReferenceLander | undefined): void;
/** The lander installed by the plugin body (undefined before apply). */
export declare function getReferenceLander(): ReferenceLander | undefined;
/**
 * Read the displayed composer's selection — the user's last caret or range,
 * which a textarea keeps through focus loss into the VS Code iframe.
 * Undefined whenever the composer is absent or not addressable; the caller
 * then falls back to the draft tail.
 */
export declare function readActiveComposerSelection(): {
    start: number;
    end: number;
} | undefined;
/**
 * Restore the displayed composer's caret after an external landing. One
 * frame out — the controlled textarea's value propagates first. Selection
 * only, never focus: the user's focus stays wherever they were working
 * (typically inside the VS Code iframe).
 */
export declare function restoreActiveComposerCaret(caret: number): void;
/** Re-export for the plugin body's slot inject face typing. */
export type { ReferenceInsertLike };
