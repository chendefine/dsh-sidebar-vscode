/**
 * Unit tests for the DOM-quiet boot watcher (the boot gate's fallback
 * reveal path on host halves without the boot.begin/boot.status routes).
 *
 * @module dsh-sidebar-vscode/tests/bootGate.spec
 */

import { describe, expect, it } from 'vitest'
import { watchBootQuiet } from '../src/client/bootGate.ts'

const timing = { minElapsedMs: 1500, quietMs: 1200, timeoutMs: 8000, intervalMs: 250 }

/** A manual clock + scheduler harness around one watcher. */
function harness(sample: () => string | null) {
  const reveals: number[] = []
  let clock = 10_000
  const queue: Array<{ at: number, cb: () => void }> = []
  const schedule = (cb: () => void, ms: number): void => { queue.push({ at: clock + ms, cb }) }
  const advance = (ms: number): void => {
    const target = clock + ms
    for (;;) {
      queue.sort((a, b) => a.at - b.at)
      const at = queue.findIndex(item => item.at <= target)
      if (at < 0) break
      const item = queue[at]!
      queue.splice(at, 1)
      clock = item.at
      item.cb()
    }
    clock = target
  }
  const stop = watchBootQuiet({ sample }, () => reveals.push(clock), timing, schedule, () => clock)
  return { reveals, advance, stop }
}

describe('watchBootQuiet', () => {
  it('reveals once the rendered tab strip is quiet and the minimum elapsed time passed', () => {
    let signature = 'a.ts|b.ts*'
    const h = harness(() => signature)
    // The signature never changes: the first sample (250ms) marks the
    // change, the quiet window (1200ms) closes at 1450ms, and the minimum
    // elapsed time (1500ms) rules — the reveal lands on the 1500ms tick.
    h.advance(10_000)
    expect(h.reveals).toEqual([10_000 + 1500])
  })

  it('a cross-origin sample (null) reveals immediately — ungated', () => {
    const h = harness(() => null)
    h.advance(1000)
    expect(h.reveals).toEqual([10_000 + 250])
  })

  it('a late tab-strip mutation re-arms the quiet window', () => {
    let signature = 'ghost.ts'
    const h = harness(() => signature)
    h.advance(1000) // first sample at 250ms marks the change
    signature = 'a.ts|b.ts*' // the reconcile mutates at t=1000
    h.advance(10_000)
    // Change observed at the 1250ms tick; quiet for 1200ms from there
    // closes at 2450ms — the reveal lands on the 2500ms tick.
    expect(h.reveals).toEqual([10_000 + 2500])
  })

  it('a shell that never renders falls to the bounded timeout', () => {
    const h = harness(() => '')
    h.advance(20_000)
    expect(h.reveals).toEqual([10_000 + 8000])
  })

  it('reveals at most once, and a stopped watcher reveals never', () => {
    const h = harness(() => 'a.ts')
    h.advance(500)
    h.stop()
    h.advance(20_000)
    expect(h.reveals).toEqual([])
  })
})
