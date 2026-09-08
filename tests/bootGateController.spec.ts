/**
 * Unit tests for the BootGateController (src/client/bootGate.ts): the
 * nonce-handshake state machine that keeps a freshly loading workbench
 * iframe invisible until its editor area is reconciled — with every
 * transport and timer injected, replicating the scenario matrix the
 * VscodeView comments documented (mount load vs in-place reload, rotation
 * mid-flight, unmount fence, receipt match vs the DOM-quiet racer, and
 * the bounded timeout when neither settles).
 *
 * @module dsh-sidebar-vscode/tests/bootGateController.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { BootGateController, type BootGateDeps } from '../src/client/bootGate.ts'

/** One controllable dependency bundle around a fake clock + scheduler. */
interface Harness {
  controller: BootGateController
  workspace: ReturnType<typeof vi.fn>
  beginBoot: ReturnType<typeof vi.fn>
  pollBootStatus: ReturnType<typeof vi.fn>
  domSample: ReturnType<typeof vi.fn>
  domPaths: ReturnType<typeof vi.fn>
  /** The virtual clock the controller's budgets read. */
  clock: { at: number }
  /** Scheduled callbacks (the poll / quiet-watch cadence), FIFO. */
  scheduled: Array<() => void>
  /** Settle async bodies and run whatever they scheduled (repeat a few times). */
  pump(): Promise<void>
}

/** Build one controller with fakes and a manual scheduler. */
function makeHarness(options: { workspace?: string | null } = {}): Harness {
  const scheduled: Array<() => void> = []
  const clock = { at: 1_000 }
  let nonce = 0
  const workspace = vi.fn(() => options.workspace === undefined ? '/w' : options.workspace)
  const beginBoot = vi.fn(async () => ({ began: true, editors: null }))
  const pollBootStatus = vi.fn(async () => false)
  // The realistic same-origin default: the frame is readable but the
  // workbench has not rendered yet ('' — the DOM-quiet racer keeps
  // waiting). Tests that WANT the cross-origin shape mock null.
  const domSample = vi.fn(() => '')
  const domPaths = vi.fn((): string[] | null => null)
  const deps: BootGateDeps = {
    workspace,
    beginBoot,
    pollBootStatus,
    domSample,
    domPaths,
    mintNonce: () => `n${++nonce}`,
    schedule: callback => { scheduled.push(callback) },
    now: () => clock.at,
  }
  const controller = new BootGateController(deps)
  const pump = async (): Promise<void> => {
    for (let round = 0; round < 6; round++) {
      await new Promise(resolve => { setTimeout(resolve, 0) })
      for (let guard = 0; guard < 20 && scheduled.length > 0; guard++) {
        scheduled.shift()!()
        // One microtask flush per consumed callback (its async body may
        // schedule the next tick only after an await).
        await new Promise(resolve => { setTimeout(resolve, 0) })
      }
    }
  }
  return { controller, workspace, beginBoot, pollBootStatus, domSample, domPaths, clock, scheduled, pump }
}

