/**
 * Unit tests for the settings-page takeover wrappers (settingsTakeover.ts) —
 * the seams behind the settings page's「打开配置文件」button (research
 * option IV): intercept the wire method (the gateway-era
 * `remote.settings.openSettingsDocument`, or the legacy
 * `connection.api.settings.openDocument`), resolve the document through this
 * plugin's own route, and reroute the open into the VSCode tab; every decline
 * falls back to the untouched stock method.
 *
 * @module dsh-sidebar-vscode/tests/settingsTakeover.spec
 */

import { describe, expect, it } from 'vitest'
import {
  closeSettingsDialog,
  wrapRemoteOpenSettingsDocument,
  wrapSettingsOpenDocument,
  type RemoteSettingsOpenResult,
  type RemoteSettingsLike,
  type SettingsOpenResponse,
} from '../src/client/settingsTakeover.ts'

/**
 * A recording stand-in for `connection.api`: the original openDocument
 * answers a plausible stock success and records payload/signal so the
 * fall-through assertions can check exact passthrough.
 */
function makeApi() {
  const calls: Array<{ payload: unknown, signal?: AbortSignal }> = []
  const api = {
    settings: {
      openDocument(payload: unknown, signal?: AbortSignal): Promise<SettingsOpenResponse> {
        calls.push({ payload, signal })
        return Promise.resolve({ rpcId: 'r1', result: { ok: true, value: { opened: true as const } } })
      },
    },
  }
  return { api, calls }
}

