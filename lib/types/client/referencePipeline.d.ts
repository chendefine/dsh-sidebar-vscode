/**
 * The reference pipeline's shared handle table: the lander the plugin
 * body installs (consumed by the tab's clipboard bridge) and the
 * paste-fallback options the tab keeps fresh — one typed home for what
 * used to be scattered module-level mutable singletons.
 *
 * The split is deliberate: the plugin BODY owns the service context
 * (sessions/conversation) and installs the lander; the TAB owns the live
 * per-session values (pathMap/cwd/caps) and refreshes the options; the
 * DOCK reads both at paste time. A single module (the plugin is a
 * singleton per page) is the simplest wiring that keeps all three
 * decoupled — no prop drilling through better-sidebar's slot faces, and
 * no React context the bridge (a plain DOM callback) could not reach.
 *
 * @module dsh-sidebar-vscode/client/referencePipeline
 */
import type { ClipboardPayload } from './selection.ts';
import type { InsertOutcome, PasteLandingOutcome, RecoveredPastePart, RefRemovalOutcome } from './references.ts';
/** Options kept fresh by the VSCode tab (the paste-fallback path). */
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
 * Implemented by the plugin body (which owns the service context) and
 * handed to the dock's inject face and the tab's bridge alike. The
 * payload can be an editor selection or an explorer file/folder list.
 * `at` is the range the chips replace (usually the composer caret), in
 * the plane the addressed composer's selection speaks — detect
 * coordinates on Lexical hosts, draft coordinates on textarea-era ones;
 * when omitted the implementation resolves the insertion point itself —
 * the displayed composer's caret for the addressed session, else the
 * draft tail.
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
/**
 * Remove every chip citing one reference from the addressed session's
 * draft (the rail's close affordance). Implemented by the plugin body;
 * the outcome tells the dock whether the chip-preserving path worked or
 * the legacy whole-draft splice must run instead.
 */
export type ReferenceRemover = (sessionId: string | undefined, ref: string) => Promise<RefRemovalOutcome>;
/** Install the module-level lander handle (plugin body; cleared on dispose). */
export declare function setReferenceLander(instance: ReferenceLander | undefined): void;
/** The lander installed by the plugin body (undefined before apply). */
export declare function getReferenceLander(): ReferenceLander | undefined;
/** Refresh the paste-fallback options (the tab's effect path). */
export declare function setFallbackOptions(options: FallbackOptions): void;
/** The freshest paste-fallback options (the dock reads them per paste). */
export declare function getFallbackOptions(): FallbackOptions;
