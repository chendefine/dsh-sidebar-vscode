/**
 * Unit tests for the turn-tail derivation replica (producedFiles.ts) — the
 * takeover's claim logic (research option II).
 *
 * @module dsh-sidebar-vscode/tests/producedFiles.spec
 */

import { describe, expect, it } from 'vitest'
import {
  makeTurnTailSelect,
  producedForClosing,
  producedPaths,
  selectProducedFiles,
} from '../src/client/producedFiles.ts'

/** One tool-result node shape the derivation reads. */
function toolResult(callView: unknown, isError = false, turn = 1): unknown {
  return { kind: 'tool-result', isError, callView, turn }
}

/** One assistant node shape. */
function assistant(seq: number, turn = 1): unknown {
  return { kind: 'assistant', seq, turn }
}

describe('producedPaths (render intent)', () => {
  it('diff cards and generic edit cards produce their locations', () => {
    expect(producedPaths({ card: 'diff', locations: [{ path: '/w/a.ts' }] })).toEqual(['/w/a.ts'])
    expect(producedPaths({ card: 'generic', kind: 'edit', locations: [{ path: '/w/b.ts' }] })).toEqual(['/w/b.ts'])
  })

  it('reads, deletes, failures, and non-edit cards produce nothing', () => {
    expect(producedPaths({ card: 'generic', kind: 'read', locations: [{ path: '/w/a.ts' }] })).toEqual([])
    expect(producedPaths({ card: 'generic', locations: [{ path: '/w/a.ts' }] })).toEqual([])
    expect(producedPaths({ locations: [{ path: '/w/a.ts' }] })).toEqual([])
    expect(producedPaths(null)).toEqual([])
    expect(producedPaths('x')).toEqual([])
  })

  it('malformed locations entries are skipped, not fatal', () => {
    expect(producedPaths({
      card: 'diff',
      locations: [{ path: '/w/a.ts' }, null, 3, { noPath: 1 }, { path: '/w/b.ts' }],
    })).toEqual(['/w/a.ts', '/w/b.ts'])
  })
})

describe('producedForClosing (turn scoping)', () => {
  it('collects the edit paths of the closing turn in first-seen order, deduped', () => {
    const nodes = [
      { kind: 'user' },
      toolResult({ card: 'diff', locations: [{ path: '/w/a.ts' }, { path: '/w/b.ts' }] }),
      toolResult({ card: 'generic', kind: 'edit', locations: [{ path: '/w/a.ts' }] }),
      assistant(7),
    ]
    expect(producedForClosing(nodes, 7)).toEqual(['/w/a.ts', '/w/b.ts'])
  })

  it('error tool-results are skipped', () => {
    const nodes = [
      { kind: 'user' },
      toolResult({ card: 'diff', locations: [{ path: '/w/a.ts' }] }, true),
      toolResult({ card: 'diff', locations: [{ path: '/w/b.ts' }] }),
      assistant(7),
    ]
    expect(producedForClosing(nodes, 7)).toEqual(['/w/b.ts'])
  })

  it('a user message resets accumulation (a previous turn cannot leak in)', () => {
    const nodes = [
      toolResult({ card: 'diff', locations: [{ path: '/w/old.ts' }] }),
      assistant(1),
      { kind: 'user' },
      toolResult({ card: 'diff', locations: [{ path: '/w/new.ts' }] }),
      assistant(2),
    ]
    expect(producedForClosing(nodes, 2)).toEqual(['/w/new.ts'])
  })

  it('a turn-number change resets accumulation too', () => {
    // Mirrors the upstream derivation: the reset fires when a node carries a
    // DIFFERENT turn number than the one seen before it — and only then. A
    // user message resets unconditionally; the assistant carrying the new
    // turn number arrives after the tool results, so the reset the old turn
    // would need must come from a node that reports the new turn BEFORE the
    // new results (the host's node stream does this via turn headers).
    const nodes = [
      { kind: 'user' },
      toolResult({ card: 'diff', locations: [{ path: '/w/old.ts' }] }, false, 1),
      { kind: 'assistant', seq: 1, turn: 1 },
      { kind: 'user' },
      { turn: 2 },
      toolResult({ card: 'diff', locations: [{ path: '/w/new.ts' }] }, false, 2),
      assistant(9, 2),
    ]
    expect(producedForClosing(nodes, 9)).toEqual(['/w/new.ts'])
  })

  it('an unmatched closing seq yields empty (foreign owner shape declines)', () => {
    const nodes = [toolResult({ card: 'diff', locations: [{ path: '/w/a.ts' }] })]
    expect(producedForClosing(nodes, 99)).toEqual([])
    expect(producedForClosing([], 1)).toEqual([])
    // null / non-object nodes never throw
    expect(producedForClosing([null, 'x', 3, assistant(1)], 1)).toEqual([])
  })
})

