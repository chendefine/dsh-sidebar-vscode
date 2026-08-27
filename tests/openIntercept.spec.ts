/**
 * Unit tests for the chat-open takeover's shared plumbing (openIntercept.ts)
 * — the openRequest vehicle, the reroute driver, and the
 * `workspaces.openPath` wrapper (research option III).
 *
 * @module dsh-sidebar-vscode/tests/openIntercept.spec
 */

import { describe, expect, it } from 'vitest'
import {
  extractOpenRequest,
  findTabMeta,
  isAbsoluteLike,
  mergeOpenRequest,
  nextNonce,
  rerouteChatOpen,
  resolveAgainst,
  wrapWorkspacesOpenPath,
  type InterceptServiceFace,
  type OpenTabSeed,
  type WorkspacesLike,
} from '../src/client/openIntercept.ts'

/** A recording fake of the betterSidebar service slice. */
interface RecordingService extends InterceptServiceFace {
  openTabs: OpenTabSeed[]
  updates: Array<{ tabId: string, patch: { title?: string, path?: string, meta?: unknown } }>
  refusals: string[]
}

function makeService(state?: object): RecordingService {
  const service = {
    openTabs: [] as OpenTabSeed[],
    updates: [] as RecordingService['updates'],
    refusals: [] as string[],
    openTab(seed: OpenTabSeed): void {
      // A refused type (disabled in settings) is the service's contract: no-op.
      if (service.refusals.includes(seed.type)) return
      service.openTabs.push(seed)
    },
    isTabEnabled(id: string): boolean {
      return !service.refusals.includes(id)
    },
    updateTab(tabId: string, patch: { title?: string, path?: string, meta?: unknown }): void {
      service.updates.push({ tabId, patch })
    },
    getSnapshot(): { sessionId?: string | undefined, state?: unknown } {
      return state === undefined ? {} : { sessionId: 's1', state }
    },
  }
  return service as unknown as RecordingService & InterceptServiceFace
}

describe('wrapWorkspacesOpenPath (option III — the runtime funnel)', () => {
  it('intercepts opens when enabled, reroutes, and resolves as success', async () => {
    const rerouted: string[] = []
    const opened: string[] = []
    const workspaces: WorkspacesLike = {
      openPath: (path: string) => {
        opened.push(path)
        return Promise.resolve()
      },
    }
    const stop = wrapWorkspacesOpenPath(workspaces, {
      takeoverEnabled: () => true,
      reroute: path => { rerouted.push(path) },
    })
    await expect(workspaces.openPath('/w/a.ts')).resolves.toBeUndefined()
    expect(rerouted).toEqual(['/w/a.ts'])
    expect(opened).toEqual([]) // the host opener never ran — no xdg-open
    stop()
  })

  it('falls through untouched when the switch is off or the path is empty', async () => {
    const opened: string[] = []
    const workspaces: WorkspacesLike = {
      openPath: (path: string) => {
        opened.push(path)
        return Promise.resolve()
      },
    }
    const stop = wrapWorkspacesOpenPath(workspaces, {
      takeoverEnabled: () => false,
      reroute: () => { throw new Error('must not reroute') },
    })
    await workspaces.openPath('/w/a.ts')
    await workspaces.openPath('')
    expect(opened).toEqual(['/w/a.ts', ''])
    stop()
  })

  it('restore puts back the exact original (chains with better-sidebar\'s wrapper)', () => {
    const workspaces: WorkspacesLike = { openPath: () => Promise.resolve() }
    const original = workspaces.openPath
    const stopOuter = wrapWorkspacesOpenPath(workspaces, { takeoverEnabled: () => false, reroute: () => {} })
    const mid = workspaces.openPath
    const stopInner = wrapWorkspacesOpenPath(workspaces, { takeoverEnabled: () => true, reroute: () => {} })
    expect(workspaces.openPath).not.toBe(mid)
    stopInner()
    expect(workspaces.openPath).toBe(mid)
    stopOuter()
    expect(workspaces.openPath).toBe(original)
  })

  it('the reroute\'s own openTab (the VSCode tab) is untouched by this wrapper', async () => {
    const service = makeService()
    const workspaces: WorkspacesLike = { openPath: () => Promise.resolve() }
    const stop = wrapWorkspacesOpenPath(workspaces, {
      takeoverEnabled: () => true,
      reroute: path => { rerouteChatOpen(service, 'dsh-sidebar-vscode:vscode', path) },
    })
    await workspaces.openPath('/w/a.ts')
    expect(service.openTabs).toEqual([{ type: 'dsh-sidebar-vscode:vscode', path: '/w/a.ts' }])
    stop()
  })
})