describe('BootGateController', () => {
  it('skips gating (phase off) when no workspace is known', () => {
    const h = makeHarness({ workspace: null })
    h.controller.begin('key-1')
    expect(h.controller.getSnapshot()).toEqual({ key: 'key-1', phase: 'off', nonce: '', workspace: '', ledger: null, revealed: false })
    expect(h.beginBoot).not.toHaveBeenCalled()
  })

  it('parks a boot nonce before the frame may mount (pending → hidden)', async () => {
    const h = makeHarness()
    h.controller.begin('key-1')
    expect(h.controller.getSnapshot().phase).toBe('pending')
    await h.pump()
    expect(h.controller.getSnapshot()).toEqual({ key: 'key-1', phase: 'hidden', nonce: 'n1', workspace: '/w', ledger: null, revealed: false })
    expect(h.beginBoot).toHaveBeenCalledWith('/w', 'n1')
    expect(h.controller.taggableNonce()).toBe('n1')
    expect(h.controller.settled()).toBe(true)
  })

  it('falls back to the DOM-quiet watcher when the park fails (dom)', async () => {
    const h = makeHarness()
    h.beginBoot.mockResolvedValue({ began: false, editors: null })
    h.controller.begin('key-1')
    await h.pump()
    expect(h.controller.getSnapshot().phase).toBe('dom')
    expect(h.controller.taggableNonce()).toBeUndefined()
  })

  it('reveals when the receipt echoes the parked nonce', async () => {
    const h = makeHarness()
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(false)
    h.pollBootStatus.mockResolvedValue(true)
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(true)
  })

  it('reveals on the bounded timeout when the receipt never matches', async () => {
    const h = makeHarness()
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(false)
    // 4.2s crosses the receipt poll's 4s budget while the DOM-quiet racer
    // (an unrendered '' sample) still has its 8s ceiling ahead — the poll
    // budget is what fires here.
    h.clock.at += 4_200
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(true)
  })

  it('reveals via the DOM-quiet racer while the receipt is still pending', async () => {
    const h = makeHarness()
    h.domSample.mockReturnValue('a.ts|b.ts*')
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(false)
    // Rendered and quiet since the load: past minElapsed (800ms) + quiet
    // (1200ms) the racer wins long before the receipt (still false).
    h.clock.at += 3_000
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(true)
    // The receipt was polled the whole time and never matched — the racer
    // is what revealed, not the handshake.
    const polls = await Promise.all(h.pollBootStatus.mock.results.map(result => result.value))
    expect(polls.length).toBeGreaterThan(0)
    expect(polls.every(matched => matched === false)).toBe(true)
  })

  it('reveals a cross-origin hidden-phase frame immediately through the racer', async () => {
    const h = makeHarness()
    h.domSample.mockReturnValue(null)
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    // The racer's first sample (250ms cadence) sees the unreadable frame
    // and reveals ungated — no full receipt budget burned.
    expect(h.controller.getSnapshot().revealed).toBe(true)
  })

  it('reveals a dom-phase boot immediately for a cross-origin frame', async () => {
    const h = makeHarness()
    h.beginBoot.mockResolvedValue({ began: false, editors: null })
    h.domSample.mockReturnValue(null)
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.domSample).toHaveBeenCalled()
    expect(h.controller.getSnapshot().revealed).toBe(true)
  })

  // ── the ledger-aware racer ────────────────────────────────────────────────

  it('keeps the racer hidden while a quiet ghost strip mismatches the boot ledger, reveals once it settles', async () => {
    // THE regression shape: the user closed every file (ledger []), VS
    // Code's own restore replays the closed file (ghost strip), the
    // reconcile's close is still in flight. Quiet alone must NOT reveal.
    const h = makeHarness()
    h.beginBoot.mockResolvedValue({ began: true, editors: [] })
    h.domSample.mockReturnValue('README.md')
    h.domPaths.mockReturnValue(['README.md'])
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(false)
    // Past minElapsed + quiet the OLD racer revealed here — the ledger
    // gate must hold it (strip ['README.md'] ≠ ledger []).
    h.clock.at += 2_100
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(false)
    // The reconcile closes the ghost: the change is sampled first, then
    // the re-armed quiet window elapses and quiet + settled reveals.
    h.domSample.mockReturnValue('(none)')
    h.domPaths.mockReturnValue([])
    await h.pump()
    h.clock.at += 1_300
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(true)
  })

  it('lets the racer through on quiet when the park answered no ledger (first-ever boot)', async () => {
    const h = makeHarness()
    h.beginBoot.mockResolvedValue({ began: true, editors: null })
    h.domSample.mockReturnValue('a.ts|b.ts*')
    h.domPaths.mockReturnValue(['a.ts', 'b.ts'])
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(false)
    h.clock.at += 3_000
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(true)
  })

  it('blocks the expired poll budget behind the ledger gate and reveals at the quiet watcher ceiling', async () => {
    // Receipt never matches, the strip stays mismatched AND unreadable:
    // the poll budget may not flash the ghost, and the quiet watcher's
    // own 8s ceiling is the bound that finally reveals.
    const h = makeHarness()
    h.beginBoot.mockResolvedValue({ began: true, editors: ['/w/keep.ts'] })
    h.domSample.mockReturnValue('keep.ts')
    h.domPaths.mockReturnValue(null)
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(false)
    h.clock.at += 4_200
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(false)
    h.clock.at += 4_300
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(true)
  })

  it('lets a matched receipt reveal even while the ledger comparison still mismatches', async () => {
    // The receipt is authoritative: a basename collision may fool the
    // comparison, never the handshake.
    const h = makeHarness()
    h.beginBoot.mockResolvedValue({ began: true, editors: ['/a/README.md'] })
    h.domSample.mockReturnValue('README.md')
    h.domPaths.mockReturnValue(['README.md'])
    h.pollBootStatus.mockResolvedValue(true)
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.controller.getSnapshot().revealed).toBe(true)
  })

  it('rotates the nonce when the still-mounted frame reloads in place', async () => {
    const h = makeHarness()
    h.controller.begin('key-1')
    await h.pump()
    h.controller.frameLoaded()
    await h.pump()
    expect(h.controller.getSnapshot().nonce).toBe('n1')
    h.controller.frameLoaded()
    expect(h.controller.getSnapshot().phase).toBe('rotating')
    expect(h.controller.settled()).toBe(false)
    await h.pump()
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'hidden', nonce: 'n2' })
    expect(h.beginBoot).toHaveBeenLastCalledWith('/w', 'n2')
  })

  it('keeps a stale rotation from landing after the key changed', async () => {
    const h = makeHarness()
    const pending: Array<() => void> = []
    h.beginBoot.mockImplementation(async () => {
      await new Promise<void>(resolve => { pending.push(resolve) })
      return { began: true, editors: null }
    })
    h.controller.begin('key-1')
    await h.pump()
    pending.shift()!()
    await h.pump()
    h.controller.frameLoaded()
    h.controller.frameLoaded()
    expect(h.controller.getSnapshot().phase).toBe('rotating')
    // The rotation's beginBoot is held pending while the key changes.
    h.controller.begin('key-2')
    expect(h.controller.getSnapshot()).toMatchObject({ key: 'key-2', phase: 'pending' })
    // Release key-2's OWN park (the last queued resolver): it settles.
    pending.pop()!()
    await h.pump()
    expect(h.controller.getSnapshot()).toMatchObject({ key: 'key-2', phase: 'hidden', nonce: 'n3' })
    // Now release the STALE rotation's park (key-1's): it must not land.
    pending.pop()!()
    await h.pump()
    expect(h.controller.getSnapshot()).toMatchObject({ key: 'key-2', phase: 'hidden', nonce: 'n3' })
  })

  it('fences the dying boot on the way out (unmount rotates the parked nonce)', async () => {
    const h = makeHarness()
    h.controller.begin('key-1')
    await h.pump()
    h.controller.fence()
    expect(h.beginBoot).toHaveBeenLastCalledWith('/w', 'n2')
    expect(h.controller.taggableNonce()).toBe('n1')
  })

  it('ignores every driver call after dispose', async () => {
    const h = makeHarness()
    h.controller.begin('key-1')
    await h.pump()
    h.controller.dispose()
    const before = h.controller.getSnapshot()
    h.controller.begin('key-2')
    h.controller.frameLoaded()
    expect(h.controller.getSnapshot()).toBe(before)
  })

  it('notifies subscribers on every transition', async () => {
    const h = makeHarness()
    const seen: string[] = []
    h.controller.subscribe(() => { seen.push(h.controller.getSnapshot().phase) })
    h.controller.begin('key-1')
    await h.pump()
    expect(seen).toEqual(['pending', 'hidden'])
  })
})
