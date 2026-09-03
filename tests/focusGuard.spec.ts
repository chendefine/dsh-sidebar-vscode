import { describe, expect, it } from 'vitest'
import { fenceShouldBounce, type FenceFacts, FocusRestoreBudget } from '../src/client/focusGuard.ts'

describe('FocusRestoreBudget', () => {
  it('allows takes up to the cap inside one window', () => {
    const budget = new FocusRestoreBudget(3, 10_000)
    expect(budget.take(0)).toBe(true)
    expect(budget.take(1)).toBe(true)
    expect(budget.take(2)).toBe(true)
    // Cap reached: the fence stands down instead of ping-ponging focus.
    expect(budget.take(3)).toBe(false)
    expect(budget.take(4)).toBe(false)
  })

  it('re-arms after the window slides past', () => {
    const budget = new FocusRestoreBudget(2, 1_000)
    expect(budget.take(0)).toBe(true)
    expect(budget.take(500)).toBe(true)
    expect(budget.take(600)).toBe(false)
    // Exactly at the window boundary: the window resets and re-arms.
    expect(budget.take(1_600)).toBe(true)
    expect(budget.take(1_700)).toBe(true)
    expect(budget.take(1_800)).toBe(false)
  })

  it('keeps the fresh window anchored at its first take', () => {
    const budget = new FocusRestoreBudget(1, 1_000)
    expect(budget.take(5_000)).toBe(true)
    expect(budget.take(5_500)).toBe(false)
    // 6_000 - 5_000 >= 1_000: re-armed, and the window now starts at 6_000.
    expect(budget.take(6_000)).toBe(true)
    expect(budget.take(6_999)).toBe(false)
    expect(budget.take(7_000)).toBe(true)
  })
})

describe('fenceShouldBounce', () => {
  const boot = (over: Partial<FenceFacts>): FenceFacts => ({
    hidden: false,
    bootArmed: true,
    bootUntil: 10_000,
    gestureAt: 0,
    parentTabAt: 0,
    ...over,
  })

  it('bounces a boot-window grab with no evidence of user intent', () => {
    // The remount boot: workbench restored an editor and focused it
    // while the composer had the caret. No gesture, no handoff.
    expect(fenceShouldBounce(boot({ bootUntil: 6_000 }), 1_000)).toBe(true)
  })

  it('stands down once the boot window lapses', () => {
    const facts = boot({ bootUntil: 6_000 })
    expect(fenceShouldBounce(facts, 5_999)).toBe(true)
    expect(fenceShouldBounce(facts, 6_000)).toBe(false)
    expect(fenceShouldBounce(facts, 20_000)).toBe(false)
  })

  it('stands down once the user gestured inside the frame', () => {
    // A click inside the workbench: every later entry is user-driven.
    expect(fenceShouldBounce(boot({ gestureAt: 2_000 }), 2_100)).toBe(false)
    expect(fenceShouldBounce(boot({ gestureAt: 2_000 }), 5_900)).toBe(false)
  })

  it('allows a parent Tab keypress as a focus handoff', () => {
    expect(fenceShouldBounce(boot({ parentTabAt: 1_000 }), 1_200)).toBe(false)
    // Just outside the handoff window: back to bouncing.
    expect(fenceShouldBounce(boot({ parentTabAt: 1_000 }), 1_400)).toBe(true)
  })

  it('always bounces while hidden, even with a stale in-frame gesture', () => {
    // The frame cannot receive clicks while hidden; a gesture recorded
    // before the hide must not legitimize a later steal.
    expect(fenceShouldBounce(boot({ hidden: true }), 1_000)).toBe(true)
    expect(fenceShouldBounce(boot({ hidden: true, gestureAt: 500 }), 1_000)).toBe(true)
    expect(fenceShouldBounce(boot({ hidden: true, gestureAt: 500, parentTabAt: 900 }), 1_000)).toBe(true)
  })

  it('stays open when the boot fence is not armed', () => {
    // Sanctioned boots (deferred load released by a visible flip, a
    // manual reload) and the steady state after any window.
    expect(fenceShouldBounce(boot({ bootArmed: false }), 100)).toBe(false)
    expect(fenceShouldBounce(boot({ bootArmed: false, hidden: false, gestureAt: 0, parentTabAt: 0 }), 100)).toBe(false)
  })
})
