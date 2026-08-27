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
export function producedPaths(view: unknown): readonly string[] {
  if (view === null || typeof view !== 'object') return []
  const record = view as { card?: unknown, kind?: unknown, locations?: unknown }
  const isEdit = record.card === 'diff' || (record.card === 'generic' && record.kind === 'edit')
  if (!isEdit) return []
  if (!Array.isArray(record.locations)) return []
  const paths: string[] = []
  for (const location of record.locations) {
    if (location !== null && typeof location === 'object' && typeof (location as { path?: unknown }).path === 'string') {
      paths.push((location as { path: string }).path)
    }
  }
  return paths
}

/**
 * Files produced by the turn the assistant at `seq` closes. Accumulation
 * resets on turn boundaries (a user message, or a node reporting a different
 * turn number); paths keep first-seen order and appear once.
 * @param nodes - snapshot nodes in surface order (structural, unknown-safe).
 * @param seq - the closing assistant's seq (the render site's anchor).
 * @returns produced paths; empty when the turn wrote nothing.
 */
export function producedForClosing(nodes: readonly unknown[], seq: number): readonly string[] {
  let pending: string[] = []
  let seen = new Set<string>()
  let turn: number | undefined
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue
    const record = node as { kind?: unknown, isError?: unknown, callView?: unknown, turn?: unknown, seq?: unknown }
    if (record.kind === 'tool-result') {
      if (record.isError === true) continue
      for (const path of producedPaths(record.callView)) {
        if (seen.has(path)) continue
        seen.add(path)
        pending.push(path)
      }
      continue
    }
    if (record.kind === 'user') {
      turn = undefined
      pending = []
      seen = new Set()
    } else if (typeof record.turn === 'number') {
      if (turn !== undefined && record.turn !== turn) {
        pending = []
        seen = new Set()
      }
      turn = record.turn
    }
    if (record.kind === 'assistant' && record.seq === seq) return pending
  }
  return []
}

/**
 * Claim the turn-tail chain only when the closing turn produced files —
 * the slot `select` body of the takeover (see turnTail.tsx).
 * @param owner - the turn-tail owner currency ({nodes, seq}).
 * @returns produced paths as the matched value, or null to decline.
 */
export function selectProducedFiles(owner: unknown): readonly string[] | null {
  const record = owner as { nodes?: unknown, seq?: unknown } | null
  if (record === null || typeof record !== 'object') return null
  if (!Array.isArray(record.nodes) || typeof record.seq !== 'number') return null
  const paths = producedForClosing(record.nodes, record.seq)
  return paths.length === 0 ? null : paths
}

/**
 * The slot gate as a pure function (unit-tested): claims the turn-tail chain
 * only while the takeover is enabled AND the closing turn produced files.
 * Declining returns null so the chain falls through (dsh-better-sidebar's
 * -1 entry, then the default deliverables row).
 */
export function makeTurnTailSelect(takeoverEnabled: () => boolean): (owner: unknown) => readonly string[] | null {
  return (owner: unknown): readonly string[] | null => {
    if (!takeoverEnabled()) return null
    return selectProducedFiles(owner)
  }
}
