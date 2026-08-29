/**
 * Integration tests for the same-origin `/vscode` reverse proxy: fake
 * serve-web instances (fixture HTML, echo routes, token enforcement, raw
 * socket upgrade echo) behind the proxy's captured webserver
 * registrations, driven through a real front-side node:http server —
 * covering upstream parsing, mount planning, plain HTTP forwarding with
 * token append, the 101 handshake relay, base-path mirrors, the root-path
 * discovery shim, and the settings-driven configure()/reset flow.
 *
 * @module dsh-sidebar-vscode/tests/vscodeProxy.spec
 */

import { createServer, globalAgent } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connect as tcpConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_UPSTREAM,
  UPSTREAM_ENV,
  createVscodeProxy,
  discoverResourcePrefix,
  discoverServerBasePath,
  isDisabledValue,
  mapRequestUrl,
  parseUpstreamUrl,
  staticMounts,
  upgradePathFor,
  type ProxyPluginContext,
  type UpstreamConfig,
} from '../src/vscodeProxy.ts'

/** Fixture commit (40 hex chars, like a real VS Code commit). */
const COMMIT_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const COMMIT_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

/** Fixture index HTML referencing the given resource prefix. */
function indexHtml(commit: string, base: string): string {
  const baked = base === '' ? '/' : base
  return `<!DOCTYPE html><html><head>
<meta id="vscode-workbench-web-configuration" data-settings="{&quot;serverBasePath&quot;:&quot;${baked}&quot;,&quot;remoteAuthority&quot;:&quot;127.0.0.1:1&quot;}" />
<link rel="apple-touch-icon" href="${base}/stable-${commit}/static/resources/server/code-192.png" />
<script src="${base}/stable-${commit}/static/out/vs/code/browser/workbench/workbench.js"></script>
</head><body></body></html>`
}

/** The fake upstream's shape: where it serves and whether it demands tkn. */
interface UpstreamOptions {
  basePath?: string
  token?: string
  /** Serve the workbench HTML at `/` too (what a real base-pathed
   * `code serve-web` does — the page still bakes its own base path). */
  serveRootPage?: boolean
  /** Delay the index page answer in ms (simulates a slow/booting serve-web). */
  delayMs?: number
  /** Answer every request with a 302 to this location (a redirecting gateway). */
  redirectTo?: string
}

/** A fake serve-web: HTML at <base>/, echo at <base>/echo, upgrade echo. */
interface FakeUpstream {
  readonly port: number
  setCommit(commit: string): void
  /** How many index pages this upstream has served. */
  pageHits(): number
  destroyUpgraded(): void
  close(): Promise<void>
}

/** Every server started by the current test (afterEach closes them all). */
const upstreams: FakeUpstream[] = []

async function fakeUpstream(options: UpstreamOptions = {}): Promise<FakeUpstream> {
  const basePath = options.basePath ?? '/vscode'
  const token = options.token
  let currentHtml = indexHtml(COMMIT_A, basePath)
  let pageHits = 0
  const upgraded = new Set<Duplex>()
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (options.redirectTo !== undefined) {
      res.writeHead(302, { location: options.redirectTo })
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (token !== undefined && url.searchParams.get('tkn') !== token) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('token required')
      return
    }
    const pathname = url.pathname
    if (pathname === basePath || pathname === `${basePath}/`
      || (options.serveRootPage === true && (pathname === '/' || pathname === ''))) {
      pageHits += 1
      const send = (): void => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-proxied-host': String(req.headers.host ?? '') })
        res.end(currentHtml)
      }
      if ((options.delayMs ?? 0) > 0) {
        setTimeout(send, options.delayMs)
        return
      }
      send()
      return
    }
    if (pathname === `${basePath}/echo` || (basePath === '' && pathname === '/echo')) {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' })
        res.end(Buffer.concat([Buffer.from(`path=${req.url} body=`), ...chunks]))
      })
      return
    }
    if (/\/stable-[0-9a-f]{40}(\/|$)/.test(pathname)) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(`asset:${pathname}`)
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    upgraded.add(socket)
    socket.on('close', () => { upgraded.delete(socket) })
    if (new URL(req.url ?? '/', 'http://x').searchParams.get('reconnectionToken') === null) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.end()
      return
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: fixture\r\n\r\n')
    if (head.length > 0) socket.write(head)
    socket.on('data', (chunk: Buffer) => { socket.write(chunk) })
    socket.on('error', () => { socket.destroy() })
  })
  const fake = await new Promise<FakeUpstream>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        setCommit(commit: string) { currentHtml = indexHtml(commit, basePath) },
        pageHits: () => pageHits,
        destroyUpgraded() { for (const socket of upgraded) socket.destroy() },
        close: () => new Promise<void>((done) => {
          server.close()
          server.closeAllConnections()
          done()
        }),
      })
    })
  })
  upstreams.push(fake)
  return fake
}

