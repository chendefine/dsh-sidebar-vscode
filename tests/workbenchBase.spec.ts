/**
 * Unit tests for the workbench iframe-base resolver
 * (src/client/workbenchBase.ts): the proxy.config push / proxy.status
 * ask / reset / direct-fallback / graduation-poll decision table, with
 * injected transport and timers.
 *
 * @module dsh-sidebar-vscode/tests/workbenchBase.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { WorkbenchBaseController, type BaseFetchLike } from '../src/client/workbenchBase.ts'

/** One POST the fake transport served. */
interface ServedPost {
  method: string
  body: Record<string, unknown>
}

/** The fake host's answers, per method. */
interface HostAnswers {
  status?: { ok: boolean, serving: boolean }
  config?: { ok: boolean, reachable: boolean } | 'throw'
}

/** Build a controller over a fake host + manual interval timer. */
function makeHarness(answers: HostAnswers) {
  const served: ServedPost[] = []
  const fetchLike: BaseFetchLike = async (url, init) => {
    const method = url.split('/').pop()!
    served.push({ method, body: JSON.parse(init.body) as Record<string, unknown> })
    if (method === 'proxy.status') {
      const a = answers.status ?? { ok: true, serving: false }
      if (!a.ok) throw new Error('transport down')
      return { ok: true, json: async () => ({ ok: true, value: { serving: a.serving } }) }
    }
    const a = answers.config ?? { ok: true, reachable: true }
    if (a === 'throw') throw new Error('transport down')
    return { ok: true, json: async () => ({ ok: true, value: { reachable: a.reachable } }) }
  }
  const intervals: Array<() => void> = []
  const timers = {
    setInterval: (handler: () => void) => { intervals.push(handler); return intervals.length },
    clearInterval: () => {},
  }
  const emitted: Array<{ state: string, notice?: string }> = []
  const controller = new WorkbenchBaseController(
    (state, notice) => { emitted.push({ state, notice }) },
    fetchLike,
    timers,
  )
  return {
    controller,
    served,
    emitted,
    /** Drive the graduation poll once. */
    tickInterval: () => { for (const handler of [...intervals]) handler() },
    setServing: (serving: boolean): void => {
      answers.status = { ok: true, serving }
    },
  }
}

/** Flush the async bodies. */
const flush = async (): Promise<void> => { await new Promise(r => { setTimeout(r, 0) }) }

describe('WorkbenchBaseController', () => {
  it('a full URL is pushed; a reachable upstream resolves to the mount', async () => {
    const h = makeHarness({ config: { ok: true, reachable: true } })
    h.controller.update('http://127.0.0.1:8000', true)
    expect(h.emitted[0]).toEqual({ state: 'resolving' })
    await flush()
    expect(h.emitted[1]).toEqual({ state: 'mount' })
    expect(h.served).toEqual([{ method: 'proxy.config', body: { url: 'http://127.0.0.1:8000' } }])
  })

  it('an unreachable full URL falls back to direct with a notice and keeps watching', async () => {
    const h = makeHarness({ config: { ok: true, reachable: false } })
    h.controller.update('http://127.0.0.1:8000', true)
    await flush()
    expect(h.emitted).toEqual([
      { state: 'resolving' },
      { state: 'direct', notice: 'proxyFallback' },
    ])
    // The graduation loop: the host starts serving later → mount.
    h.setServing(true)
    h.tickInterval()
    await flush()
    expect(h.emitted[2]).toEqual({ state: 'mount' })
  })

  it('a config transport failure degrades to direct with a notice (never throws)', async () => {
    const h = makeHarness({ config: 'throw' })
    h.controller.update('http://10.0.0.5:8000/vscode', true)
    await flush()
    expect(h.emitted).toEqual([
      { state: 'resolving' },
      { state: 'direct', notice: 'proxyFallback' },
    ])
  })

  it('a relative subpath asks the host status: serving → mount, else direct (no notice)', async () => {
    const h = makeHarness({ status: { ok: true, serving: true } })
    h.controller.update('/vscode', false)
    await flush()
    expect(h.emitted).toEqual([{ state: 'resolving' }, { state: 'mount' }])
    expect(h.served).toEqual([{ method: 'proxy.status', body: {} }])

    const h2 = makeHarness({ status: { ok: true, serving: false } })
    h2.controller.update('/vscode', false)
    await flush()
    expect(h2.emitted).toEqual([{ state: 'resolving' }, { state: 'direct' }])
  })

  it('switching from a pushed URL to a subpath resets the upstream before asking', async () => {
    const h = makeHarness({ config: { ok: true, reachable: true }, status: { ok: true, serving: false } })
    h.controller.update('http://127.0.0.1:8000', true)
    await flush()
    h.controller.update('/vscode', false)
    await flush()
    expect(h.served.map(post => post.method)).toEqual(['proxy.config', 'proxy.config', 'proxy.status'])
    expect(h.served[1]!.body).toEqual({ reset: true })
  })

  it('cancel stops every later signal (no emit after unmount)', async () => {
    const h = makeHarness({ config: { ok: true, reachable: false } })
    h.controller.update('http://127.0.0.1:8000', true)
    await flush()
    h.controller.cancel()
    const before = h.emitted.length
    h.setServing(true)
    h.tickInterval()
    await flush()
    expect(h.emitted.length).toBe(before)
  })
})

describe('useWorkbenchBase wiring sanity', () => {
  it('exports the controller and hook shapes the view consumes', async () => {
    const mod = await import('../src/client/workbenchBase.ts')
    expect(typeof mod.WorkbenchBaseController).toBe('function')
    expect(typeof mod.useWorkbenchBase).toBe('function')
  })
})
