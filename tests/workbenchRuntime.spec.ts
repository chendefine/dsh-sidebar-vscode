/**
 * Unit tests for the persistent workbench runtime
 * (src/client/workbenchRuntime.ts): the keeper that lets the embedded VS
 * Code iframe survive right-Sidebar tab switches by never leaving the
 * DOM. Every spec drives the state machine through the injected seams
 * (fake DOM, fake channel, granted lock) and asserts the survival and
 * leak rules:
 *
 * - the frame is created lazily (inputs resolved + an audience), behind
 *   the lock → gate → src ordering;
 * - `release()` (the view's unmount) hides the projection but keeps the
 *   frame and its src UNCHANGED — the tab-switch survival itself;
 * - a re-attach reuses the very same element (no reload);
 * - a basis change (workspace flip) reloads in place via src
 *   reassignment;
 * - a transient base re-resolution never reloads the live frame;
 * - the LAST adopter's signal abort (tab record removal) destroys the
 *   workbench: host removed, styles disposed, element dropped;
 * - the plugin-level destroy tears everything down unconditionally.
 *
 * @module dsh-sidebar-vscode/tests/workbenchRuntime.spec
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  destroyWorkbenchRuntime,
  installWorkbenchRuntimeForTest,
  type RuntimeDom,
  type RuntimeElement,
  type WorkbenchHandle,
  type WorkbenchRuntimeDeps,
} from '../src/client/workbenchRuntime.ts'
import { buildVscodeUrl } from '../src/client/paths.ts'

// The focus fence installs parent-document listeners (browser-bound); a
// bare listener sink stands in for the document in the node environment.
const documentStub = {
  addEventListener(): void {},
  removeEventListener(): void {},
}

beforeAll(() => {
  vi.stubGlobal('document', documentStub)
})

/** The fake element: style bag, listener sets, src assignment log. */
class FakeElement {
  readonly style: Record<string, string> = {
    left: '', top: '', width: '', height: '', zIndex: '', visibility: '', opacity: '', pointerEvents: '',
  }
  className = ''
  title = ''
  readonly children: FakeElement[] = []
  readonly listeners = new Map<string, Set<() => void>>()
  readonly srcLog: string[] = []
  removed = false

  constructor(readonly tag: string) {}

  private currentSrc = ''
  get src(): string { return this.currentSrc }
  set src(value: string) {
    this.currentSrc = value
    this.srcLog.push(value)
  }

