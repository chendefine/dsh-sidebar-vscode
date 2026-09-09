/**
 * Unit tests for the official-sidebar chat-open takeover
 * (openIntercept.ts): the local `dsh-resource://file/` address parser
 * (a structural twin of the official grammar) and the
 * `ctx.sidebarRight.openResource` wrapper — the gate, the blocklist
 * fall-through, the params translation, and the restore-only-ours
 * disposal.
 *
 * @module dsh-sidebar-vscode/tests/openIntercept.spec
 */

import { describe, expect, it, vi } from 'vitest'
import {
  isAbsoluteLike,
  parseFileAddress,
  resolveAgainst,
  wrapSidebarRightOpenResource,
  type SidebarRightLike,
} from '../src/client/openIntercept.ts'

// ---- parseFileAddress (the documented grammar, same cases as official) ----

describe('parseFileAddress', () => {
  it('parses a session-scoped address into id + relative path', () => {
    expect(parseFileAddress('dsh-resource://file/session/abc/src/a.ts')).toEqual({
      scope: 'session', sessionId: 'abc', path: 'src/a.ts',
    })
  })

  it('parses an absolute POSIX address with the leading slash restored', () => {
    expect(parseFileAddress('dsh-resource://file/absolute/home/ys/notes.txt')).toEqual({
      scope: 'absolute', path: '/home/ys/notes.txt',
    })
  })

  it('keeps a Windows drive colon literal', () => {
    expect(parseFileAddress('dsh-resource://file/absolute/C:/x/y.txt')).toEqual({
      scope: 'absolute', path: 'C:/x/y.txt',
    })
  })

  it('preserves a UNC path\'s empty first segment', () => {
    expect(parseFileAddress('dsh-resource://file/absolute//server/share/x.txt')).toEqual({
      scope: 'absolute', path: '//server/share/x.txt',
    })
  })

  it('decodes component-encoded segments', () => {
    expect(parseFileAddress('dsh-resource://file/session/a%20b/c%23d.ts')).toEqual({
      scope: 'session', sessionId: 'a b', path: 'c#d.ts',
    })
  })

  it('refuses non-file schemes, foreign hosts, and unknown scopes', () => {
    expect(parseFileAddress('sidebar://guide')).toBeUndefined()
    expect(parseFileAddress('dsh-resource://other/session/a/b')).toBeUndefined()
    expect(parseFileAddress('dsh-resource://file/relative/a/b')).toBeUndefined()
    expect(parseFileAddress('https://example.com/x')).toBeUndefined()
  })

  it('refuses path-less or id-less shapes and malformed escapes', () => {
    expect(parseFileAddress('dsh-resource://file/session/abc')).toBeUndefined()
    expect(parseFileAddress('dsh-resource://file/session//x')).toBeUndefined()
    expect(parseFileAddress('dsh-resource://file/absolute/')).toBeUndefined()
    expect(parseFileAddress('dsh-resource://file/session/abc/%zz')).toBeUndefined()
  })
})

// ---- resolveAgainst / isAbsoluteLike (the join the translation needs) ----

describe('resolveAgainst', () => {
  it('returns absolute inputs untouched (POSIX, drive, UNC)', () => {
    expect(resolveAgainst('/w', '/x/a.ts')).toBe('/x/a.ts')
    expect(resolveAgainst('/w', 'C:\\x\\a.ts')).toBe('C:\\x\\a.ts')
    expect(resolveAgainst('/w', '\\\\srv\\share\\a.ts')).toBe('\\\\srv\\share\\a.ts')
    expect(isAbsoluteLike('/a')).toBe(true)
    expect(isAbsoluteLike('a/b')).toBe(false)
  })

  it('joins relatives onto the cwd with its own separator flavor', () => {
    expect(resolveAgainst('/w', 'src/a.ts')).toBe('/w/src/a.ts')
    expect(resolveAgainst('C:\\w\\', 'src\\a.ts')).toBe('C:\\w\\src\\a.ts')
    expect(resolveAgainst(undefined, 'src/a.ts')).toBe('src/a.ts')
  })
})

// ---- the openResource takeover wrapper ----

/** A controller fake: class-shaped, methods on the prototype (like the real service). */
class FakeSidebarRight implements SidebarRightLike {
  readonly openedResources: Array<{ address: string, options?: unknown }> = []
  readonly openedTabs: Array<{ kind: string, options?: unknown }> = []
  openResourceShouldThrow = false

  openResource(address: string, options?: { kind?: string, params?: unknown }): void {
    if (this.openResourceShouldThrow) throw new Error('boom')
    this.openedResources.push({ address, options })
  }

  openTab(kind: string, options?: { params?: unknown }): void {
    this.openedTabs.push({ kind, options })
  }
}

/** The deps table over a fake, with per-test knobs. */
function makeDeps(options: {
  enabled?: boolean
  blocked?: boolean
  cwd?: string
  kind?: string
} = {}) {
  return {
    takeoverEnabled: () => options.enabled ?? true,
    blocked: (_path: string) => options.blocked ?? false,
    // Only session 's1' has a known workspace root; any other id is the
    // unknown-cwd decline path.
    cwdOf: (sessionId: string) => (sessionId === 's1' ? options.cwd : undefined),
    kind: options.kind ?? 'vscode',
  }
}

