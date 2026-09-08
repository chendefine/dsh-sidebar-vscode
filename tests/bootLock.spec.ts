/**
 * Unit tests for the cross-tab workbench boot lock
 * (src/client/bootLock.ts): the Web Lock that serializes the first
 * moments of a VS Code web boot across same-origin DSH tabs (two frames
 * racing to CREATE the vscode-web-db IndexedDB deadlock for minutes).
 * Every lock transport and timer is injected.
 *
 * @module dsh-sidebar-vscode/tests/bootLock.spec
 */

import { describe, expect, it, vi } from 'vitest'
import {
  BOOT_LOCK_GRACE_MS,
  BOOT_LOCK_HOLD_CAP_MS,
  BOOT_LOCK_WAIT_CAP_MS,
  WorkbenchBootLock,
  type BootLockDeps,
} from '../src/client/bootLock.ts'

/** One controllable dependency bundle around a fake clock + timers. */
interface Harness {
  lock: WorkbenchBootLock
  /** Resolve the pending acquisition with a release function (or null). */
  grant(release?: (() => void) | null): void
  /** Reject the pending acquisition. */
  refuse(): void
  rendered: ReturnType<typeof vi.fn>
  /** Advance the fake clock, firing due timers in schedule order. */
  advance(ms: number): void
  /** Settle async bodies (acquisition .then chains). */
  flush(): Promise<void>
  /** The snapshot sequence the subscriber observed. */
  seen: Array<{ key: string, state: string }>
}

/** Build one lock with fakes and a manual clock. */
function makeHarness(): Harness {
  const timers: Array<{ at: number, cb: () => void }> = []
  const state = { clock: 0 }
  let grantPending: ((release: (() => void) | null) => void) | null = null
  let rejectPending: ((reason?: unknown) => void) | null = null
  const rendered = vi.fn(() => false)
  const seen: Array<{ key: string, state: string }> = []
  const acquire = vi.fn(() => new Promise<(() => void) | null>((resolve, reject) => {
    grantPending = resolve
    rejectPending = reject
  }))
  const deps: BootLockDeps = {
    acquire,
    rendered,
    schedule: (callback, ms) => { timers.push({ at: state.clock + ms, cb: callback }) },
    now: () => state.clock,
  }
  const lock = new WorkbenchBootLock(deps)
  lock.subscribe(() => { seen.push({ ...lock.getSnapshot() }) })
  const fireDue = (target: number): void => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const due = timers.findIndex(timer => timer.at <= target)
      if (due < 0) break
      const timer = timers.splice(due, 1)[0]!
      // Fire at the timer's LOGICAL moment so a callback rescheduling
      // itself stamps from there, not from the (already advanced) wall.
      state.clock = timer.at
      timer.cb()
    }
  }
  return {
    lock,
    grant(release = null) {
      const resolve = grantPending
      grantPending = null
      rejectPending = null
      resolve?.(release)
    },
    refuse() {
      const reject = rejectPending
      grantPending = null
      rejectPending = null
      reject?.(new Error('acquisition refused'))
    },
    rendered,
    advance(ms) { const target = state.clock + ms; fireDue(target); state.clock = target },
    async flush() { await new Promise(resolve => { setTimeout(resolve, 0) }) },
    seen,
  }
}

describe('WorkbenchBootLock', () => {
  it('waits, then reports held once the lock is granted', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    expect(h.lock.getSnapshot()).toEqual({ key: 'key-1', state: 'waiting' })
    const release = vi.fn()
    h.grant(release)
    await h.flush()
    expect(h.lock.getSnapshot()).toEqual({ key: 'key-1', state: 'held' })
    expect(release).not.toHaveBeenCalled()
  })

  it('flips to queued past the grace while another tab holds the lock', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    h.advance(BOOT_LOCK_GRACE_MS)
    expect(h.lock.getSnapshot()).toEqual({ key: 'key-1', state: 'queued' })
    h.grant(null)
    await h.flush()
    expect(h.lock.getSnapshot().state).toBe('held')
  })

  it('releases as soon as the workbench reports rendered (snapshot stays held)', async () => {
    const h = makeHarness()
    h.rendered.mockReturnValue(true)
    h.lock.begin('key-1')
    const release = vi.fn()
    h.grant(release)
    await h.flush()
    // The render watch samples synchronously on hold: rendered already.
    expect(release).toHaveBeenCalledTimes(1)
    expect(h.lock.getSnapshot()).toEqual({ key: 'key-1', state: 'held' })
  })

  it('keeps holding while the frame stays unrendered, then releases at the hold cap', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    const release = vi.fn()
    h.grant(release)
    await h.flush()
    expect(release).not.toHaveBeenCalled()
    h.advance(BOOT_LOCK_HOLD_CAP_MS - 1)
    expect(release).not.toHaveBeenCalled()
    h.advance(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(h.lock.getSnapshot().state).toBe('held')
  })

  it('fails open when the Web Locks API is unavailable (null release)', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    h.grant(null)
    await h.flush()
    expect(h.lock.getSnapshot().state).toBe('held')
  })

  it('fails open when the acquisition rejects', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    h.refuse()
    await h.flush()
    expect(h.lock.getSnapshot().state).toBe('held')
  })

  it('proceeds unlocked at the wait cap and drops the late grant', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    h.advance(BOOT_LOCK_WAIT_CAP_MS)
    await h.flush()
    // Unlocked but held as far as the frame gating is concerned.
    expect(h.lock.getSnapshot().state).toBe('held')
    const lateRelease = vi.fn()
    h.grant(lateRelease)
    await h.flush()
    expect(lateRelease).toHaveBeenCalledTimes(1)
    expect(h.lock.getSnapshot().state).toBe('held')
  })

  it('end() during waiting drops the eventual grant', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    h.lock.end()
    const release = vi.fn()
    h.grant(release)
    await h.flush()
    expect(release).toHaveBeenCalledTimes(1)
    expect(h.lock.getSnapshot().state).toBe('waiting')
  })

  it('end() releases the held lock; begin() starts a fresh cycle', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    const release = vi.fn()
    h.grant(release)
    await h.flush()
    expect(release).not.toHaveBeenCalled()
    h.lock.end()
    expect(release).toHaveBeenCalledTimes(1)
    h.lock.begin('key-2')
    expect(h.lock.getSnapshot()).toEqual({ key: 'key-2', state: 'waiting' })
  })

  it('dispose() releases and ignores every later driver call', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    const release = vi.fn()
    h.grant(release)
    await h.flush()
    h.lock.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    h.lock.begin('key-2')
    expect(h.lock.getSnapshot()).toEqual({ key: 'key-1', state: 'held' })
  })

  it('notifies subscribers on every transition', async () => {
    const h = makeHarness()
    h.lock.begin('key-1')
    h.advance(BOOT_LOCK_GRACE_MS)
    h.grant(null)
    await h.flush()
    expect(h.seen).toEqual([
      { key: 'key-1', state: 'waiting' },
      { key: 'key-1', state: 'queued' },
      { key: 'key-1', state: 'held' },
    ])
  })
})
