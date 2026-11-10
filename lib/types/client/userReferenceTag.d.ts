/**
 * The user-row reference tag: the visible trace of this plugin's injected
 * contexts in the Chat transcript.
 *
 * Since dsh 0.1.7 the stock Chat visibility policy hides ordinary injected
 * `context` rows (only tool-change notices keep a row), and the labels the
 * user bubble folds in (`referenceLabels` / `skillNames`) are reserved for
 * the official `session-reference` and `skill-invocation` producers — so a
 * `<text-selection>` injection, while durable and model-visible, renders
 * nowhere in the message list. This module restores a tag through the seat
 * Chat already offers third parties: `conversation.chat.user.before`, the
 * chain seat dispatched above every user/steering bubble. The Host half
 * stamps each citing message's durable source with its citations' readable
 * labels (`vscodeReferences`, the `'user-vscode'` source member declared in
 * `src/mention.ts`); the seat's selector elects exactly those sources and
 * the entry renders one compact line — `VS Code 引用 · path L10-L12` — in
 * the same tertiary style as Chat's own reference summary. The line is
 * purely presentational: the label set is committed to the session log at
 * rewrite time, so it survives reloads, history paging, and offline logs
 * exactly like the message text itself.
 *
 * @module dsh-sidebar-vscode/client/userReferenceTag
 */
import type { ReactNode } from 'react';
/**
 * Read the vscode citation labels a durable user-message source carries.
 *
 * Session data is persisted, so every field is checked (the liveshare
 * user-origin seat's discipline): only a `kind: 'user'` source carrying a
 * non-empty array of non-empty strings elects; a malformed or absent record
 * declines and the seat falls through — the bubble never renders a broken
 * tag, and every other producer's source stays invisible here.
 * @param source - Chat's unparsed `user/message` source.
 * @returns the deduplicated label list, or undefined when the source cites nothing this plugin stamped.
 */
export declare function vscodeUserReferences(source: unknown): readonly string[] | undefined;
/** Props of the user-row reference tag: the chain seat's elected labels. */
export interface VscodeUserReferenceTagProps {
    /** Labels elected by {@link vscodeUserReferences}, first-seen order. */
    readonly matched: readonly string[];
}
/**
 * Render the citation summary line above one citing user bubble.
 *
 * @param props - the elected label list.
 * @returns one tertiary hint line mirroring Chat's own reference-summary style.
 */
export declare function VscodeUserReferenceTag({ matched }: VscodeUserReferenceTagProps): ReactNode;
