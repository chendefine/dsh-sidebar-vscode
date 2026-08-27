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
 * @param owner - the turn-tail owner currency ({nodes, seq}).
 * @returns produced paths as the matched value, or null to decline.
 */
export declare function selectProducedFiles(owner: unknown): readonly string[] | null;
/**
 * The slot gate as a pure function (unit-tested): claims the turn-tail chain
 * only while the takeover is enabled AND the closing turn produced files.
 * Declining returns null so the chain falls through (dsh-better-sidebar's
 * -1 entry, then the default deliverables row).
 */
export declare function makeTurnTailSelect(takeoverEnabled: () => boolean): (owner: unknown) => readonly string[] | null;
