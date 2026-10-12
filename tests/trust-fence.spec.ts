/**
 * Unit tests for the browser-trust fence mirror (src/trust-fence.ts) —
 * the plugin-side twin of the /api gateway fence in
 * @deepseek-ai/dsh-client-connection — and for bindFenceAuthorities, the
 * cross-generation trustedHosts binding (webRuntime ≤0.2.0 / webStartup
 * ≥0.2.1).
 *
 * The fence tests pin the three acceptance families (loopback,
 * trustedHosts entry, the listener's own bind literal — the 0.2.x
 * replacement for ≤0.2.0's auto-broadcast LAN addresses) plus the
 * protocol-aware default-port normalization native-HTTPS listeners need,
 * and the marker checks (cross-site refusal, scheme-aware Origin
 * comparison) that every acceptance family still passes through.
 *
 * @module dsh-sidebar-vscode/tests/trust-fence.spec
 */

import { describe, expect, it } from 'vitest'
import {
  bindFenceAuthorities,
  isLoopbackHostname,
  isTrustedApiRequest,
} from '../src/trust-fence.ts'

/** One request shaped as the fence reads it. */
function request(headers: Record<string, string>): { headers: Record<string, string> } {
  return { headers }
}

// ---- loopback classification ───────────────────────────────────────────────

describe('isLoopbackHostname', () => {
  it('accepts localhost, IPv6 loopback, and any 127/8 address', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.1.2.3')).toBe(true)
  })

  it('refuses remote hosts and malformed quads', () => {
    expect(isLoopbackHostname('10.0.0.7')).toBe(false)
    expect(isLoopbackHostname('app.example')).toBe(false)
    expect(isLoopbackHostname('127.0.0.256')).toBe(false)
    expect(isLoopbackHostname('127.0.0')).toBe(false)
    expect(isLoopbackHostname('[fe80::1]')).toBe(false)
  })
})

// ---- the Host fence: loopback / trustedHosts ───────────────────────────────

describe('isTrustedApiRequest: host acceptance', () => {
  it('accepts a loopback Host with no browser markers', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'localhost:3080' }), [])).toBe(true)
    expect(isTrustedApiRequest(request({ host: '[::1]:3080' }), [])).toBe(true)
  })

  it('refuses a missing or unparsable Host', () => {
    expect(isTrustedApiRequest(request({}), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'not a host' }), [])).toBe(false)
  })

  it('refuses a remote Host with no matching trusted entry', () => {
    expect(isTrustedApiRequest(request({ host: 'app.example:3080' }), [])).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'app.example:3080' }), ['other.example'])).toBe(false)
  })

  it('matches a port-less entry on any port, an explicit port only on itself', () => {
    expect(isTrustedApiRequest(request({ host: 'app.example:3080' }), ['app.example'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'app.example:9999' }), ['app.example'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'app.example:3080' }), ['app.example:3080'])).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'app.example:9999' }), ['app.example:3080'])).toBe(false)
    // A port-less Host never matches an explicit-port entry.
    expect(isTrustedApiRequest(request({ host: 'app.example' }), ['app.example:3080'])).toBe(false)
  })

  it('normalizes a redundant scheme-default port inside a trusted entry', () => {
    // `:443` is the https default, so the entry stays port-less-equivalent
    // when the fence parses under the https listener protocol.
    expect(isTrustedApiRequest(request({ host: 'app.example' }, ), ['app.example:443'], undefined, 'https:')).toBe(true)
    expect(isTrustedApiRequest(request({ host: 'app.example:8443' }), ['app.example:443'], undefined, 'https:')).toBe(false)
    // Under an http listener the same `:443` is an explicit port.
    expect(isTrustedApiRequest(request({ host: 'app.example' }), ['app.example:443'])).toBe(false)
  })
})

// ---- the Host fence: the listener's own bind literal (dsh ≥0.2.1) ──────────

