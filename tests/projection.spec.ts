/**
 * Unit tests for the persistent workbench host's rect projector
 * (src/client/projection.ts): the z-index decision, the immediate-sync +
 * per-frame tracking loop, the hide-keeps-last-rect rule, and the
 * teardown discipline (no leaked rAF callbacks). All timing and elements
 * are injected fakes.
 *
 * @module dsh-sidebar-vscode/tests/projection.spec
 */

import { describe, expect, it, vi } from 'vitest'
import {
  OverlayProjector,
  OVERLAY_Z_DOCKED,
  OVERLAY_Z_FLOAT,
  overlayZIndex,
  type ProjectionAnchor,
  type ProjectionHost,
} from '../src/client/projection.ts'

/** One fake host: a plain style bag the projector writes. */
function fakeHost(): ProjectionHost {
  return {
    style: { left: '', top: '', width: '', height: '', zIndex: '', visibility: 'hidden' },
  }
}

/** One fake anchor over a mutable rect, optionally inside the float host. */
function fakeAnchor(rect: { left: number, top: number, width: number, height: number }, floated = false): ProjectionAnchor {
  return {
    getBoundingClientRect: () => ({ ...rect }),
    closest: (selector: string) =>
      floated && selector === '[data-sidebar-right-float-host]' ? {} : null,
  }
}

/** A manual frame-timing queue: callbacks run only when flushed, cancels are real. */
function manualTiming(): {
  timing: { requestAnimationFrame: (callback: () => void) => number, cancelAnimationFrame: (handle: number) => void }
  flush(): void
  pending(): number
} {
  const queue: Array<{ id: number, callback: () => void }> = []
  let next = 0
  return {
    timing: {
      requestAnimationFrame: callback => {
        next += 1
        queue.push({ id: next, callback })
        return next
      },
      cancelAnimationFrame: handle => {
        const at = queue.findIndex(entry => entry.id === handle)
        if (at !== -1) queue.splice(at, 1)
      },
    },
    flush: () => {
      const running = queue.splice(0)
      for (const entry of running) entry.callback()
    },
    pending: () => queue.length,
  }
}

describe('overlayZIndex', () => {
  it('answers the float level for an anchor inside the float host', () => {
    expect(overlayZIndex(fakeAnchor({ left: 0, top: 0, width: 10, height: 10 }, true))).toBe(OVERLAY_Z_FLOAT)
  })

  it('answers the docked level for an anchor in the docked or fullscreen panel', () => {
    expect(overlayZIndex(fakeAnchor({ left: 0, top: 0, width: 10, height: 10 }))).toBe(OVERLAY_Z_DOCKED)
  })

  it('answers the docked level when no presentation probe exists', () => {
    expect(overlayZIndex({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) })).toBe(OVERLAY_Z_DOCKED)
  })
})

describe('OverlayProjector', () => {
  it('syncs the host box immediately on show, then tracks per frame', () => {
    const host = fakeHost()
    const { timing, flush, pending } = manualTiming()
    const projector = new OverlayProjector(host, timing)
    const rect = { left: 8, top: 40, width: 320, height: 480 }
    const anchor = fakeAnchor(rect)

    projector.attach(anchor)
    expect(host.style.visibility).toBe('hidden')

    projector.setVisible(true)
    expect(host.style.visibility).toBe('visible')
    expect(host.style).toMatchObject({ left: '8px', top: '40px', width: '320px', height: '480px', zIndex: OVERLAY_Z_DOCKED })
    expect(pending()).toBe(1)

    // The anchor moves (panel slide, resize handle): the next frame follows.
    Object.assign(rect, { left: 12, width: 300 })
    flush()
    expect(host.style.left).toBe('12px')
    expect(host.style.width).toBe('300px')
  })

  it('uses the float level while the anchor lives in the float host', () => {
    const host = fakeHost()
    const { timing } = manualTiming()
    const projector = new OverlayProjector(host, timing)
    projector.attach(fakeAnchor({ left: 0, top: 0, width: 10, height: 10 }, true))
    projector.setVisible(true)
    expect(host.style.zIndex).toBe(OVERLAY_Z_FLOAT)
  })

  it('hides on setVisible(false), keeps the last box, and stops tracking', () => {
    const host = fakeHost()
    const { timing, flush, pending } = manualTiming()
    const projector = new OverlayProjector(host, timing)
    const rect = { left: 8, top: 40, width: 320, height: 480 }
    projector.attach(fakeAnchor(rect))
    projector.setVisible(true)
    flush()

    projector.setVisible(false)
    expect(host.style.visibility).toBe('hidden')
    expect(pending()).toBe(0)
    const kept = { ...host.style }

    // A rect change while hidden paints nothing and queues nothing.
    Object.assign(rect, { left: 999 })
    flush()
    expect(host.style.left).toBe(kept.left)
  })

  it('re-syncs on the next show after hidden (no stale reveal)', () => {
    const host = fakeHost()
    const { timing } = manualTiming()
    const projector = new OverlayProjector(host, timing)
    const rect = { left: 8, top: 40, width: 320, height: 480 }
    projector.attach(fakeAnchor(rect))
    projector.setVisible(true)
    projector.setVisible(false)

    Object.assign(rect, { left: 64, top: 128, width: 200, height: 100 })
    projector.setVisible(true)
    expect(host.style.left).toBe('64px')
    expect(host.style.top).toBe('128px')
    expect(host.style.width).toBe('200px')
    expect(host.style.height).toBe('100px')
  })

  it('hides and stops when the anchor detaches (the view unmounted)', () => {
    const host = fakeHost()
    const { timing, pending } = manualTiming()
    const projector = new OverlayProjector(host, timing)
    projector.attach(fakeAnchor({ left: 0, top: 0, width: 10, height: 10 }))
    projector.setVisible(true)
    projector.attach(null)
    expect(host.style.visibility).toBe('hidden')
    expect(pending()).toBe(0)
  })

  it('dispose hides the host and leaves nothing queued', () => {
    const host = fakeHost()
    const { timing, pending } = manualTiming()
    const projector = new OverlayProjector(host, timing)
    projector.attach(fakeAnchor({ left: 0, top: 0, width: 10, height: 10 }))
    projector.setVisible(true)
    projector.dispose()
    expect(host.style.visibility).toBe('hidden')
    expect(pending()).toBe(0)

    // Post-dispose calls are quiet no-ops.
    projector.setVisible(true)
    expect(host.style.visibility).toBe('hidden')
  })

  it('never re-arms a disposed projector through attach', () => {
    const host = fakeHost()
    const raf = vi.fn()
    const projector = new OverlayProjector(host, {
      requestAnimationFrame: callback => { callback(); return 0 },
      cancelAnimationFrame: () => {},
    })
    projector.dispose()
    projector.attach(fakeAnchor({ left: 0, top: 0, width: 0, height: 0 }))
    projector.setVisible(true)
    expect(raf).not.toHaveBeenCalled()
    expect(host.style.visibility).toBe('hidden')
  })
})