describe('wrapSettingsOpenDocument (option IV — the settings button)', () => {
  it('intercepts when enabled: resolves the path, reroutes, acknowledges ok, never calls the host opener', async () => {
    const { api, calls } = makeApi()
    const rerouted: string[] = []
    const stop = wrapSettingsOpenDocument(api, {
      takeoverEnabled: () => true,
      resolvePath: () => Promise.resolve('/data/dsh-home/settings.yaml'),
      reroute: path => { rerouted.push(path) },
    })
    const response = await api.settings.openDocument({})
    expect(rerouted).toEqual(['/data/dsh-home/settings.yaml'])
    expect(calls).toEqual([]) // the stock /api settings.openDocument never ran
    expect(response.result.ok).toBe(true) // what SettingsDocumentStore.open reads
    expect((response.result as { value?: { opened?: unknown } }).value?.opened).toBe(true)
    stop()
  })

  it('a successful takeover closes the settings dialog exactly once, after the reroute', async () => {
    const { api } = makeApi()
    const order: string[] = []
    const stop = wrapSettingsOpenDocument(api, {
      takeoverEnabled: () => true,
      resolvePath: () => Promise.resolve('/x/settings.yaml'),
      reroute: () => { order.push('reroute') },
      closeDialog: () => { order.push('close') },
    })
    await api.settings.openDocument({})
    expect(order).toEqual(['reroute', 'close'])
    stop()
  })

  it('declines never close the dialog: gate off and unresolvable path both skip closeDialog', async () => {
    // Gate off.
    {
      const { api } = makeApi()
      const stop = wrapSettingsOpenDocument(api, {
        takeoverEnabled: () => false,
        resolvePath: () => Promise.resolve('/x/settings.yaml'),
        reroute: () => {},
        closeDialog: () => { throw new Error('must not close') },
      })
      await api.settings.openDocument({})
      stop()
    }
    // Enabled but the document cannot be located.
    {
      const { api } = makeApi()
      const stop = wrapSettingsOpenDocument(api, {
        takeoverEnabled: () => true,
        resolvePath: () => Promise.resolve(null),
        reroute: () => {},
        closeDialog: () => { throw new Error('must not close') },
      })
      await api.settings.openDocument({})
      stop()
    }
  })

  it('falls through untouched when the switch is off — resolvePath is not even asked', async () => {
    const { api, calls } = makeApi()
    let resolved = 0
    const signal = new AbortController().signal
    const stop = wrapSettingsOpenDocument(api, {
      takeoverEnabled: () => false,
      resolvePath: () => { resolved += 1; return Promise.resolve('/x/settings.yaml') },
      reroute: () => { throw new Error('must not reroute') },
    })
    const response = await api.settings.openDocument({ some: 'payload' }, signal)
    expect(resolved).toBe(0)
    expect(calls).toEqual([{ payload: { some: 'payload' }, signal }]) // exact payload+signal passthrough
    expect(response.rpcId).toBe('r1') // the original's own answer, verbatim
    stop()
  })

  it('an unresolvable document (null / empty path) falls back to the stock method', async () => {
    for (const path of [null, '']) {
      const { api, calls } = makeApi()
      const rerouted: string[] = []
      const stop = wrapSettingsOpenDocument(api, {
        takeoverEnabled: () => true,
        resolvePath: () => Promise.resolve(path),
        reroute: p => { rerouted.push(p) },
      })
      const response = await api.settings.openDocument({})
      expect(rerouted).toEqual([]) // nothing rerouted — no VSCode tab hijack
      expect(calls).toHaveLength(1) // the stock behavior served the click
      expect(response.result.ok).toBe(true)
      stop()
    }
  })

  it('restore puts back the exact original (HMR / chain safe)', async () => {
    const { api } = makeApi()
    const original = api.settings.openDocument
    const stopOuter = wrapSettingsOpenDocument(api, {
      takeoverEnabled: () => false,
      resolvePath: () => Promise.resolve('/x'),
      reroute: () => {},
    })
    const mid = api.settings.openDocument
    const stopInner = wrapSettingsOpenDocument(api, {
      takeoverEnabled: () => true,
      resolvePath: () => Promise.resolve(null),
      reroute: () => {},
    })
    expect(api.settings.openDocument).not.toBe(mid)
    stopInner()
    expect(api.settings.openDocument).toBe(mid)
    stopOuter()
    expect(api.settings.openDocument).toBe(original)
  })

  it('a missing seam (no api / no settings member / no openDocument) installs nothing and never throws', () => {
    // The regression behind "failed to apply loader entry … (dsh-sidebar-
    // vscode): Cannot read properties of undefined (reading 'settings')":
    // a page whose connection service carries no `api` (an older, newer, or
    // third-party web shell) must not cost this plugin its activation —
    // the wrapper declines with a no-op disposer instead.
    const shapes: Array<unknown> = [
      undefined,
      {},
      { settings: undefined },
      { settings: {} },
      { settings: { openDocument: undefined } },
      { settings: { openDocument: 'not-a-function' } },
    ]
    for (const api of shapes) {
      const stop = wrapSettingsOpenDocument(api as never, {
        takeoverEnabled: () => true,
        resolvePath: () => { throw new Error('must not resolve') },
        reroute: () => { throw new Error('must not reroute') },
      })
      expect(() => stop()).not.toThrow()
    }
  })
})

/**
 * A fake of the gateway's remote settings namespace, mirroring how the
 * client projection mounts namespace methods: `openSettingsDocument` is a
 * configurable, getter-only own property returning a FRESH invocation
 * closure per access.
 */
function makeRemoteSettings() {
  const calls: Array<{ signal?: AbortSignal }> = []
  const settings = {
    calls,
    get openSettingsDocument() {
      return (signal?: AbortSignal): Promise<RemoteSettingsOpenResult> => {
        calls.push({ signal })
        return Promise.resolve({ ok: true, value: { opened: true } })
      }
    },
  }
  return settings as typeof settings & RemoteSettingsLike
}