describe('isTrustedApiRequest: bind-address acceptance', () => {
  it('accepts the bind literal on any port with empty trustedHosts', () => {
    // The `--host 10.0.0.7` deployment: /api accepts, and now so does this
    // plugin's routes and proxy legs.
    expect(isTrustedApiRequest(request({ host: '10.0.0.7:3080' }), [], '10.0.0.7')).toBe(true)
    expect(isTrustedApiRequest(request({ host: '10.0.0.7:49152' }), [], '10.0.0.7')).toBe(true)
    expect(isTrustedApiRequest(request({ host: '10.0.0.7' }), [], '10.0.0.7')).toBe(true)
  })

  it('brackets an unbracketed IPv6 bind literal and strips its %zone', () => {
    expect(isTrustedApiRequest(request({ host: '[fe80::1]:3080' }), [], 'fe80::1')).toBe(true)
    expect(isTrustedApiRequest(request({ host: '[fe80::1]:3080' }), [], 'fe80::1%eth0')).toBe(true)
    expect(isTrustedApiRequest(request({ host: '[fe80::aa]:3080' }), [], 'fe80::1')).toBe(false)
  })

  it('refuses a different remote Host even when a bind literal is present', () => {
    expect(isTrustedApiRequest(request({ host: '10.0.0.8:3080' }), [], '10.0.0.7')).toBe(false)
    expect(isTrustedApiRequest(request({ host: 'app.example:3080' }), [], '10.0.0.7')).toBe(false)
  })

  it('never accepts the bind literal without passing the marker checks', () => {
    expect(isTrustedApiRequest(
      request({ host: '10.0.0.7:3080', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' }),
      [], '10.0.0.7',
    )).toBe(false)
    expect(isTrustedApiRequest(
      request({ host: '10.0.0.7:3080', origin: 'http://evil.example' }),
      [], '10.0.0.7',
    )).toBe(false)
    // Same-origin passes.
    expect(isTrustedApiRequest(
      request({ host: '10.0.0.7:3080', origin: 'http://10.0.0.7:3080' }),
      [], '10.0.0.7',
    )).toBe(true)
  })

  it('treats an absent bind literal (dsh ≤0.2.0 face) exactly as before', () => {
    expect(isTrustedApiRequest(request({ host: '10.0.0.7:3080' }), [])).toBe(false)
  })
})

// ---- the browser-marker fences ─────────────────────────────────────────────

describe('isTrustedApiRequest: browser markers', () => {
  it('refuses an explicit cross-site marker regardless of a passing Host', () => {
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }), [],
    )).toBe(false)
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site', origin: 'http://127.0.0.1:3080' }), [],
    )).toBe(false)
  })

  it('accepts an absent Origin (the Host fence already bound the request)', () => {
    expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), [])).toBe(true)
  })

  it('compares Origin against Host under the Origin\'s own scheme', () => {
    // Default ports normalize per scheme: https origin vs https-parsed host.
    expect(isTrustedApiRequest(
      request({ host: 'app.example:443', origin: 'https://app.example' }),
      ['app.example'], undefined, 'https:',
    )).toBe(true)
    // The redundant :443 also matches when the listener still speaks plain
    // HTTP (an HTTPS proxy front): the comparison re-parses Host under the
    // ORIGIN's scheme, where 443 is again the default.
    expect(isTrustedApiRequest(
      request({ host: 'app.example:443', origin: 'https://app.example' }),
      ['app.example:443'],
    )).toBe(true)
    // A genuinely different authority still refuses.
    expect(isTrustedApiRequest(
      request({ host: 'app.example:8443', origin: 'https://app.example' }),
      ['app.example:8443'], undefined, 'https:',
    )).toBe(false)
    // An http Origin behind an https-proxied listener still names the same authority.
    expect(isTrustedApiRequest(
      request({ host: 'app.example:8443', origin: 'http://app.example:8443' }),
      ['app.example:8443'], undefined, 'https:',
    )).toBe(true)
  })

  it('refuses non-http(s) Origins instead of matching by hostname alone', () => {
    // file: origins name a path, never this listener.
    expect(isTrustedApiRequest(
      request({ host: 'localhost:3080', origin: 'file://localhost' }), [],
    )).toBe(false)
    expect(isTrustedApiRequest(
      request({ host: 'localhost:3080', origin: 'ftp://localhost:3080' }), [],
    )).toBe(false)
  })

  it('refuses an Origin naming a different authority', () => {
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' }), [],
    )).toBe(false)
    expect(isTrustedApiRequest(
      request({ host: '127.0.0.1:3080', origin: 'http://evil.example' }), [],
    )).toBe(false)
  })
})

