/**
 * Unit tests for the navigation consumer (src/client/openRequests.ts):
 * the one-shot execution discipline for the `openTab('vscode', { params })`
 * navigations the takeover wrapper mints — revision-0 standing down, the
 * page-level executed watermark (remount must not replay, the mount-batch
 * click must run), gate deferral, and malformed params consumption.
 *
 * The page-level watermark is MODULE state shared by every consumer of
 * the page (that is its point), so every test mints its own tab identity
 * and resets the table first.
 *
 * @module dsh-sidebar-vscode/tests/openRequests.spec
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  nextNonce,
  OpenRequestConsumer,
  readNavigationOpen,
  resetExecutedWatermark,
  type NavigationStamp,
  type OpenRequest,
} from '../src/client/openRequests.ts'

/** Flush the fire-and-forget execution promise. */
const flush = async (): Promise<void> => { await new Promise(r => { setTimeout(r, 0) }) }

/** One navigation literal. */
function navigation(revision: number, params: unknown = { path: '/w/a.ts' }): NavigationStamp {
  return { revision, params }
}

describe('readNavigationOpen', () => {
  it('reads a well-formed params object', () => {
    expect(readNavigationOpen({ path: '/w/a.ts', line: 4, column: 2 }))
      .toEqual({ path: '/w/a.ts', line: 4, column: 2 })
  })

  it('drops junk line/column and refuses non-object or path-less shapes', () => {
    expect(readNavigationOpen({ path: '/w/a.ts', line: -1 })).toEqual({ path: '/w/a.ts' })
    expect(readNavigationOpen({ path: '/w/a.ts', line: 1.5 })).toEqual({ path: '/w/a.ts', line: 1 })
    expect(readNavigationOpen(null)).toBeNull()
    expect(readNavigationOpen('x')).toBeNull()
    expect(readNavigationOpen({})).toBeNull()
    expect(readNavigationOpen({ line: 3 })).toBeNull()
  })
})

describe('nextNonce', () => {
  it('is strictly monotonic within the same millisecond', () => {
    const frozen = () => 1000
    expect(nextNonce(frozen)).toBe(1000)
    expect(nextNonce(frozen)).toBe(1001)
  })
})

describe('OpenRequestConsumer', () => {
  beforeEach(() => {
    resetExecutedWatermark()
  })

  it('executes a fresh navigation exactly once', async () => {
    const execute = vi.fn(async (_request: OpenRequest) => {})
    const consumer = new OpenRequestConsumer({ execute, gateSettled: () => true })
    consumer.update(navigation(1), 's1', 't1')
    consumer.update(navigation(1), 's1', 't1')
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]![0]).toMatchObject({ path: '/w/a.ts' })
    expect(typeof execute.mock.calls[0]![0].nonce).toBe('number')
  })

  it('stands down on revision 0 (a seeded or undo-restored record)', () => {
    const execute = vi.fn(async (_request: OpenRequest) => {})
    const consumer = new OpenRequestConsumer({ execute, gateSettled: () => true })
    consumer.update(navigation(0), 's1', 't1')
    consumer.update(undefined, 's1', 't1')
    expect(execute).not.toHaveBeenCalled()
  })

  it('defers while the boot gate is unsettled, then executes once', async () => {
    const execute = vi.fn(async (_request: OpenRequest) => {})
    let settled = false
    const consumer = new OpenRequestConsumer({ execute, gateSettled: () => settled })
    consumer.update(navigation(1), 's1', 't1')
    expect(execute).not.toHaveBeenCalled()
    settled = true
    consumer.update(navigation(1), 's1', 't1')
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('skips a navigation this page already executed on remount (the watermark)', async () => {
    const first = vi.fn(async (_request: OpenRequest) => {})
    const consumerA = new OpenRequestConsumer({ execute: first, gateSettled: () => true })
    consumerA.update(navigation(2), 's1', 't1')
    await flush()
    expect(first).toHaveBeenCalledTimes(1)

    // A remount (tab switch back): the same navigation must not replay.
    const second = vi.fn(async (_request: OpenRequest) => {})
    const consumerB = new OpenRequestConsumer({ execute: second, gateSettled: () => true })
    consumerB.update(navigation(2), 's1', 't1')
    await flush()
    expect(second).not.toHaveBeenCalled()
  })

  it('executes a navigation that arrived while the body was unmounted', async () => {
    const first = vi.fn(async (_request: OpenRequest) => {})
    const consumerA = new OpenRequestConsumer({ execute: first, gateSettled: () => true })
    consumerA.update(navigation(1), 's1', 't1')
    await flush()
    expect(first).toHaveBeenCalledTimes(1)

    // The body unmounts; another chat click navigates again (revision 2).
    const second = vi.fn(async (_request: OpenRequest) => {})
    const consumerB = new OpenRequestConsumer({ execute: second, gateSettled: () => true })
    consumerB.update(navigation(2), 's1', 't1')
    await flush()
    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0]![0].path).toBe('/w/a.ts')
  })

  it('consumes a malformed params navigation as seen, without executing', async () => {
    const execute = vi.fn(async (_request: OpenRequest) => {})
    const consumer = new OpenRequestConsumer({ execute, gateSettled: () => true })
    consumer.update(navigation(3, { nope: true }), 's1', 't1')
    await flush()
    expect(execute).not.toHaveBeenCalled()
    // A malformed navigation must not block a later well-formed one.
    consumer.update(navigation(4, { path: '/w/b.ts' }), 's1', 't1')
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps watermarks per session+tab identity', async () => {
    const execute = vi.fn(async (_request: OpenRequest) => {})
    const consumerA = new OpenRequestConsumer({ execute, gateSettled: () => true })
    consumerA.update(navigation(1), 's1', 't1')
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
    // The same revision under ANOTHER session's tab is that tab's own
    // mount-batch click (a different body, a fresh consumer instance).
    const consumerB = new OpenRequestConsumer({ execute, gateSettled: () => true })
    consumerB.update(navigation(1), 's2', 't9')
    await flush()
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