describe('wrapRemoteOpenSettingsDocument (option IV — the gateway-era settings button)', () => {
  it('intercepts when enabled: resolves the path, reroutes, closes the dialog, acknowledges the native receipt', async () => {
    const settings = makeRemoteSettings()
    const order: string[] = []
    const rerouted: string[] = []
    const stop = wrapRemoteOpenSettingsDocument(settings, {
      takeoverEnabled: () => true,
      resolvePath: () => Promise.resolve('/data/dsh-home/settings.yaml'),
      reroute: path => { rerouted.push(path); order.push('reroute') },
      closeDialog: () => { order.push('close') },
    })
    await expect(settings.openSettingsDocument!())
      .resolves.toEqual({ ok: true, value: { opened: true } })
    expect(rerouted).toEqual(['/data/dsh-home/settings.yaml'])
    expect(order).toEqual(['reroute', 'close'])
    expect(settings.calls).toEqual([]) // the Host remote never ran — no xdg-open
    stop()
  })

  it('falls through untouched when the switch is off — resolvePath is not even asked', async () => {
    const settings = makeRemoteSettings()
    let resolved = 0
    const signal = new AbortController().signal
    const stop = wrapRemoteOpenSettingsDocument(settings, {
      takeoverEnabled: () => false,
      resolvePath: () => { resolved += 1; return Promise.resolve('/x/settings.yaml') },
      reroute: () => { throw new Error('must not reroute') },
      closeDialog: () => { throw new Error('must not close') },
    })
    await expect(settings.openSettingsDocument!(signal)).resolves.toEqual({ ok: true, value: { opened: true } })
    expect(resolved).toBe(0)
    expect(settings.calls).toEqual([{ signal }]) // exact signal passthrough
    stop()
  })

  it('an unresolvable document (null / empty path) falls back to the stock remote', async () => {
    for (const path of [null, '']) {
      const settings = makeRemoteSettings()
      const stop = wrapRemoteOpenSettingsDocument(settings, {
        takeoverEnabled: () => true,
        resolvePath: () => Promise.resolve(path),
        reroute: () => { throw new Error('must not reroute') },
        closeDialog: () => { throw new Error('must not close') },
      })
      await settings.openSettingsDocument!()
      expect(settings.calls).toHaveLength(1) // the stock behavior served the click
      stop()
    }
  })

  it('restore puts back the exact original descriptor; a host re-install survives our dispose', () => {
    const settings = makeRemoteSettings()
    const original = Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')
    const stop = wrapRemoteOpenSettingsDocument(settings, {
      takeoverEnabled: () => false,
      resolvePath: () => Promise.resolve('/x'),
      reroute: () => {},
    })
    expect(Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')?.get).not.toBe(original?.get)
    stop()
    expect(Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')).toEqual(original)

    // Re-mount a stock-shaped method, wrap again, then let the HOST replace
    // the property under us: our disposer must not clobber the replacement.
    const remount = (): (() => Promise<RemoteSettingsOpenResult>) =>
      () => Promise.resolve({ ok: true, value: { opened: true } })
    Object.defineProperty(settings, 'openSettingsDocument', {
      configurable: true,
      enumerable: true,
      get: remount,
    })
    const stop2 = wrapRemoteOpenSettingsDocument(settings, {
      takeoverEnabled: () => false,
      resolvePath: () => Promise.resolve('/x'),
      reroute: () => {},
    })
    const replacementGetter = (): unknown => 42
    Object.defineProperty(settings, 'openSettingsDocument', {
      configurable: true,
      enumerable: true,
      get: replacementGetter,
    })
    stop2()
    expect(Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')?.get).toBe(replacementGetter)
  })

  it('re-reads the stock method per access, so a remount under the wrapper stays live', async () => {
    const settings = makeRemoteSettings()
    const stop = wrapRemoteOpenSettingsDocument(settings, {
      takeoverEnabled: () => true,
      resolvePath: () => Promise.resolve(null), // decline → fall through
      reroute: () => { throw new Error('must not reroute') },
    })
    await settings.openSettingsDocument!()
    expect(settings.calls).toHaveLength(1)
    // The host remounts (a fresh invocation closure) while we are installed:
    // the next call must reach the NEW closure, never a stale snapshot.
    let remounted = false
    Object.defineProperty(settings, 'openSettingsDocument', {
      configurable: true,
      enumerable: true,
      get: () => () => {
        remounted = true
        return Promise.resolve({ ok: true, value: { opened: true } } as RemoteSettingsOpenResult)
      },
    })
    await settings.openSettingsDocument!()
    expect(remounted).toBe(true)
    stop()
  })

  it('a namespace without the mounted method installs nothing (fail-soft seam)', () => {
    // No own property at all…
    const bare = {} as RemoteSettingsLike
    expect(() => wrapRemoteOpenSettingsDocument(bare, {
      takeoverEnabled: () => true,
      resolvePath: () => { throw new Error('must not resolve') },
      reroute: () => { throw new Error('must not reroute') },
    })()).not.toThrow()
    expect('openSettingsDocument' in bare).toBe(false)
    // …a plain value property (a foreign runtime shape)…
    const valued = {
      openSettingsDocument: () => Promise.resolve({ ok: true, value: { opened: true } }),
    } as unknown as RemoteSettingsLike
    const valuedOriginal = valued.openSettingsDocument
    expect(() => wrapRemoteOpenSettingsDocument(valued, {
      takeoverEnabled: () => true,
      resolvePath: () => { throw new Error('must not resolve') },
      reroute: () => { throw new Error('must not reroute') },
    })()).not.toThrow()
    expect(valued.openSettingsDocument).toBe(valuedOriginal)
    // …and a getter that yields a non-function.
    const odd = { get openSettingsDocument() { return 42 } } as unknown as RemoteSettingsLike
    expect(() => wrapRemoteOpenSettingsDocument(odd, {
      takeoverEnabled: () => true,
      resolvePath: () => { throw new Error('must not resolve') },
      reroute: () => { throw new Error('must not reroute') },
    })()).not.toThrow()
    expect(odd.openSettingsDocument).toBe(42)
  })

  it('wrappers compose and unwrap in stack order', () => {
    const settings = makeRemoteSettings()
    const original = Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')
    const stopOuter = wrapRemoteOpenSettingsDocument(settings, {
      takeoverEnabled: () => false,
      resolvePath: () => Promise.resolve('/x'),
      reroute: () => {},
    })
    const outer = Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')?.get
    const stopInner = wrapRemoteOpenSettingsDocument(settings, {
      takeoverEnabled: () => false,
      resolvePath: () => Promise.resolve('/x'),
      reroute: () => {},
    })
    expect(Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')?.get).not.toBe(outer)
    stopInner()
    expect(Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')?.get).toBe(outer)
    stopOuter()
    expect(Object.getOwnPropertyDescriptor(settings, 'openSettingsDocument')).toEqual(original)
  })
})

describe('closeSettingsDialog (the settings modal close seam)', () => {
  /** A recording document double: notes every dispatched event. */
  function makeDoc() {
    const events: Array<unknown> = []
    return {
      events,
      dispatchEvent(event: unknown): boolean {
        events.push(event)
        return true
      },
    }
  }

  it('dispatches one bubbling Escape keydown on the document', () => {
    const doc = makeDoc()
    closeSettingsDialog(doc, (type, init) => ({ type, ...init }))
    expect(doc.events).toEqual([{ type: 'keydown', key: 'Escape', bubbles: true }])
  })

  it('is a no-op without a document (non-browser environments)', () => {
    expect(closeSettingsDialog(undefined, (type, init) => ({ type, ...init }))).toBeUndefined()
  })

  it('swallows a throwing event factory or dispatch (fail-soft: the dialog just stays)', () => {
    const doc = makeDoc()
    expect(() => closeSettingsDialog(doc, () => { throw new Error('no KeyboardEvent here') })).not.toThrow()
    expect(doc.events).toEqual([])
  })
})
