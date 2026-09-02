import { describe, expect, it } from 'vitest'
import { FocusRestoreBudget } from '../src/client/focusGuard.ts'

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