/** Capture webserver registrations; the API the proxy actually calls. */
function makeWebServerFace() {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
  const upgrades = new Map<string, (req: IncomingMessage, socket: Duplex, head: Buffer) => void>()
  return {
    routes,
    upgrades,
    webServer: {
      register(route: { kind: string, path: string, handler: (req: IncomingMessage, res: ServerResponse) => void }): () => void {
        if (routes.has(route.path)) throw new Error(`duplicate ${route.kind} route "${route.path}"`)
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
      registerUpgrade(route: { path: string, handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void }): () => void {
        if (upgrades.has(route.path)) throw new Error(`duplicate upgrade route "${route.path}"`)
        upgrades.set(route.path, route.handler)
        return () => { upgrades.delete(route.path) }
      },
    },
  }
}

/** A minimal structural plugin context: effect bookkeeping + silent logger. */
function makeContext(face: ReturnType<typeof makeWebServerFace>) {
  const disposers: (() => void)[] = []
  return {
    effect(setup: () => (() => void) | void): () => void {
      const stop = setup()
      if (typeof stop === 'function') disposers.push(stop)
      return () => {}
    },
    logger: { info: vi.fn(), warn: vi.fn() },
    webServer: face.webServer,
    disposers,
  }
}

/** The front server standing in for `dsh web`: routes + upgrade dispatch. */
async function startFront(face: ReturnType<typeof makeWebServerFace>): Promise<{ server: ReturnType<typeof createServer>, port: number, destroyUpgraded(): void }> {
  const upgraded = new Set<Duplex>()
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const exact = face.routes.get(pathname)
    if (exact !== undefined) {
      void exact(req, res)
      return
    }
    for (const [prefix, handler] of face.routes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        void handler(req, res)
        return
      }
    }
    res.writeHead(404)
    res.end()
  })
  server.on('upgrade', (req, socket, head) => {
    upgraded.add(socket)
    socket.on('close', () => { upgraded.delete(socket) })
    const handler = face.upgrades.get(new URL(req.url ?? '/', 'http://x').pathname)
    if (handler === undefined) {
      socket.destroy()
      return
    }
    void handler(req, socket, head)
  })
  return await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        destroyUpgraded() { for (const socket of upgraded) socket.destroy() },
      })
    })
  })
}

/** Drive one raw WebSocket handshake; resolves the handshake transcript. */
function rawUpgrade(port: number, path: string): { done: Promise<string>, send(data: string): void, socket: import('node:net').Socket } {
  const socket = tcpConnect(port, '127.0.0.1')
  const chunks: Buffer[] = []
  const done = new Promise<string>((resolve, reject) => {
    socket.on('error', reject)
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const text = Buffer.concat(chunks).toString('latin1')
      if (text.includes('\r\n\r\n')) resolve(text)
    })
    setTimeout(() => { reject(new Error('handshake timeout')) }, 3000)
  })
  socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
  return { done, send: data => { socket.write(data) }, socket }
}

/** Await one predicate (10ms polling, 3s budget). */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
}

/** The shared fixture: one default fake upstream + one front server. */
let upstream: FakeUpstream
let face: ReturnType<typeof makeWebServerFace>
let ctx: ReturnType<typeof makeContext>
let front: Awaited<ReturnType<typeof startFront>>

beforeEach(async () => {
  upstream = await fakeUpstream()
  face = makeWebServerFace()
  ctx = makeContext(face)
  front = await startFront(face)
  process.env[UPSTREAM_ENV] = `http://127.0.0.1:${upstream.port}/vscode`
})

afterEach(async () => {
  delete process.env[UPSTREAM_ENV]
  // Node's closeAllConnections() skips upgrade-state sockets (the same
  // caveat the webserver package works around) and the proxy's client
  // agent holds keep-alive upstream connections: destroy both, then close.
  front.destroyUpgraded()
  for (const fake of upstreams) {
    fake.destroyUpgraded()
    await fake.close()
  }
  upstreams.length = 0
  front.server.close()
  front.server.closeAllConnections()
  globalAgent.destroy()
  vi.restoreAllMocks()
})