describe('selectProducedFiles / makeTurnTailSelect (the claim)', () => {
  /**
   * The owner shape the REAL render site hands the slot: ui-conversation's
   * TurnTailNodeView builds `{ turn, seq, openFile }` — no `nodes` field —
   * and the produced paths live in the engine Turn data under the
   * 'deliverables' key as `{ produced: [{ seq, path }, ...] }`.
   */
  function turnOwner(produced: ReadonlyArray<{ seq: number, path: string }>, seq = 5): unknown {
    return {
      turn: { data: { get: (key: string) => key === 'deliverables' ? { produced } : undefined } },
      seq,
      openFile: () => {},
    }
  }

  it('claims from the engine Turn data (the authoritative source)', () => {
    expect(selectProducedFiles(turnOwner([
      { seq: 3, path: '/w/a.ts' },
      { seq: 4, path: '/w/b.ts' },
    ]))).toEqual(['/w/a.ts', '/w/b.ts'])
  })

  it('excludes settlements after the closing seq and dedupes', () => {
    expect(selectProducedFiles(turnOwner([
      { seq: 3, path: '/w/a.ts' },
      { seq: 9, path: '/w/late.ts' },
      { seq: 4, path: '/w/a.ts' },
    ]))).toEqual(['/w/a.ts'])
  })

  it('declines when the Turn data reports no produced files', () => {
    expect(selectProducedFiles(turnOwner([]))).toBeNull()
  })

  it('a Turn without deliverables data falls back to the node replica (then declines)', () => {
    // A composition that does not publish the Turn data: the nodes fallback
    // runs and, with none, the entry declines.
    expect(selectProducedFiles({ turn: { data: { get: () => undefined } }, seq: 5 })).toBeNull()
    expect(selectProducedFiles({
      turn: { data: { get: () => undefined } },
      nodes: [
        { kind: 'user' },
        toolResult({ card: 'diff', locations: [{ path: '/w/a.ts' }] }),
        assistant(5),
      ],
      seq: 5,
    })).toEqual(['/w/a.ts'])
  })

  it('claims with the produced paths when the turn wrote files (nodes fallback)', () => {
    const owner = {
      nodes: [
        { kind: 'user' },
        toolResult({ card: 'diff', locations: [{ path: '/w/a.ts' }] }),
        assistant(5),
      ],
      seq: 5,
    }
    expect(selectProducedFiles(owner)).toEqual(['/w/a.ts'])
  })

  it('declines for owners whose turn produced nothing (nodes fallback)', () => {
    expect(selectProducedFiles({ nodes: [{ kind: 'user' }, assistant(5) ], seq: 5 })).toBeNull()
  })

  it('declines for malformed owners (never throws)', () => {
    expect(selectProducedFiles(null)).toBeNull()
    expect(selectProducedFiles(undefined)).toBeNull()
    expect(selectProducedFiles('x')).toBeNull()
    expect(selectProducedFiles({})).toBeNull()
    expect(selectProducedFiles({ nodes: 'not-array', seq: 1 })).toBeNull()
    expect(selectProducedFiles({ nodes: [], seq: 'x' })).toBeNull()
    expect(selectProducedFiles({ turn: { data: { get: () => 'garbage' } }, seq: 5 })).toBeNull()
  })

  it('the gated select declines while the takeover is disabled and claims otherwise', () => {
    // No openFile member here: this test pins the gate alone (the opener
    // carry has its own tests below).
    const enabledOwner = {
      turn: { data: { get: () => ({ produced: [{ seq: 3, path: '/w/a.ts' }] }) } },
      seq: 5,
    }
    const select = makeTurnTailSelect(() => false)
    expect(select(enabledOwner)).toBeNull()
    const enabled = makeTurnTailSelect(() => true)
    expect(enabled(enabledOwner)).toEqual({ paths: ['/w/a.ts'] })
    // The gate is read per claim, so flipping it flips the outcome.
    let on = false
    const live = makeTurnTailSelect(() => on)
    expect(live(enabledOwner)).toBeNull()
    on = true
    expect(live(enabledOwner)).toEqual({ paths: ['/w/a.ts'] })
  })

  it('the gated select carries the render site\'s stock opener on the match', () => {
    const opened: string[] = []
    const owner = {
      turn: { data: { get: () => ({ produced: [{ seq: 3, path: '/w/report.pdf' }] }) } },
      seq: 5,
      openFile: (path: string) => { opened.push(path) },
    }
    const select = makeTurnTailSelect(() => true)
    const match = select(owner)
    expect(match).toEqual({ paths: ['/w/report.pdf'], openFile: owner.openFile })
    match?.openFile?.('/w/report.pdf')
    expect(opened).toEqual(['/w/report.pdf'])
  })

  it('the match degrades gracefully without a stock opener (blocked chips fall back to VSCode)', () => {
    const owner = { turn: { data: { get: () => ({ produced: [{ seq: 3, path: '/w/a.ts' }] }) } }, seq: 5 }
    expect(makeTurnTailSelect(() => true)(owner)).toEqual({ paths: ['/w/a.ts'] })
    // A non-function openFile member is dropped, not carried.
    expect(makeTurnTailSelect(() => true)({ ...owner, openFile: 'nope' })).toEqual({ paths: ['/w/a.ts'] })
  })
})
