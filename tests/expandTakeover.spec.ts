/**
 * Unit tests for the expand-button takeover (expandTakeover.ts): the pure
 * claim decision (gate, selector match, consume-only-after-success) and the
 * document listener installer (capture phase, disposal).
 *
 * @module dsh-sidebar-vscode/tests/expandTakeover.spec
 */

import { describe, expect, it, vi } from 'vitest'
import {
  claimExpandClick,
  EXPAND_BUTTON_SELECTOR,
  installExpandTakeover,
  isExpandControlClick,
  type ClaimEvent,
  type ListenerTarget,
} from '../src/client/expandTakeover.ts'

/** One fake element answering `closest` for a fixed selector. */
function element(matching: boolean): object {
  return {
    closest: (selector: string) => (matching && selector === EXPAND_BUTTON_SELECTOR ? {} : null),
  }
}

/** One captured click event recording its consumption. */
function clickOn(target: unknown): ClaimEvent & { consumed: () => number } {
  let consumed = 0
  const event: ClaimEvent = {
    target,
    stopPropagation: () => { consumed += 1 },
    preventDefault: () => { consumed += 1 },
  }
  return Object.assign(event, { consumed: () => consumed })
}

/** The gate/open pair as fakes: an open that succeeds or throws on demand. */
function deps(enabled: boolean, openThrows = false) {
  return {
    takeoverEnabled: vi.fn(() => enabled),
    openWorkbench: openThrows ? vi.fn(() => { throw new Error('no seat') }) : vi.fn(),
  }
}

// ---- isExpandControlClick ----

describe('isExpandControlClick', () => {
  it('matches a click inside the marked control', () => {
    expect(isExpandControlClick(element(true))).toBe(true)
  })

  it('declines other targets', () => {
    expect(isExpandControlClick(element(false))).toBe(false)
    expect(isExpandControlClick(null)).toBe(false)
    expect(isExpandControlClick('button')).toBe(false)
    expect(isExpandControlClick({})).toBe(false)
  })

  it('declines a target whose closest throws', () => {
    expect(isExpandControlClick({ closest: () => { throw new Error('detached') } })).toBe(false)
  })
})

// ---- claimExpandClick ----

describe('claimExpandClick', () => {
  it('claims a switch-on click on the control: opens, then consumes', () => {
    const d = deps(true)
    const event = clickOn(element(true))
    expect(claimExpandClick(event, d)).toBe(true)
    expect(d.openWorkbench).toHaveBeenCalledTimes(1)
    expect(event.consumed()).toBe(2)
  })

  it('declines while the switch is off without touching the event', () => {
    const d = deps(false)
    const event = clickOn(element(true))
    expect(claimExpandClick(event, d)).toBe(false)
    expect(d.openWorkbench).not.toHaveBeenCalled()
    expect(event.consumed()).toBe(0)
  })

  it('declines clicks outside the control even with the switch on', () => {
    const d = deps(true)
    const event = clickOn(element(false))
    expect(claimExpandClick(event, d)).toBe(false)
    expect(d.openWorkbench).not.toHaveBeenCalled()
    expect(event.consumed()).toBe(0)
  })

  it('falls through to the stock expand when the open throws', () => {
    const d = deps(true, true)
    const event = clickOn(element(true))
    expect(claimExpandClick(event, d)).toBe(false)
    expect(d.openWorkbench).toHaveBeenCalledTimes(1)
    expect(event.consumed()).toBe(0)
  })
})

// ---- installExpandTakeover ----

/** A minimal listener target recording installs and replaying events. */
function target(): ListenerTarget & { dispatch(event: ClaimEvent): void } {
  const listeners: Array<(event: ClaimEvent) => void> = []
  return {
    addEventListener(_type: string, listener: (event: ClaimEvent) => void, options: { capture: boolean }): void {
      expect(options.capture).toBe(true)
      listeners.push(listener)
    },
    removeEventListener(_type: string, listener: (event: ClaimEvent) => void, options: { capture: boolean }): void {
      expect(options.capture).toBe(true)
      const at = listeners.indexOf(listener)
      if (at >= 0) listeners.splice(at, 1)
    },
    dispatch(event: ClaimEvent): void {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

describe('installExpandTakeover', () => {
  it('claims real dispatched clicks and stops after disposal', () => {
    const t = target()
    const d = deps(true)
    const stop = installExpandTakeover(d, t)
    const claimed = clickOn(element(true))
    t.dispatch(claimed)
    expect(d.openWorkbench).toHaveBeenCalledTimes(1)
    expect(claimed.consumed()).toBe(2)
    stop()
    const after = clickOn(element(true))
    t.dispatch(after)
    expect(d.openWorkbench).toHaveBeenCalledTimes(1)
    expect(after.consumed()).toBe(0)
  })

  it('installs nothing without a target (SSR fail-soft)', () => {
    const d = deps(true)
    expect(() => installExpandTakeover(d, undefined)).not.toThrow()
  })
})