  appendChild(child: FakeElement): void {
    this.children.push(child)
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  remove(): void {
    this.removed = true
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

/** One adoptable controller signal (the tab record's lifetime). */
class FakeSignal {
  private readonly handlers = new Set<() => void>()
  aborted = false
  addEventListener(_type: 'abort', listener: () => void): void {
    this.handlers.add(listener)
  }
  removeEventListener(_type: 'abort', listener: () => void): void {
    this.handlers.delete(listener)
  }
  abort(): void {
    if (this.aborted) return
    this.aborted = true
    for (const handler of this.handlers) handler()
  }
}

/** The fake anchor the projection would follow, at a distinguishing left offset. */
function anchorAt(left: number): { getBoundingClientRect(): { left: number, top: number, width: number, height: number } } {
  return { getBoundingClientRect: () => ({ left, top: 0, width: 100, height: 100 }) }
}

/** The fake anchor the projection would follow (rect content is irrelevant here). */
function fakeAnchor(): { getBoundingClientRect(): { left: number, top: number, width: number, height: number } } {
  return anchorAt(0)
}

/** One fully-injected runtime harness. */
interface Harness {
  readonly handle: WorkbenchHandle
  readonly elements: FakeElement[]
  readonly body: { appendChild: (child: FakeElement) => void }
  readonly channel: {
    beginBoot: ReturnType<typeof vi.fn>
    pollBootStatus: ReturnType<typeof vi.fn>
    probeCapability: ReturnType<typeof vi.fn>
    sendOpenCommand: ReturnType<typeof vi.fn>
  }
  readonly disposeStyles: ReturnType<typeof vi.fn>
  readonly acquireLock: ReturnType<typeof vi.fn>
  /** The frame the runtime created (after it exists). */
  frame(): FakeElement | null
  /** The host div the runtime created (always, at index 0). */
  host(): FakeElement
}

function setup(): Harness {
  const elements: FakeElement[] = []
  const body = { appendChild: vi.fn() }
  const dom: RuntimeDom = {
    createElement: (tag: string) => {
      const element = new FakeElement(tag)
      elements.push(element)
      return element as unknown as RuntimeElement
    },
    body,
  }
  const disposeStyles = vi.fn()
  const channel = {
    beginBoot: vi.fn(async () => ({ began: true, editors: null })),
    pollBootStatus: vi.fn(async () => false),
    probeCapability: vi.fn(async () => false),
    sendOpenCommand: vi.fn(async () => false),
  }
  const release = vi.fn()
  const acquireLock = vi.fn(async () => release)
  const deps: WorkbenchRuntimeDeps = {
    dom,
    adoptStyles: () => disposeStyles,
    schedule: () => {},
    now: () => 0,
    timing: { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} },
    channel: channel as unknown as WorkbenchRuntimeDeps['channel'],
    acquireLock,
  }
  const handle = installWorkbenchRuntimeForTest(deps)
  return {
    handle,
    elements,
    body,
    channel,
    disposeStyles,
    acquireLock,
    host: () => elements[0] as FakeElement,
    frame: () => (elements.length > 1 ? elements[1] as FakeElement : null),
  }
}

/** Attach one view and feed it resolved inputs; returns the expected target URL. */
function bootFor(harness: Harness, id: string, signal: FakeSignal, cwd: string, visible = true): string {
  harness.handle.attach(id, signal as unknown as AbortSignal, fakeAnchor(), visible)
  harness.handle.update({ serverUrl: '/sidebar/vscode/', pathMap: [], cwd })
  return buildVscodeUrl('/sidebar/vscode/', cwd)
}

afterEach(() => {
  destroyWorkbenchRuntime()
})

describe('WorkbenchRuntime', () => {
  it('creates the persistent host eagerly and the frame lazily behind an audience', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    harness.handle.attach('s1:t1', signal as unknown as AbortSignal, fakeAnchor(), false)
    harness.handle.update({ serverUrl: '/sidebar/vscode/', pathMap: [], cwd: '/work' })

    // The host exists (body child); the frame does not (never visible).
    expect(harness.body.appendChild).toHaveBeenCalledTimes(1)
    expect(harness.elements).toHaveLength(1)
    expect(harness.handle.element).toBeNull()

    // The audience arrives: lock granted → gate parked → src applied.
    harness.handle.setVisible(true)
    await vi.waitFor(() => {
      const frame = harness.frame()
      expect(frame).not.toBeNull()
      expect(frame?.src).toBe(buildVscodeUrl('/sidebar/vscode/', '/work'))
      expect(harness.host().children).toContain(frame)
    })
  })

  it('applies the lock → gate → src ordering the React effects used to give', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    const target = bootFor(harness, 's1:t1', signal, '/work')

    // The nonce parks (gate) before the frame's src lands.
    await vi.waitFor(() => expect(harness.channel.beginBoot).toHaveBeenCalled())
    expect(harness.channel.beginBoot.mock.calls[0]?.[0]).toBe('/work')
    await vi.waitFor(() => {
      expect(harness.frame()).not.toBeNull()
      expect(harness.frame()?.src).toBe(target)
    })
    expect(harness.acquireLock).toHaveBeenCalled()
  })

  it('wires the per-load chain: load event → loaded + bridge + gate + fence', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    bootFor(harness, 's1:t1', signal, '/work')
    const frame = await vi.waitFor(() => {
      const created = harness.frame()
      expect(created).not.toBeNull()
      return created as FakeElement
    })

    expect(harness.handle.getSnapshot().loaded).toBe(false)
    frame.fire('load')
    expect(harness.handle.getSnapshot().loaded).toBe(true)
    expect(harness.handle.getSnapshot().frameAlive).toBe(true)
    // The gate's reveal watch and the lock's render watch were asked to
    // schedule (their cadence); the load itself is what drove the wiring.
    frame.fire('load')
    expect(harness.handle.getSnapshot().loaded).toBe(true)
  })