describe('upstream URL parsing', () => {
  it('unset env falls back to the documented default (bare local serve-web)', () => {
    expect(parseUpstreamUrl(DEFAULT_UPSTREAM)).toEqual({
      origin: 'http://127.0.0.1:8000',
      basePath: '',
      extraQuery: [],
    })
  })

  it('full serve-web address: base path and tkn token captured', () => {
    expect(parseUpstreamUrl('http://127.0.0.1:8000/vscode/?tkn=abc123')).toEqual({
      origin: 'http://127.0.0.1:8000',
      basePath: '/vscode',
      extraQuery: [['tkn', 'abc123']],
    })
  })

  it('root upstream (no --server-base-path) yields the empty base path', () => {
    expect(parseUpstreamUrl('http://localhost:8000/?tkn=x')).toEqual({
      origin: 'http://localhost:8000',
      basePath: '',
      extraQuery: [['tkn', 'x']],
    })
  })

  it('https, custom paths, and extra query pairs survive', () => {
    expect(parseUpstreamUrl('https://editor.lan:9443/code/?tkn=a&other=b')).toEqual({
      origin: 'https://editor.lan:9443',
      basePath: '/code',
      extraQuery: [['tkn', 'a'], ['other', 'b']],
    })
  })

  it('garbage, other schemes, and empty input are rejected', () => {
    expect(parseUpstreamUrl('not a url')).toBeNull()
    expect(parseUpstreamUrl('ftp://127.0.0.1:8000')).toBeNull()
    expect(parseUpstreamUrl('')).toBeNull()
    expect(parseUpstreamUrl(undefined)).toBeNull()
  })

  it('embedded credentials are rejected (they could never be forwarded)', () => {
    expect(parseUpstreamUrl('http://user:pass@127.0.0.1:8000/vscode')).toBeNull()
  })

  it('off-like sentinels disable the feature', () => {
    for (const value of ['off', 'OFF', '0', 'false', 'disabled', 'no']) {
      expect(isDisabledValue(value)).toBe(true)
    }
    expect(isDisabledValue('http://127.0.0.1:8000')).toBe(false)
  })
})

describe('mount planning', () => {
  const base = (basePath: string): UpstreamConfig => ({ origin: 'http://x:1', basePath, extraQuery: [] })

  it('canonical /vscode upstream: the mount plus an identity mirror at /vscode', () => {
    expect(staticMounts(base('/vscode'))).toEqual([
      { prefix: '/sidebar/vscode', upstreamBase: '/vscode' },
      { prefix: '/vscode', upstreamBase: '/vscode' },
    ])
    expect(upgradePathFor(base('/vscode'), 'stable-x')).toBe('/vscode/stable-x')
  })

  it('custom base path gains an identity mirror beside the mount', () => {
    expect(staticMounts(base('/code'))).toEqual([
      { prefix: '/sidebar/vscode', upstreamBase: '/code' },
      { prefix: '/code', upstreamBase: '/code' },
    ])
    expect(upgradePathFor(base('/code'), 'stable-x')).toBe('/code/stable-x')
  })

  it('root upstream mounts without a mirror (the shim is discovered)', () => {
    expect(staticMounts(base(''))).toEqual([{ prefix: '/sidebar/vscode', upstreamBase: '' }])
    expect(upgradePathFor(base(''), 'stable-x')).toBe('/stable-x')
  })

  it('mapRequestUrl rewrites paths and appends missing query pairs', () => {
    const mounts = staticMounts(base('/code'))
    expect(mapRequestUrl('/sidebar/vscode/?folder=%2Fw', mounts, [['tkn', 't']])).toBe('/code/?folder=%2Fw&tkn=t')
    expect(mapRequestUrl('/code/static/a.js?tkn=own', mounts, [['tkn', 't']])).toBe('/code/static/a.js?tkn=own')
    expect(mapRequestUrl('/sidebar/vscode', mounts, [])).toBe('/code/')
    expect(mapRequestUrl('/other/path', mounts, [])).toBeNull()
  })
})

