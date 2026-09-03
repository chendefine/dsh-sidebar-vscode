/**
 * Unit tests for the chat-open takeover's shared plumbing (openIntercept.ts)
 * — the openRequest vehicle, the reroute driver, and the two era-specific
 * wrappers of the runtime's chat file-open funnel (`remote.session
 * .openWorkspacePath` on the gateway-era runtime, `workspaces.openPath` on
 * the legacy one).
 *
 * @module dsh-sidebar-vscode/tests/openIntercept.spec
 */

import { describe, expect, it } from 'vitest'
import {
  extractOpenRequest,
  filesTabSeed,
  findTabMeta,
  isAbsoluteLike,
  mergeOpenRequest,
  nextNonce,
  rerouteChatOpen,
  rerouteFilesOpen,
  resolveAgainst,
  SIDEBAR_FILES_TAB_TYPE,
  wrapRemoteOpenWorkspacePath,
  wrapWorkspacesOpenPath,
  type InterceptServiceFace,
  type OpenTabSeed,
  type RemoteOpenResult,
  type RemoteSessionLike,
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

describe('wrapWorkspacesOpenPath (option III — the legacy runtime funnel)', () => {
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

  it('reroutes a blocked path into the built-in Files tab when the dep claims it', async () => {
    const rerouted: string[] = []
    const filesOpens: string[] = []
    const opened: string[] = []
    const workspaces: WorkspacesLike = {
      openPath: (path: string) => {
        opened.push(path)
        return Promise.resolve()
      },
    }
    const stop = wrapWorkspacesOpenPath(workspaces, {
      takeoverEnabled: () => true,
      blocked: path => path.endsWith('.pdf'),
      reroute: path => { rerouted.push(path) },
      rerouteBlocked: path => { filesOpens.push(path); return true },
    })
    await workspaces.openPath('/w/report.pdf')
    await workspaces.openPath('/w/main.ts')
    expect(filesOpens).toEqual(['/w/report.pdf']) // the Files tab took the blocked open
    expect(rerouted).toEqual(['/w/main.ts']) // the rest still reroute to VSCode
    expect(opened).toEqual([]) // the host opener never ran — no xdg-open
    stop()
  })

  it('declines a blocked path to the stock opener when the Files reroute refuses or is absent', async () => {
    const opened: string[] = []
    const workspaces: WorkspacesLike = {
      openPath: (path: string) => {
        opened.push(path)
        return Promise.resolve()
      },
    }
    // A refusal (the Files tab type disabled in the side card settings)…
    const stop = wrapWorkspacesOpenPath(workspaces, {
      takeoverEnabled: () => true,
      blocked: path => path.endsWith('.pdf'),
      reroute: () => { throw new Error('must not reroute') },
      rerouteBlocked: () => false,
    })
    await workspaces.openPath('/w/report.pdf')
    stop()
    // …and an absent dep (minimal wiring) both fall back to the original.
    const stopBare = wrapWorkspacesOpenPath(workspaces, {
      takeoverEnabled: () => true,
      blocked: path => path.endsWith('.pdf'),
      reroute: () => { throw new Error('must not reroute') },
    })
    await workspaces.openPath('/w/report.pdf')
    stopBare()
    expect(opened).toEqual(['/w/report.pdf', '/w/report.pdf'])
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

  it('a service without a callable openPath member installs nothing (fail-soft seam)', () => {
    // Same regression class as the settings takeover: a runtime whose
    // workspaces mirror carries a different shape must not crash plugin
    // activation — the wrapper declines with a no-op disposer.
    for (const openPath of [undefined, 'not-a-function']) {
      const workspaces = { openPath } as unknown as WorkspacesLike
      const stop = wrapWorkspacesOpenPath(workspaces, {
        takeoverEnabled: () => true,
        reroute: () => { throw new Error('must not reroute') },
      })
      expect(() => stop()).not.toThrow()
      expect(workspaces.openPath).toBe(openPath) // untouched
    }
  })
})

/**
 * A fake of the gateway's remote session namespace, mirroring how the client
 * projection mounts namespace methods: `openWorkspacePath` is a configurable,
 * getter-only own property returning a FRESH invocation closure per access
 * (the closure the stock getter mints reads the live mount each time).
 */
function makeRemoteSession(options?: {
  onCall?: (request: unknown, signal?: AbortSignal) => RemoteOpenResult
}): RemoteSessionLike & {
  calls: Array<{ request: unknown, signal?: AbortSignal }>
  getterReads: number
  __remount(next: (request: unknown, signal?: AbortSignal) => Promise<RemoteOpenResult>): void
} {
  const calls: Array<{ request: unknown, signal?: AbortSignal }> = []
  let invocation: (request: unknown, signal?: AbortSignal) => Promise<RemoteOpenResult> = (
    request, signal,
  ) => {
    calls.push({ request, signal })
    return Promise.resolve(options?.onCall?.(request, signal) ?? { ok: true, value: { opened: true } })
  }
  const service = {
    calls,
    getterReads: 0,
    get openWorkspacePath() {
      service.getterReads += 1
      return (request: unknown, signal?: AbortSignal) => invocation(request, signal)
    },
    /** Swap what the next getter read yields (a namespace remount). */
    __remount(next: (request: unknown, signal?: AbortSignal) => Promise<RemoteOpenResult>): void {
      invocation = next
    },
  }
  return service as typeof service & RemoteSessionLike
}

describe('wrapRemoteOpenWorkspacePath (option III — the gateway-era runtime funnel)', () => {
  it('intercepts opens when enabled, reroutes, and resolves the native success receipt', async () => {
    const rerouted: string[] = []
    const session = makeRemoteSession()
    const stop = wrapRemoteOpenWorkspacePath(session, {
      takeoverEnabled: () => true,
      reroute: path => { rerouted.push(path) },
    })
    await expect(session.openWorkspacePath!({ path: '/w/a.ts' }))
      .resolves.toEqual({ ok: true, value: { opened: true } })
    expect(rerouted).toEqual(['/w/a.ts'])
    expect(session.calls).toEqual([]) // the Host remote never ran — no xdg-open
    stop()
  })

  it('passes the caller signal through untouched on the fall-through', async () => {
    const session = makeRemoteSession()
    const stop = wrapRemoteOpenWorkspacePath(session, {
      takeoverEnabled: () => false,
      reroute: () => { throw new Error('must not reroute') },
    })
    const signal = new AbortController().signal
    await session.openWorkspacePath!({ path: '/w/a.ts' }, signal)
    expect(session.calls).toEqual([{ request: { path: '/w/a.ts' }, signal }])
    stop()
  })

  it('falls through on empty, missing, and malformed request paths', async () => {
    const session = makeRemoteSession()
    const stop = wrapRemoteOpenWorkspacePath(session, {
      takeoverEnabled: () => true,
      reroute: () => { throw new Error('must not reroute') },
    })
    await session.openWorkspacePath!({ path: '' })
    await session.openWorkspacePath!({} as { path: string })
    await session.openWorkspacePath!(null as unknown as { readonly path: string }, undefined)
    expect(session.calls).toHaveLength(3)
    stop()
  })

  it('reroutes a blocked path into the built-in Files tab when the dep claims it', async () => {
    const session = makeRemoteSession()
    const rerouted: string[] = []
    const filesOpens: string[] = []
    const stop = wrapRemoteOpenWorkspacePath(session, {
      takeoverEnabled: () => true,
      blocked: path => path.endsWith('.pdf'),
      reroute: path => { rerouted.push(path) },
      rerouteBlocked: path => { filesOpens.push(path); return true },
    })
    const receipt = await session.openWorkspacePath!({ path: '/w/report.pdf' })
    // The blocked open never reached the Host remote (recorded) — the Files
    // tab took it, and the caller still sees the native success receipt.
    expect(filesOpens).toEqual(['/w/report.pdf'])
    expect(receipt).toEqual({ ok: true, value: { opened: true } })
    await session.openWorkspacePath!({ path: '/w/main.ts' })
    expect(rerouted).toEqual(['/w/main.ts']) // the rest still reroute
    expect(session.calls).toEqual([]) // the Host opener never ran — no xdg-open
    stop()
  })

  it('declines a blocked path to the stock opener when the Files reroute refuses or is absent', async () => {
    const session = makeRemoteSession()
    const stop = wrapRemoteOpenWorkspacePath(session, {
      takeoverEnabled: () => true,
      blocked: path => path.endsWith('.pdf'),
      reroute: () => { throw new Error('must not reroute') },
      rerouteBlocked: () => false, // the Files tab type disabled in settings
    })
    await session.openWorkspacePath!({ path: '/w/report.pdf' })
    stop()
    const stopBare = wrapRemoteOpenWorkspacePath(session, {
      takeoverEnabled: () => true,
      blocked: path => path.endsWith('.pdf'),
      reroute: () => { throw new Error('must not reroute') },
    })
    await session.openWorkspacePath!({ path: '/w/report.pdf' })
    stopBare()
    // Both declines reached the stock closure (the recorded Host remote).
    expect(session.calls).toEqual([
      { request: { path: '/w/report.pdf' }, signal: undefined },
      { request: { path: '/w/report.pdf' }, signal: undefined },
    ])
  })

  it('re-reads the stock method per access, so a remount under the wrapper stays live', async () => {
    const session = makeRemoteSession()
    const stop = wrapRemoteOpenWorkspacePath(session, {
      takeoverEnabled: () => false,
      reroute: () => { throw new Error('must not reroute') },
    })
    const before = session.getterReads
    await session.openWorkspacePath!({ path: '/w/a.ts' })
    expect(session.getterReads).toBeGreaterThan(before)
    // The host unmounts and remounts the method (a fresh invocation closure)
    // while our wrapper is installed: the next fall-through must reach the
    // NEW closure, never a snapshot of the old one.
    let remounted = false
    session.__remount(async () => {
      remounted = true
      return { ok: true, value: { opened: true } }
    })
    await session.openWorkspacePath!({ path: '/w/b.ts' })
    expect(remounted).toBe(true)
    stop()
  })

  it('restore puts back the exact original descriptor', () => {
    const session = makeRemoteSession()
    const original = Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')
    const stop = wrapRemoteOpenWorkspacePath(session, { takeoverEnabled: () => false, reroute: () => {} })
    expect(Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')?.get)
      .not.toBe(original?.get)
    stop()
    expect(Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')).toEqual(original)
  })

  it('restore is a no-op after the host unmounted or replaced the property', () => {
    const session = makeRemoteSession()
    // …the gateway's unmount path deletes the own property wholesale: the
    // disposer must not resurrect the stale descriptor.
    const stop1 = wrapRemoteOpenWorkspacePath(session, { takeoverEnabled: () => false, reroute: () => {} })
    delete (session as RemoteSessionLike).openWorkspacePath
    expect(() => stop1()).not.toThrow()
    expect('openWorkspacePath' in session).toBe(false)

    // …and a host re-install under our wrapper must survive our dispose.
    // (Re-mount a stock-shaped method first: the delete above removed it.)
    const remount = (): () => Promise<RemoteOpenResult> =>
      () => Promise.resolve({ ok: true, value: { opened: true } })
    Object.defineProperty(session, 'openWorkspacePath', {
      configurable: true,
      enumerable: true,
      get: remount,
    })
    const stop2 = wrapRemoteOpenWorkspacePath(session, { takeoverEnabled: () => false, reroute: () => {} })
    expect(Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')?.get).not.toBe(remount)
    const replacement = (): { ok: true, value: { opened: true } } => ({ ok: true, value: { opened: true } })
    const replacementGetter = (): unknown => replacement
    Object.defineProperty(session, 'openWorkspacePath', {
      configurable: true,
      enumerable: true,
      get: replacementGetter,
    })
    stop2()
    expect(Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')?.get).toBe(replacementGetter)
    expect(session.openWorkspacePath).toBe(replacement)
  })

  it('wrappers compose and unwrap in stack order', () => {
    const session = makeRemoteSession()
    const original = Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')
    const stopOuter = wrapRemoteOpenWorkspacePath(session, { takeoverEnabled: () => false, reroute: () => {} })
    const outer = Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')?.get
    const stopInner = wrapRemoteOpenWorkspacePath(session, { takeoverEnabled: () => false, reroute: () => {} })
    expect(Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')?.get).not.toBe(outer)
    stopInner()
    expect(Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')?.get).toBe(outer)
    stopOuter()
    expect(Object.getOwnPropertyDescriptor(session, 'openWorkspacePath')).toEqual(original)
  })

  it('a namespace without the mounted method installs nothing (fail-soft seam)', () => {
    // No own property at all (method not mounted)…
    const bare = {} as RemoteSessionLike
    expect(() => wrapRemoteOpenWorkspacePath(bare, {
      takeoverEnabled: () => true,
      reroute: () => { throw new Error('must not reroute') },
    })()).not.toThrow()
    expect('openWorkspacePath' in bare).toBe(false)
    // …a plain value property (a foreign runtime shape)…
    const valued = { openWorkspacePath: () => Promise.resolve({ ok: true, value: { opened: true } }) } as unknown as RemoteSessionLike
    const valuedOriginal = valued.openWorkspacePath
    expect(() => wrapRemoteOpenWorkspacePath(valued, {
      takeoverEnabled: () => true,
      reroute: () => { throw new Error('must not reroute') },
    })()).not.toThrow()
    expect(valued.openWorkspacePath).toBe(valuedOriginal)
    // …and a getter that yields a non-function.
    const odd = { get openWorkspacePath() { return 42 } } as unknown as RemoteSessionLike
    expect(() => wrapRemoteOpenWorkspacePath(odd, {
      takeoverEnabled: () => true,
      reroute: () => { throw new Error('must not reroute') },
    })()).not.toThrow()
    expect(odd.openWorkspacePath).toBe(42)
  })

  it('the reroute lands the same openTab/meta vehicle as the legacy wrapper', async () => {
    const service = makeService()
    const session = makeRemoteSession()
    const stop = wrapRemoteOpenWorkspacePath(session, {
      takeoverEnabled: () => true,
      reroute: path => { rerouteChatOpen(service, 'dsh-sidebar-vscode:vscode', path) },
    })
    await session.openWorkspacePath!({ path: '/w/a.ts' })
    expect(service.openTabs).toEqual([{ type: 'dsh-sidebar-vscode:vscode', path: '/w/a.ts' }])
    expect(service.updates).toHaveLength(1)
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

describe('rerouteFilesOpen (the blocklist-hit reroute into the built-in Files tab)', () => {
  it('lands the Files tab seed: per-path id, basename title, no meta vehicle', () => {
    const service = makeService()
    rerouteFilesOpen(service, '/w/report.pdf')
    rerouteFilesOpen(service, 'C:\\w\\img\\shot.png')
    // A structural twin of better-sidebar's own openSidebarFile: the
    // built-in 'editor' type, the file name as title, the path-derived id
    // (multiple files coexist; the descriptor's path dedupeKey focuses an
    // already-open one).
    expect(service.openTabs).toEqual([
      { type: SIDEBAR_FILES_TAB_TYPE, title: 'report.pdf', path: '/w/report.pdf', id: 'editor:/w/report.pdf' },
      { type: SIDEBAR_FILES_TAB_TYPE, title: 'shot.png', path: 'C:\\w\\img\\shot.png', id: 'editor:C:\\w\\img\\shot.png' },
    ])
    // No openRequest meta on this route — the editor tab consumes its path
    // seed natively, so no updateTab is ever sent.
    expect(service.updates).toEqual([])
  })

  it('filesTabSeed mirrors the same contract for hand-built callers', () => {
    expect(filesTabSeed('/w/a.tar.gz')).toEqual({
      type: SIDEBAR_FILES_TAB_TYPE,
      title: 'a.tar.gz',
      path: '/w/a.tar.gz',
      id: 'editor:/w/a.tar.gz',
    })
    // A path with no separator is its own title.
    expect(filesTabSeed('readme.md').title).toBe('readme.md')
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