  it('SURVIVES a view release: hidden projection, frame and src untouched', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    bootFor(harness, 's1:t1', signal, '/work')
    const frame = await vi.waitFor(() => {
      const created = harness.frame()
      expect(created).not.toBeNull()
      return created as FakeElement
    })
    frame.fire('load')

    // The tab switch: body unmounts, projection releases.
    harness.handle.release('s1:t1')
    expect(harness.host().style.visibility).toBe('hidden')
    expect(harness.handle.element).not.toBeNull()
    expect(frame.srcLog).toHaveLength(1)
    expect(frame.removed).toBe(false)
    expect(harness.disposeStyles).not.toHaveBeenCalled()
  })

  it('re-attaches onto the SAME element with no reload (the switch-back)', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    bootFor(harness, 's1:t1', signal, '/work')
    const frame = await vi.waitFor(() => {
      const created = harness.frame()
      expect(created).not.toBeNull()
      return created as FakeElement
    })
    frame.fire('load')

    harness.handle.release('s1:t1')
    harness.handle.attach('s1:t1', signal as unknown as AbortSignal, fakeAnchor(), true)

    expect(harness.handle.element).toBe(frame as unknown)
    expect(frame.srcLog).toHaveLength(1)
    expect(harness.host().style.visibility).toBe('visible')
    expect(harness.handle.getSnapshot().loaded).toBe(true)
  })

  it('reloads in place when the basis changes (another workspace)', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    bootFor(harness, 's1:t1', signal, '/work')
    const frame = await vi.waitFor(() => {
      const created = harness.frame()
      expect(created).not.toBeNull()
      return created as FakeElement
    })
    frame.fire('load')

    harness.handle.update({ serverUrl: '/sidebar/vscode/', pathMap: [], cwd: '/other' })
    // The re-keyed load walks lock-grant → gate-park before its src
    // lands (microtasks); the reassignment itself is what is asserted.
    await vi.waitFor(() => { expect(frame.srcLog.at(-1)).toBe(buildVscodeUrl('/sidebar/vscode/', '/other')) })
    expect(harness.handle.getSnapshot().loaded).toBe(false)

    frame.fire('load')
    expect(harness.handle.getSnapshot().loaded).toBe(true)
    // One element, two loads — no unmount ever happened.
    expect(harness.elements).toHaveLength(2)
  })

  it('holds the live frame through a transient base re-resolution', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    bootFor(harness, 's1:t1', signal, '/work')
    const frame = await vi.waitFor(() => {
      const created = harness.frame()
      expect(created).not.toBeNull()
      return created as FakeElement
    })
    frame.fire('load')

    harness.handle.update({ serverUrl: undefined, pathMap: [], cwd: '/work' })
    expect(frame.srcLog).toHaveLength(1)
    expect(harness.handle.getSnapshot().loaded).toBe(true)
  })

  it('boots when the base RESOLVES after a resolving feed (the live first-open sequence)', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    // What the real view does on its very first open: attach while the
    // base is still resolving (serverUrl undefined), then feed the
    // RESOLVED mount base moments later. The resolution must reach the
    // reconciler — the frame has to come up.
    harness.handle.attach('s1:t1', signal as unknown as AbortSignal, fakeAnchor(), true)
    harness.handle.update({ serverUrl: undefined, pathMap: [], cwd: '/work' })
    expect(harness.handle.getSnapshot().frameAlive).toBe(false)

    harness.handle.update({ serverUrl: '/sidebar/vscode/', pathMap: [], cwd: '/work' })
    await vi.waitFor(() => {
      expect(harness.frame()).not.toBeNull()
      expect(harness.frame()?.src).toBe(buildVscodeUrl('/sidebar/vscode/', '/work'))
    })
  })

  it('reassigns src (a navigation) on manual reload with the same target', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    const target = bootFor(harness, 's1:t1', signal, '/work')
    const frame = await vi.waitFor(() => {
      const created = harness.frame()
      expect(created).not.toBeNull()
      return created as FakeElement
    })
    frame.fire('load')

    harness.handle.reload()
    await vi.waitFor(() => { expect(frame.srcLog).toHaveLength(2) })
    expect(frame.srcLog.at(-1)).toBe(target)
    expect(harness.handle.getSnapshot().loaded).toBe(false)
  })

  it('destroys the workbench when the LAST adopter aborts, and cleanly', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    bootFor(harness, 's1:t1', signal, '/work')
    const frame = await vi.waitFor(() => {
      const created = harness.frame()
      expect(created).not.toBeNull()
      return created as FakeElement
    })
    frame.fire('load')

    signal.abort()
    expect(harness.host().removed).toBe(true)
    expect(frame.removed).toBe(false) // the frame went down WITH its host
    expect(harness.disposeStyles).toHaveBeenCalled()
    expect(harness.handle.element).toBeNull()
    expect(harness.handle.getSnapshot().frameAlive).toBe(false)
  })

  it('keeps the workbench while another adopter still lives', async () => {
    const harness = setup()
    const first = new FakeSignal()
    const second = new FakeSignal()
    bootFor(harness, 's1:t1', first, '/work')
    await vi.waitFor(() => { expect(harness.frame()).not.toBeNull() })
    harness.handle.attach('s2:t2', second as unknown as AbortSignal, fakeAnchor(), true)

    first.abort()
    expect(harness.host().removed).toBe(false)
    expect(harness.handle.element).not.toBeNull()

    second.abort()
    expect(harness.host().removed).toBe(true)
  })

  it('drops a released projection without treating it as an abort', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    bootFor(harness, 's1:t1', signal, '/work')
    await vi.waitFor(() => { expect(harness.frame()).not.toBeNull() })

    harness.handle.release('s1:t1')
    expect(harness.host().removed).toBe(false)
    expect(harness.handle.getSnapshot().frameAlive).toBe(true)
    expect(harness.handle.getSnapshot().projected).toBeNull()
    expect(harness.host().style.visibility).toBe('hidden')
  })

  it('falls back to the previous pane when the projecting one unmounts', async () => {
    const harness = setup()
    const first = new FakeSignal()
    const second = new FakeSignal()
    // Two panes, one workbench: the first mounts, then the second — the
    // LATEST attach owns the projection (the host box follows its rect).
    harness.handle.attach('s1:t1', first as unknown as AbortSignal, anchorAt(8), true)
    harness.handle.update({ serverUrl: '/sidebar/vscode/', pathMap: [], cwd: '/work' })
    await vi.waitFor(() => { expect(harness.frame()).not.toBeNull() })
    expect(harness.handle.getSnapshot().projected).toBe('s1:t1')
    expect(harness.host().style.left).toBe('8px')

    harness.handle.attach('s2:t2', second as unknown as AbortSignal, anchorAt(64), true)
    expect(harness.handle.getSnapshot().projected).toBe('s2:t2')
    expect(harness.host().style.left).toBe('64px')

    // The second pane's body unmounts: the FIRST pane regains the
    // projection instead of a blank surface.
    harness.handle.release('s2:t2')
    expect(harness.handle.getSnapshot().projected).toBe('s1:t1')
    expect(harness.host().style.left).toBe('8px')
    expect(harness.host().style.visibility).toBe('visible')
  })

  it('re-arms a destroyed runtime transparently on the next adopt', async () => {
    const harness = setup()
    const signal = new FakeSignal()
    bootFor(harness, 's1:t1', signal, '/work')
    await vi.waitFor(() => { expect(harness.frame()).not.toBeNull() })
    destroyWorkbenchRuntime()
    expect(harness.host().removed).toBe(true)

    const fresh = setup()
    const target = bootFor(fresh, 's1:t2', new FakeSignal(), '/work')
    await vi.waitFor(() => expect(fresh.frame()?.src).toBe(target))
  })
})
