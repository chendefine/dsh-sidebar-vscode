/**
 * Pure derivation of one turn's produced files from finalized conversation
 * nodes — a structural REPLICA of dsh-better-sidebar's produced-files.ts
 * (itself a replica of ui-deliverables' `producedForClosing`: the mutation
 * tools' follow-along `locations`, by render intent — a diff card or a
 * generic edit card; reads/deletes/failures produce nothing). Replicated
 * here (not imported from the peer) so this plugin's turn-tail takeover
 * stays self-contained in the client bundle and unit-testable without the
 * peer installed; keep in sync when the upstream drifts.
 *
 * The slot `select` itself (selectProducedFiles, below) reads the ENGINE's
 * Turn data first — `owner.turn.data.get('deliverables')`, exactly what
 * ui-deliverables' own registration reads — and keeps this node walk only
 * as a fallback: the real render site (ui-conversation's TurnTailNodeView)
 * hands entries a `{ turn, seq, openFile }` owner with NO `nodes` field, so
 * a nodes-only select can never match.
 *
 * Used by the turn-tail interception (turnTail.tsx) to claim the
 * produced-files row — the "changed files" chips at the end of a turn —
 * and reroute their clicks into the VSCode tab.
 *
 * @module dsh-sidebar-vscode/client/producedFiles
 */
/** Paths a tool-result view reports as produced, by render intent. */
export declare function producedPaths(view: unknown): readonly string[];
/**
 * Files produced by the turn the assistant at `seq` closes. Accumulation
 * resets on turn boundaries (a user message, or a node reporting a different
 * turn number); paths keep first-seen order and appear once.
 * @param nodes - snapshot nodes in surface order (structural, unknown-safe).
 * @param seq - the closing assistant's seq (the render site's anchor).
 * @returns produced paths; empty when the turn wrote nothing.
 */
export declare function producedForClosing(nodes: readonly unknown[], seq: number): readonly string[];
/**
 * Claim the turn-tail chain only when the closing turn produced files —
 * the slot `select` body of the takeover (see turnTail.tsx).
 *
 * The authoritative source is the engine Turn data — the same value
 * ui-deliverables reads (`owner.turn.data.get('deliverables')`): a
 * `{ produced: [{ seq, path }, ...] }` record accumulated per Turn, with the
 * render site passing the closing assistant's seq in `owner.seq` so later
 * Tool settlements are excluded. The node-based replica below stays as a
 * fallback for compositions that do not publish that Turn data (the shape
 * the 0.1.1 select wrongly required as the ONLY source — the takeover's
 * claim never matched, which is exactly the bug this corrects).
 * @param owner - the turn-tail owner currency ({turn, seq, openFile}).
 * @returns produced paths as the matched value, or null to decline.
 */
export declare function selectProducedFiles(owner: unknown): readonly string[] | null;
/**
 * The turn-tail slot's matched value: the produced paths PLUS the stock
 * opener the render site hands down. Chips route each path individually
 * (openInVscode, or — for an open-blocklist hit — the stock `openFile`,
 * which flows into the same wrapped chat funnel the prose path links use,
 * where the blocklist declines it to the Host opener); carrying the
 * opener on the match is the one way it reaches the component, because
 * the slot's `inject` callback receives only the sessionId.
 */
export interface TurnTailMatch {
    /** Produced paths, first-seen order, deduped. */
    readonly paths: readonly string[];
    /** The render site's stock opener, when the composition provides one
     * (ui-conversation's TurnTailNodeView hands `{ turn, seq, openFile }`);
     * absent in compositions that do not, where a blocked chip degrades to
     * the VSCode open rather than to a dead click. */
    readonly openFile?: (path: string) => void;
}
/**
 * The slot gate as a pure function (unit-tested): claims the turn-tail chain
 * only while the takeover is enabled AND the closing turn produced files.
 * The claim is never filtered by the open blocklist — the row is
 * informative (every produced chip renders); each chip click decides its
 * own route. Declining returns null so the chain falls through
 * (dsh-better-sidebar's -1 entry, then the default deliverables row).
 */
export declare function makeTurnTailSelect(takeoverEnabled: () => boolean): (owner: unknown) => TurnTailMatch | null;