// ---- bindFenceAuthorities: the cross-generation trustedHosts binding ───────

describe('bindFenceAuthorities', () => {
  /** A cordis-shaped ctx.inject double: the callback fires only for a
   * service this fake "has", with a scoped context exposing it. */
  function ctxWith(services: Record<string, unknown>): {
    calls: Array<{ deps: readonly string[] }>,
    inject(deps: readonly string[], callback: (scoped: unknown) => void): unknown
  } {
    const calls: Array<{ deps: readonly string[] }> = []
    return {
      calls,
      inject(deps: readonly string[], callback: (scoped: unknown) => void): unknown {
        calls.push({ deps })
        const dep = deps[0]
        if (dep !== undefined && Object.prototype.hasOwnProperty.call(services, dep)) {
          callback({ [dep]: services[dep] })
        }
        return undefined
      },
    }
  }

  it('binds both service generations with one scoped inject each', () => {
    const ctx = ctxWith({})
    bindFenceAuthorities(ctx)
    expect(ctx.calls.map(call => call.deps)).toEqual([['webRuntime'], ['webStartup']])
  })

  it('answers [] before either service exists (fail-closed loopback fence)', () => {
    expect(bindFenceAuthorities(ctxWith({}))()).toEqual([])
  })

  it('reads trustedHosts off the 0.2.1 webStartup shape', () => {
    const ctx = ctxWith({ webStartup: { trustedHosts: ['app.example'], openBrowser: true } })
    expect(bindFenceAuthorities(ctx)()).toEqual(['app.example'])
  })

  it('reads trustedHosts off the ≤0.2.0 webRuntime shape (lanAddresses era)', () => {
    const ctx = ctxWith({ webRuntime: { trustedHosts: ['192.168.1.5', 'app.example'] } })
    expect(bindFenceAuthorities(ctx)()).toEqual(['192.168.1.5', 'app.example'])
  })

  it('degrades a service without trustedHosts to []', () => {
    const ctx = ctxWith({ webStartup: { openBrowser: false } })
    expect(bindFenceAuthorities(ctx)()).toEqual([])
  })

  it('keeps the last-bound value when a later callback fires', () => {
    const services: Record<string, unknown> = { webStartup: { trustedHosts: ['first.example'] } }
    const ctx = ctxWith(services)
    const get = bindFenceAuthorities(ctx)
    expect(get()).toEqual(['first.example'])
    services.webStartup = { trustedHosts: ['second.example'] }
    expect(bindFenceAuthorities(ctxWith(services))()).toEqual(['second.example'])
  })

  it('the getter stays live for the bound context (re-fire replaces the value)', () => {
    const scoped: { webStartup?: { trustedHosts: readonly string[] } } = {}
    const calls: Array<(scoped: unknown) => void> = []
    const ctx = {
      inject(deps: readonly string[], callback: (s: unknown) => void): unknown {
        if (deps[0] === 'webStartup') calls.push(callback)
        return undefined
      },
    }
    const get = bindFenceAuthorities(ctx)
    expect(get()).toEqual([])
    scoped.webStartup = { trustedHosts: ['a.example'] }
    for (const fire of calls) fire(scoped)
    expect(get()).toEqual(['a.example'])
    scoped.webStartup = { trustedHosts: ['b.example'] }
    for (const fire of calls) fire(scoped)
    expect(get()).toEqual(['b.example'])
  })
})