describe('env-mode proxy end-to-end (canonical /vscode upstream)', () => {
  it('registers the mount, the mirror, and the base-path upgrade after probing', async () => {
    const handle = createVscodeProxy(ctx)
    await expect(handle.ready).resolves.toBe(true)
    expect(face.routes.has('/sidebar/vscode')).toBe(true)
    // The upstream's own base path also gets its identity mirror, so the
    // workbench's absolute /vscode/... references resolve same-origin.
    expect(face.routes.has('/vscode')).toBe(true)
    expect(face.upgrades.has(`/vscode/stable-${COMMIT_A}`)).toBe(true)
  })

  it('forwards GET bodies, queries, and the browser Host header verbatim', async () => {
    const handle = createVscodeProxy(ctx)
    await handle.ready
    const response = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/?folder=%2Fdata`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    // Transparent Host: serve-web bakes the DSH origin into the workbench.
    expect(response.headers.get('x-proxied-host')).toBe(`127.0.0.1:${front.port}`)
    expect(await response.text()).toContain(`stable-${COMMIT_A}`)
  })

  it('forwards POST bodies across a chunked upstream response', async () => {
    const handle = createVscodeProxy(ctx)
    await handle.ready
    const response = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/echo?x=1`, {
      method: 'POST',
      body: 'hello-upstream',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('path=/vscode/echo?x=1 body=hello-upstream')
  })

  it('claims nothing while the upstream is silent', async () => {
    process.env[UPSTREAM_ENV] = 'http://127.0.0.1:1/vscode'
    const handle = createVscodeProxy(ctx)
    await expect(handle.ready).resolves.toBe(false)
    expect(face.routes.size).toBe(0)
    expect(face.upgrades.size).toBe(0)
  })

  it('relays the 101 handshake and pipes bytes both ways', async () => {
    const handle = createVscodeProxy(ctx)
    await handle.ready
    const client = rawUpgrade(front.port, `/vscode/stable-${COMMIT_A}?reconnectionToken=tok1`)
    const head = await client.done
    expect(head.startsWith('HTTP/1.1 101')).toBe(true)
    expect(head).toContain('sec-websocket-accept: fixture')
    const echoed = new Promise<string>((resolve) => {
      const parts: Buffer[] = [Buffer.from(head)]
      client.socket.on('data', (chunk: Buffer) => {
        parts.push(chunk)
        resolve(Buffer.concat(parts).toString('latin1').slice(head.length))
      })
    })
    client.send('ping-both-ways')
    await expect(echoed).resolves.toContain('ping-both-ways')
    client.socket.destroy()
  })

  it('mirrors an upstream upgrade refusal', async () => {
    const handle = createVscodeProxy(ctx)
    await handle.ready
    const client = rawUpgrade(front.port, `/vscode/stable-${COMMIT_A}?no-token`)
    const head = await client.done
    expect(head.startsWith('HTTP/1.1 403')).toBe(true)
    client.socket.destroy()
  })

  it('refreshes the upgrade path after a serve-web version change', async () => {
    const handle = createVscodeProxy(ctx)
    await handle.ready
    expect(face.upgrades.has(`/vscode/stable-${COMMIT_A}`)).toBe(true)
    upstream.setCommit(COMMIT_B)
    await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/`)
    await waitFor(() => face.upgrades.has(`/vscode/stable-${COMMIT_B}`))
    const client = rawUpgrade(front.port, `/vscode/stable-${COMMIT_B}?reconnectionToken=tok2`)
    await expect(client.done).resolves.toContain('HTTP/1.1 101')
    client.socket.destroy()
  })

  it('the /vscode mirror serves the workbench absolute references', async () => {
    const handle = createVscodeProxy(ctx)
    await handle.ready
    const response = await fetch(`http://127.0.0.1:${front.port}/vscode/?folder=%2Fdata`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(`stable-${COMMIT_A}`)
  })

  it('status(): mounted with the mount prefix once serving, false while disabled', async () => {
    // envConfig is a creation-time snapshot (env read once at load): an
    // env=off handle stays idle no matter what the process env says later.
    process.env[UPSTREAM_ENV] = 'off'
    const handle = createVscodeProxy(ctx)
    await expect(handle.ready).resolves.toBe(false)
    expect(handle.status()).toEqual({ mounted: false, prefix: null, serving: false })
    // Settings mode claims the mount synchronously at configure() — but
    // `serving` stays false until its probe discovered the routes.
    handle.configure(parseUpstreamUrl(`http://127.0.0.1:${upstream.port}/vscode`)!)
    expect(handle.status().mounted).toBe(true)
    await waitFor(() => handle.status().serving)
    expect(handle.status()).toEqual({ mounted: true, prefix: '/sidebar/vscode', serving: true })
    // Dropping the settings upstream returns to the (idle) env default.
    handle.configure(null)
    expect(handle.status()).toEqual({ mounted: false, prefix: null, serving: false })
  })

  it('status(): the env default mounts once its probe succeeds', async () => {
    const handle = createVscodeProxy(ctx)
    expect(handle.status().mounted).toBe(false) // probe still in flight
    await handle.ready
    expect(handle.status()).toEqual({ mounted: true, prefix: '/sidebar/vscode', serving: true })
  })

  it('status(): serving stays false while an adopted upstream is unreachable (claimed but not serving)', async () => {
    // The boot-race shape: dsh web restarted together with serve-web, the
    // pushed/default upstream not answering yet — the mount is claimed
    // (honest 502s) but the iframe must stay on its direct fallback until
    // a probe actually succeeds (routes + discovery all live).
    const handle = createVscodeProxy(ctx)
    await handle.ready
    const dead = parseUpstreamUrl('http://127.0.0.1:1/vscode')!
    handle.configure(dead)
    expect(handle.status()).toEqual({ mounted: true, prefix: '/sidebar/vscode', serving: false })
  })

  it('disabled upstream claims nothing on the webserver', async () => {
    process.env[UPSTREAM_ENV] = 'off'
    const handle = createVscodeProxy(ctx)
    await expect(handle.ready).resolves.toBe(false)
    expect(face.routes.size).toBe(0)
    expect(face.upgrades.size).toBe(0)
  })
})

describe('settings-mode proxy end-to-end (configure via serverUrl)', () => {
  it('mounts a token-guarded upstream under a custom base path', async () => {
    const tokened = await fakeUpstream({ basePath: '/code', token: 'sekrit' })
    const handle = createVscodeProxy(ctx) // env mode points at the default fake
    await handle.ready
    expect(await handle.probeUpstream(parseUpstreamUrl(`http://127.0.0.1:${tokened.port}/code/?tkn=sekrit`)!)).not.toBeNull()
    handle.configure(parseUpstreamUrl(`http://127.0.0.1:${tokened.port}/code/?tkn=sekrit`))
    // Settings mode claims the static mounts immediately (honest 502s)…
    expect(face.routes.has('/sidebar/vscode')).toBe(true)
    expect(face.routes.has('/code')).toBe(true)
    // …and discovers the upgrade path on its own base path.
    await waitFor(() => face.upgrades.has(`/code/stable-${COMMIT_A}`))
    // The page loads through the mount with the token appended upstream.
    const page = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/?folder=%2Fw`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`stable-${COMMIT_A}`)
    // The workbench's absolute /code/... references hit the identity mirror.
    const asset = await fetch(`http://127.0.0.1:${front.port}/code/stable-${COMMIT_A}/static/out/x.js`)
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe(`asset:/code/stable-${COMMIT_A}/static/out/x.js`)
    // WebSocket connects at the base-path route the client computes.
    const client = rawUpgrade(front.port, `/code/stable-${COMMIT_A}?reconnectionToken=tok`)
    await expect(client.done).resolves.toContain('HTTP/1.1 101')
    client.socket.destroy()
  })

  it('without the token the upstream refuses, and the proxy relays the refusal', async () => {
    const tokened = await fakeUpstream({ basePath: '/vscode', token: 'sekrit' })
    const handle = createVscodeProxy(ctx)
    handle.configure(parseUpstreamUrl(`http://127.0.0.1:${tokened.port}/vscode`)!)
    const response = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/`)
    expect(response.status).toBe(403)
    expect(await handle.probeUpstream(parseUpstreamUrl(`http://127.0.0.1:${tokened.port}/vscode`)!)).toBeNull()
  })

  it('a root upstream (no base path) gets its shim after the awaited first page load', async () => {
    const root = await fakeUpstream({ basePath: '' })
    const handle = createVscodeProxy(ctx)
    await handle.ready
    handle.configure(parseUpstreamUrl(`http://127.0.0.1:${root.port}/`)!)
    // First page GET: the proxy awaits discovery before answering, so the
    // root-absolute resource prefix route exists by the time subresources
    // fire (the race the await exists to close).
    const page = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`stable-${COMMIT_A}`)
    expect(face.routes.has(`/stable-${COMMIT_A}`)).toBe(true)
    const asset = await fetch(`http://127.0.0.1:${front.port}/stable-${COMMIT_A}/static/out/x.js`)
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe(`asset:/stable-${COMMIT_A}/static/out/x.js`)
    // The browser socket factory connects at /<quality>-<commit> for root
    // upstreams — the exact upgrade path discovered and registered.
    expect(face.upgrades.has(`/stable-${COMMIT_A}`)).toBe(true)
    const client = rawUpgrade(front.port, `/stable-${COMMIT_A}?reconnectionToken=tok`)
    await expect(client.done).resolves.toContain('HTTP/1.1 101')
    client.socket.destroy()
  })

  it('unreachable settings upstream: honest 502 from the claimed route; reachability probe false', async () => {
    const handle = createVscodeProxy(ctx)
    await handle.ready
    const dead = parseUpstreamUrl('http://127.0.0.1:1/vscode')!
    expect(await handle.probeUpstream(dead)).toBeNull()
    handle.configure(dead)
    expect(face.routes.has('/sidebar/vscode')).toBe(true)
    const response = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/echo`)
    expect(response.status).toBe(502)
  })

  it('idle initial probe does not latch: configure() after env=off still works', async () => {
    // Regression: the initial probe with no upstream returns before its
    // first await; a latched inflight promise used to make every later
    // probe() return that stale false forever (no routes, no upgrades).
    process.env[UPSTREAM_ENV] = 'off'
    const handle = createVscodeProxy(ctx)
    await expect(handle.ready).resolves.toBe(false)
    handle.configure(parseUpstreamUrl(`http://127.0.0.1:${upstream.port}/vscode`)!)
    expect(face.routes.has('/sidebar/vscode')).toBe(true)
    await waitFor(() => face.upgrades.has(`/vscode/stable-${COMMIT_A}`))
    const page = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/`)
    expect(page.status).toBe(200)
    process.env[UPSTREAM_ENV] = `http://127.0.0.1:${upstream.port}/vscode`
  })

  it('root-URL default self-corrects against a base-pathed serve-web (HTML reconciliation)', async () => {
    // The zero-config story: serverUrl empty → default http://127.0.0.1:8000
    // (root URL), while the server actually runs --server-base-path /vscode.
    // A real serve-web answers `/` with the same `/vscode`-rooted page; the
    // probe must adopt the BAKED base for routing: mirror at /vscode, no
    // root shim, upgrade under /vscode.
    const based = await fakeUpstream({ basePath: '/vscode', serveRootPage: true })
    const handle = createVscodeProxy(ctx)
    await handle.ready
    handle.configure(parseUpstreamUrl(`http://127.0.0.1:${based.port}`)!)
    await waitFor(() => face.upgrades.has(`/vscode/stable-${COMMIT_A}`))
    expect(face.routes.has('/sidebar/vscode')).toBe(true)
    expect(face.routes.has('/vscode')).toBe(true)
    expect(face.routes.has(`/stable-${COMMIT_A}`)).toBe(false) // no root shim
    const page = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/?folder=%2Fw`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`stable-${COMMIT_A}`)
    const asset = await fetch(`http://127.0.0.1:${front.port}/vscode/stable-${COMMIT_A}/static/out/x.js`)
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe(`asset:/vscode/stable-${COMMIT_A}/static/out/x.js`)
    const client = rawUpgrade(front.port, `/vscode/stable-${COMMIT_A}?reconnectionToken=tok`)
    await expect(client.done).resolves.toContain('HTTP/1.1 101')
    client.socket.destroy()
  })

  it('configure(null) releases the routes back to the env/default upstream', async () => {
    const other = await fakeUpstream({ basePath: '/code' })
    const handle = createVscodeProxy(ctx)
    await handle.ready
    handle.configure(parseUpstreamUrl(`http://127.0.0.1:${other.port}/code`)!)
    await waitFor(() => face.upgrades.has(`/code/stable-${COMMIT_A}`))
    handle.configure(null)
    // Env mode re-registers through its (loopback-fast) probe loop.
    await waitFor(() => handle.status().serving)
    // Back to the env upstream's plan (mount plus /vscode mirror).
    expect(face.routes.has('/code')).toBe(false)
    expect(face.upgrades.has(`/code/stable-${COMMIT_A}`)).toBe(false)
    expect(face.routes.has('/sidebar/vscode')).toBe(true)
    expect(face.routes.has('/vscode')).toBe(true)
    expect(face.upgrades.has(`/vscode/stable-${COMMIT_A}`)).toBe(true)
  })
})