describe('openRequest vehicle', () => {
  it('extractOpenRequest accepts a well-formed request and normalizes line/column', () => {
    expect(extractOpenRequest({ openRequest: { nonce: 3, path: '/w/a.ts', line: 10.5, column: 2 } }))
      .toEqual({ nonce: 3, path: '/w/a.ts', line: 10, column: 2 })
  })

  it('extractOpenRequest rejects absent, malformed, and non-object shapes', () => {
    expect(extractOpenRequest(undefined)).toBeNull()
    expect(extractOpenRequest(null)).toBeNull()
    expect(extractOpenRequest({})).toBeNull()
    expect(extractOpenRequest({ openRequest: null })).toBeNull()
    expect(extractOpenRequest({ openRequest: { nonce: '3', path: '/w/a.ts' } })).toBeNull()
    expect(extractOpenRequest({ openRequest: { nonce: 3, path: '' } })).toBeNull()
    expect(extractOpenRequest({ openRequest: [1, 2] })).toBeNull()
    expect(extractOpenRequest([1, 2])).toBeNull()
  })

  it('mergeOpenRequest preserves sibling meta keys', () => {
    const merged = mergeOpenRequest({ treeOpen: true, other: { deep: 1 } }, { nonce: 7, path: '/w/a.ts' })
    expect(merged).toEqual({
      treeOpen: true,
      other: { deep: 1 },
      openRequest: { nonce: 7, path: '/w/a.ts' },
    })
  })

  it('mergeOpenRequest replaces (not nests) a previous openRequest', () => {
    const merged = mergeOpenRequest(
      { openRequest: { nonce: 1, path: '/old' } },
      { nonce: 2, path: '/new' },
    )
    expect(merged).toEqual({ openRequest: { nonce: 2, path: '/new' } })
  })

  it('nextNonce is strictly monotonic even within one millisecond', () => {
    let frozen = 1000
    const now = () => frozen
    const a = nextNonce(now)
    const b = nextNonce(now)
    const c = nextNonce(now)
    expect(b).toBe(a + 1)
    expect(c).toBe(b + 1)
    frozen = 999 // wall clock going backwards never rewinds the sequence
    const d = nextNonce(now)
    expect(d).toBe(c + 1)
    // A later wall clock is adopted; an earlier module state never rewinds.
    const later = a + 10_000
    frozen = later
    expect(nextNonce(now)).toBe(later)
    frozen = later - 1
    expect(nextNonce(now)).toBe(later + 1)
  })
})

describe('findTabMeta', () => {
  const state = {
    splits: {
      kind: 'split',
      children: [
        { kind: 'leaf', id: 'p1', tabs: [{ id: 'other', meta: { a: 1 } }] },
        { kind: 'leaf', id: 'p2', tabs: [{ id: 'vscode', meta: { mine: true } }] },
      ],
    },
    bottomSplits: { kind: 'leaf', id: 'b1', tabs: [{ id: 'term', meta: { t: 1 } }] },
  }

  it('finds tabs in the top tree across splits', () => {
    expect(findTabMeta(state, 'vscode')).toEqual({ mine: true })
  })

  it('finds tabs in the bottom tree', () => {
    expect(findTabMeta(state, 'term')).toEqual({ t: 1 })
  })

  it('unknown ids and malformed states yield undefined (never throw)', () => {
    expect(findTabMeta(state, 'nope')).toBeUndefined()
    expect(findTabMeta(undefined, 'x')).toBeUndefined()
    expect(findTabMeta(null, 'x')).toBeUndefined()
    expect(findTabMeta('string', 'x')).toBeUndefined()
    expect(findTabMeta({ splits: { kind: 'leaf', tabs: 'not-an-array' } }, 'x')).toBeUndefined()
  })
})

