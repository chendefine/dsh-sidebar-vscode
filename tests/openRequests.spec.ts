/**
 * Unit tests for the open-request consumer (src/client/openRequests.ts):
 * the one-shot execution discipline for the openRequest stamps the
 * takeover seams write onto the VSCode tab's persisted meta — page-load
 * floors, instance baselines, the page-level executed watermark, gate
 * deferral, and session addressing.
 *
 * The page-level executed watermark is MODULE state shared by every
 * consumer of the page (that is its point: a tab close/reopen remount must
 * not replay), so every test mints its own nonce range to stay isolated.
 *
 * @module dsh-sidebar-vscode/tests/openRequests.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { OpenRequestConsumer, pageLoadedAt } from '../src/client/openRequests.ts'
import type { OpenRequest } from '../src/client/openIntercept.ts'

/** One consumer over fakes. */
function makeConsumer(options: {
  floor?: number
  settled?: boolean
} = {}) {
  const retire = vi.fn()
  const execute = vi.fn(async () => {})
  const consumer = new OpenRequestConsumer({
    retire,
    execute,
    gateSettled: () => options.settled ?? true,
    pageLoadedAt: () => options.floor ?? pageLoadedAt(),
  })
  return { consumer, retire, execute }
}

/** One request literal. */
function request(nonce: number, path = '/w/a.ts', sessionId?: string): OpenRequest {
  return { nonce, path, ...(sessionId !== undefined ? { sessionId } : {}) }
}

/** Flush the fire-and-forget execution promise. */
const flush = async (): Promise<void> => { await new Promise(r => { setTimeout(r, 0) }) }

describe('OpenRequestConsumer', () => {
  it('skips and retires a request that predates the page load', () => {
    const h = makeConsumer({ floor: 1000 })
    h.consumer.update(request(500), 's1')
    expect(h.retire).toHaveBeenCalledTimes(1)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('skips and retires a persisted request when none is visible at mount', () => {
    const h = makeConsumer({ floor: 1000 })
    h.consumer.update(null, 's1')
    expect(h.retire).toHaveBeenCalledTimes(1)
  })

  it('executes a same-page request exactly once and retires it', async () => {
    const h = makeConsumer({ floor: 1000 })
    h.consumer.update(request(1500, '/w/a.ts', 's1'), 's1')
    h.consumer.update(request(1500, '/w/a.ts', 's1'), 's1')
    await flush()
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.execute).toHaveBeenCalledWith(request(1500, '/w/a.ts', 's1'))
    // The second feed of the same nonce is the spent branch: retired on
    // sight (exactly the historical effect's behavior when its deps
    // re-run with the same request).
    expect(h.retire).toHaveBeenCalledTimes(2)
  })

  it('declines (after retiring) a request addressed to another session', async () => {
    const h = makeConsumer({ floor: 1000 })
    h.consumer.update(request(2500, '/w/a.ts', 'other'), 's1')
    await flush()
    expect(h.retire).toHaveBeenCalledTimes(1)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('treats an unstamped request as a wildcard (the settings takeover)', async () => {
    const h = makeConsumer({ floor: 1000 })
    h.consumer.update(request(3500), 's1')
    await flush()
    expect(h.execute).toHaveBeenCalledTimes(1)
  })

  it('defers while the boot gate is unsettled, then executes once it settles', async () => {
    const h = makeConsumer({ floor: 1000, settled: false })
    h.consumer.update(request(4500, '/w/a.ts', 's1'), 's1')
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.retire).not.toHaveBeenCalled()
    // The caller re-feeds the same request when the gate settles.
    const h2 = makeConsumer({ floor: 1000, settled: true })
    h2.consumer.update(request(4500, '/w/a.ts', 's1'), 's1')
    await flush()
    expect(h2.execute).toHaveBeenCalledTimes(1)
  })

  it('a spent nonce is retired on sight, never re-executed', () => {
    const h = makeConsumer({ floor: 1000 })
    h.consumer.update(request(5500, '/w/a.ts', 's1'), 's1')
    h.consumer.update(request(5400, '/w/b.ts', 's1'), 's1')
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.retire).toHaveBeenCalledTimes(2)
  })

  it('a fresh instance inherits the page watermark (a remount never replays)', async () => {
    const first = makeConsumer({ floor: 1000 })
    first.consumer.update(request(6500, '/w/a.ts', 's1'), 's1')
    await flush()
    expect(first.execute).toHaveBeenCalledTimes(1)
    // The tab closed and reopened: a NEW consumer, the SAME persisted
    // request — the page-level watermark holds it back.
    const second = makeConsumer({ floor: 1000 })
    second.consumer.update(request(6500, '/w/a.ts', 's1'), 's1')
    expect(second.execute).not.toHaveBeenCalled()
    expect(second.retire).toHaveBeenCalledTimes(1)
  })
})