describe('probe hardening (stale discovery, redirects, seed reuse)', () => {
  it('discards a stale in-flight probe when configure() lands mid-fetch (no mixed routing)', async () => {
    // Regression: a probe started against the OLD upstream used to apply
    // the old page's base/commit to the NEW upstream after its await —
    // a mixed state that looked fully registered (serving:true) while the
    // page 404'd through the mount, until a manual reload. The
    // generation guard discards the stale discovery instead.
    const slow = await fakeUpstream({ basePath: '/vscode', delayMs: 300 })
    const root = await fakeUpstream({ basePath: '' })
    process.env[UPSTREAM_ENV] = `http://127.0.0.1:${slow.port}/vscode`
    const handle = createVscodeProxy(ctx) // initial probe(slow) in flight
    handle.configure(parseUpstreamUrl(`http://127.0.0.1:${root.port}`)!) // lands mid-fetch
    await expect(handle.ready).resolves.toBe(false) // stale discovery discarded
    // Settings mode claimed the static mount; the page GET drives the
    // fresh discovery (awaited) and must serve the NEW upstream's page.
    const page = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`stable-${COMMIT_A}`)
    expect(face.routes.has('/vscode')).toBe(false) // no stale mirror from the old base
    expect(face.upgrades.has(`/vscode/stable-${COMMIT_A}`)).toBe(false)
    expect(face.upgrades.has(`/stable-${COMMIT_A}`)).toBe(true)
  })

  it('follows index redirects and adopts the final origin (redirecting gateway)', async () => {
    const real = await fakeUpstream({ basePath: '/real' })
    const gate = await fakeUpstream({ basePath: '/gate', redirectTo: `http://127.0.0.1:${real.port}/real/` })
    process.env[UPSTREAM_ENV] = `http://127.0.0.1:${gate.port}/gate`
    const handle = createVscodeProxy(ctx)
    await expect(handle.ready).resolves.toBe(true)
    // Routing follows the FINAL page's HTML (base /real), not the gate
    // path, and forwarding adopts the final origin.
    expect(face.routes.has('/real')).toBe(true)
    expect(face.routes.has('/gate')).toBe(false)
    expect(face.upgrades.has(`/real/stable-${COMMIT_A}`)).toBe(true)
    const page = await fetch(`http://127.0.0.1:${front.port}/sidebar/vscode/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`stable-${COMMIT_A}`)
    const asset = await fetch(`http://127.0.0.1:${front.port}/real/stable-${COMMIT_A}/static/out/x.js`)
    expect(asset.status).toBe(200)
  })

  it('configure() reuses the route-fetched index — discovery does not refetch the page', async () => {
    const handle = createVscodeProxy(ctx)
    await handle.ready
    const target = parseUpstreamUrl(`http://127.0.0.1:${upstream.port}/vscode`)!
    const fetched = await handle.probeUpstream(target)
    expect(fetched).not.toBeNull()
    const before = upstream.pageHits()
    handle.configure(target, fetched ?? undefined)
    await waitFor(() => handle.status().serving)
    expect(upstream.pageHits()).toBe(before) // the seed satisfied discovery
  })
})

describe('resource prefix discovery', () => {
  it('extracts quality-commit from the index HTML', () => {
    expect(discoverResourcePrefix(indexHtml(COMMIT_A, '/vscode'))).toBe(`stable-${COMMIT_A}`)
  })

  it('null when nothing references a versioned resource', () => {
    expect(discoverResourcePrefix('<html><body>hi</body></html>')).toBeNull()
  })
})

describe('server base path discovery', () => {
  it('reads the escaped data-settings form (what serve-web bakes)', () => {
    expect(discoverServerBasePath(indexHtml(COMMIT_A, '/vscode'))).toBe('/vscode')
    expect(discoverServerBasePath(indexHtml(COMMIT_A, ''))).toBe('')
  })

  it('reads the plain JSON spelling and normalizes root', () => {
    expect(discoverServerBasePath(`{"serverBasePath":"/code"}`)).toBe('/code')
    expect(discoverServerBasePath(`{"serverBasePath":"/"}`)).toBe('')
    expect(discoverServerBasePath('<html>nothing baked</html>')).toBe('')
  })
})