describe('wrapSidebarRightOpenResource', () => {
  const SESSION_ADDR = 'dsh-resource://file/session/s1/src/a.ts'

  it('claims an enabled session-scope open as a workbench openTab', () => {
    const service = new FakeSidebarRight()
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/w' }))
    service.openResource(SESSION_ADDR)
    expect(service.openedTabs).toEqual([
      { kind: 'vscode', options: { params: { path: '/w/src/a.ts' } } },
    ])
    expect(service.openedResources).toEqual([])
    stop()
  })

  it('uses an absolute-scope path as-is (no cwd join)', () => {
    const service = new FakeSidebarRight()
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/w' }))
    service.openResource('dsh-resource://file/absolute/etc/conf.yaml')
    expect(service.openedTabs).toEqual([
      { kind: 'vscode', options: { params: { path: '/etc/conf.yaml' } } },
    ])
    stop()
  })

  it('forwards a sane params.line and drops junk lines', () => {
    const service = new FakeSidebarRight()
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/w' }))
    service.openResource(SESSION_ADDR, { params: { line: 42 } })
    service.openResource('dsh-resource://file/absolute/x/y.ts', { params: { line: -3 } })
    expect(service.openedTabs.map(entry => entry.options)).toEqual([
      { params: { path: '/w/src/a.ts', line: 42 } },
      { params: { path: '/x/y.ts' } },
    ])
    stop()
  })

  it('falls through untouched when the switch is off', () => {
    const service = new FakeSidebarRight()
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ enabled: false, cwd: '/w' }))
    const options = { params: { line: 7 } }
    service.openResource(SESSION_ADDR, options)
    expect(service.openedTabs).toEqual([])
    expect(service.openedResources).toEqual([{ address: SESSION_ADDR, options }])
    stop()
  })

  it('falls through for non-file addresses, malformed ones, and unknown cwds', () => {
    const service = new FakeSidebarRight()
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/w' }))
    service.openResource('sidebar://guide')
    service.openResource('dsh-resource://file/session/nope/x')
    expect(service.openedTabs).toEqual([])
    expect(service.openedResources.map(entry => entry.address)).toEqual([
      'sidebar://guide', 'dsh-resource://file/session/nope/x',
    ])
    stop()
  })

  it('falls through for a blocked path (the official viewers take it)', () => {
    const service = new FakeSidebarRight()
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ blocked: true, cwd: '/w' }))
    service.openResource(SESSION_ADDR)
    expect(service.openedTabs).toEqual([])
    expect(service.openedResources).toEqual([{ address: SESSION_ADDR, options: undefined }])
    stop()
  })

  it('falls back to the original when the workbench openTab refuses', () => {
    const service = new FakeSidebarRight()
    const originalOpenTab = service.openTab
    service.openTab = (): void => { throw new Error('no session surface') }
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/w' }))
    service.openResource(SESSION_ADDR)
    expect(service.openedResources).toEqual([{ address: SESSION_ADDR, options: undefined }])
    service.openTab = originalOpenTab
    stop()
  })

  it('installs nothing on a seam-less service shape', () => {
    const bare = {} as FakeSidebarRight
    const stop = wrapSidebarRightOpenResource(bare, makeDeps({ cwd: '/w' }))
    expect(() => stop()).not.toThrow()
  })

  it('disposes by removing only its own shadow (prototype method resumes)', () => {
    const service = new FakeSidebarRight()
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/w' }))
    expect(Object.getOwnPropertyDescriptor(service, 'openResource')?.value).toBeTypeOf('function')
    stop()
    expect(Object.getOwnPropertyDescriptor(service, 'openResource')).toBeUndefined()
    // The prototype method answers again, unintercepted.
    service.openResource(SESSION_ADDR)
    expect(service.openedTabs).toEqual([])
    expect(service.openedResources).toHaveLength(1)
  })

  it('leaves a later re-shadow standing on dispose (restore-only-ours)', () => {
    const service = new FakeSidebarRight()
    const stopFirst = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/w' }))
    const stopSecond = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/v' }))
    stopFirst()
    // The second wrapper is still the installed one.
    service.openResource(SESSION_ADDR)
    expect(service.openedTabs).toEqual([
      { kind: 'vscode', options: { params: { path: '/v/src/a.ts' } } },
    ])
    stopSecond()
  })

  it('composes onto a foreign own-property value shadow', () => {
    const service = new FakeSidebarRight()
    const foreignCalls: string[] = []
    const stock = service.openResource.bind(service)
    Object.defineProperty(service, 'openResource', {
      configurable: true, writable: true,
      value: (address: string, options?: { kind?: string, params?: unknown }) => {
        foreignCalls.push(address)
        stock(address, options)
      },
    })
    const stop = wrapSidebarRightOpenResource(service, makeDeps({ cwd: '/w' }))
    service.openResource(SESSION_ADDR)
    // The outermost (ours) claims the open; the foreign shadow never sees it.
    expect(service.openedTabs).toHaveLength(1)
    expect(foreignCalls).toEqual([])
    service.openResource('sidebar://guide')
    expect(foreignCalls).toEqual(['sidebar://guide'])
    stop()
  })
})