describe('resolveAgainst', () => {
  it('absolute paths (posix, drive, UNC) pass through', () => {
    expect(resolveAgainst('/w', '/w/a.ts')).toBe('/w/a.ts')
    expect(resolveAgainst('C:\\w', 'C:\\a.ts')).toBe('C:\\a.ts')
    expect(resolveAgainst('/w', '\\\\server\\share\\a.ts')).toBe('\\\\server\\share\\a.ts')
  })

  it('relative paths join onto the cwd with its separator style', () => {
    expect(resolveAgainst('/w', 'a.ts')).toBe('/w/a.ts')
    expect(resolveAgainst('/w/', 'a.ts')).toBe('/w/a.ts')
    expect(resolveAgainst('C:\\w\\', 'a.ts')).toBe('C:\\w\\a.ts')
  })

  it('an absent cwd leaves the path untouched', () => {
    expect(resolveAgainst(undefined, 'a.ts')).toBe('a.ts')
  })

  it('isAbsoluteLike mirrors the same rules', () => {
    expect(isAbsoluteLike('/a')).toBe(true)
    expect(isAbsoluteLike('a/b')).toBe(false)
    expect(isAbsoluteLike('C:/a')).toBe(true)
    expect(isAbsoluteLike('C:\\a')).toBe(true)
    expect(isAbsoluteLike('rel:C')).toBe(false)
  })
})

describe('rerouteChatOpen', () => {
  it('opens the VSCode tab with the file path and stamps a merged openRequest', () => {
    const state = {
      splits: { kind: 'leaf', tabs: [{ id: 'dsh-sidebar-vscode:vscode', meta: { treeOpen: true } }] },
    }
    const service = makeService(state)
    rerouteChatOpen(service, 'dsh-sidebar-vscode:vscode', '/w/a.ts')
    // The content seed carries the path (panel auto-expansion + focus).
    expect(service.openTabs).toEqual([
      { type: 'dsh-sidebar-vscode:vscode', path: '/w/a.ts' },
    ])
    // The meta update preserves the sibling key and carries a monotonic nonce.
    expect(service.updates).toHaveLength(1)
    const { tabId, patch } = service.updates[0]!
    expect(tabId).toBe('dsh-sidebar-vscode:vscode')
    const meta = patch.meta as { treeOpen: boolean, openRequest: { nonce: number, path: string } }
    expect(meta.treeOpen).toBe(true)
    expect(meta.openRequest.path).toBe('/w/a.ts')
    expect(meta.openRequest.nonce).toBeGreaterThan(0)
    // A second reroute mints a strictly greater nonce.
    rerouteChatOpen(service, 'dsh-sidebar-vscode:vscode', '/w/b.ts')
    const second = service.updates[1]!.patch.meta as { openRequest: { nonce: number } }
    expect(second.openRequest.nonce).toBeGreaterThan(meta.openRequest.nonce)
  })

  it('is harmless when the tab never landed (updateTab is the no-op path)', () => {
    const service = makeService()
    service.refusals.push('dsh-sidebar-vscode:vscode') // disabled in settings
    rerouteChatOpen(service, 'dsh-sidebar-vscode:vscode', '/w/a.ts')
    expect(service.openTabs).toEqual([])
    expect(service.updates).toEqual([
      { tabId: 'dsh-sidebar-vscode:vscode', patch: { meta: { openRequest: expect.objectContaining({ path: '/w/a.ts' }) } } },
    ])
  })
})
