/**
 * `dsh-sidebar-vscode`, node half: the vscode-selection context boundary,
 * the extension command channel's fenced routes, and the same-origin
 * VS Code reverse proxy.
 *
 * Everything UI-shaped (the better-sidebar VS Code tab, the composer
 * chips, the reference rail, the chat-open interception) lives in the
 * browser half. This half owns:
 *
 * - the model-facing seam: for every live agent it listens at
 *   `agent/pre-step`, expands canonical `dsh-vscode:` (editor selections)
 *   and `dsh-vscode-res:` (explorer file/folder) mentions in the claimed
 *   user messages into readable labels plus bounded `<text-selection>`
 *   context messages sourced `{ kind: 'vscode-mention', … }` — or, for
 *   resources, content-less `<file-selection>`/`<folder-selection>`
 *   markers sourced `{ kind: 'vscode-resource', … }` (see `src/mention.ts`);
 *
 * - the fenced route family under `/sidebar-vscode/api/*`, dispatched
 *   through one method table (METHODS below): the open-channel probes and
 *   commands (`open.capability` / `open.request` / `open.embedded`), the
 *   boot gate pair (`boot.begin` / `boot.status`) that gates the iframe
 *   reveal on the extension's post-reconcile boot receipt, the proxy
 *   control plane (`proxy.config` / `proxy.status`), and the settings
 *   document locator (`settings.document`) for the browser-half takeover
 *   of the settings page's「打开配置文件」button — all behind the same
 *   browser-trust fence as every other plugin route;
 *
 * - the same-origin VS Code reverse proxy (see `src/vscodeProxy.ts`),
 *   mounted at `/sidebar/vscode`: an HTTP prefix route plus the discovered
 *   WebSocket upgrade path, so gateway-less deployments (Windows, LAN)
 *   still get a same-origin workbench iframe. `/sidebar-vscode/api/
 *   proxy.config` lets the browser half push the `serverUrl` setting (a
 *   full serve-web URL, base path + token) as the proxy's upstream, with a
 *   bounded reachability probe in the answer; `proxy.status` reports the
 *   live mounting state for the iframe-base choice.
 *
 * @module dsh-sidebar-vscode
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
// Type-only: brings the agent event and PreStepDecision declarations in.
import type {} from '@deepseek-ai/dsh-agent'
import { createFileRangeReader, vscodeMentionPreStep } from './mention.ts'
import {
  OPEN_CHANNEL_BASE,
  parseOpenCommand,
  readBootLedger,
  readBootStatus,
  readCapabilityMarker,
  writeBootRequest,
  writeEmbeddedBoot,
  writeOpenCommand,
  writeUserInteract,
} from './openChannel.ts'
import { NONCE_MAX_LENGTH } from './shared/protocol.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import {
  createVscodeProxy,
  parseUpstreamUrl,
  type ProxyPluginContext,
  type VscodeProxyHandle,
  PROXY_MOUNT,
} from './vscodeProxy.ts'

/** Cordis plugin name (the Loader entry; matches the client bundle id). */
export const name = 'dsh-sidebar-vscode'

/** Services required before load: the agent registry (agent/created
 * events), the webserver (command-channel routes), and the web runtime
 * (the trust fence's live trustedHosts). */
export const inject = ['agents', 'webServer', 'webRuntime']

/** The route family this half owns on the webserver. */
const API_PREFIX = '/sidebar-vscode/api/'

/** One JSON answer over the response stream. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** The error answer every route failure renders as. */
function errorBody(code: string, message: string): { ok: false, error: { code: string, message: string } } {
  return { ok: false, error: { code, message } }
}

/** Read one request body as JSON, capped (the payloads are tiny). */
async function readJsonBody(req: IncomingMessage, limit = 4096): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > limit) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** The route face the node half touches (structural over the services). */
interface HostContextFace {
  webServer: {
    register(route: {
      kind: 'prefix' | 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
    }): () => void
  }
  webRuntime: { trustedHosts: readonly string[] }
  /** The settings provider face this plugin reads (prepareDocument only). */
  get(name: 'settings'): { prepareDocument(): Promise<string | undefined> } | undefined
}

// ---- the route method table ────────────────────────────────────────────────
//
// One entry per POST method under the prefix: it validates its own payload
// (throwing ApiError for client errors) and resolves to the `value` of the
// `{ok: true, value}` envelope — or undefined for a bare `{ok: true}`. The
// dispatcher owns everything mechanical: the fence, the method lookup, body
// reading, and error shaping — adding a route is adding one entry here.

/** A client-error answer the dispatcher renders with its status and code. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** The per-call services the methods touch. */
interface MethodTools {
  proxy: VscodeProxyHandle
  settings: { prepareDocument(): Promise<string | undefined> } | undefined
}

/** One route method: validate the payload, resolve the envelope `value`. */
type ApiMethod = (payload: unknown, tools: MethodTools) => Promise<unknown>

/** The request body as a record (a non-object body reads as empty). */
function asRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {}
  return payload as Record<string, unknown>
}

/** The `folder` field of one open-channel probe (non-empty string). */
function folderField(payload: unknown): string {
  const folder = asRecord(payload).folder
  if (typeof folder !== 'string' || folder === '') {
    throw new ApiError(400, 'bad-request', 'folder must be a non-empty string')
  }
  return folder
}

/** The `folder` + `nonce` pair the boot-gate routes both require. */
function bootFields(payload: unknown): { folder: string, nonce: string } {
  const { folder, nonce } = asRecord(payload)
  if (typeof folder !== 'string' || !folder.startsWith('/')) {
    throw new ApiError(400, 'bad-request', 'folder must be an absolute path')
  }
  if (typeof nonce !== 'string' || nonce === '' || nonce.length > NONCE_MAX_LENGTH) {
    throw new ApiError(400, 'bad-request', `nonce must be a non-empty string of at most ${NONCE_MAX_LENGTH} characters`)
  }
  return { folder, nonce }
}

/** The absolute `folder` field of the embedded-boot stamp. */
function absoluteFolderField(payload: unknown): string {
  const folder = asRecord(payload).folder
  if (typeof folder !== 'string' || !folder.startsWith('/')) {
    throw new ApiError(400, 'bad-request', 'folder must be an absolute path')
  }
  return folder
}

/**
 * The method table. See the module doc for the route family's purpose;
 * each body is the exact behavior of the long if-chain it replaces.
 */
const METHODS: Record<string, ApiMethod> = {
  'proxy.status': async (_payload, { proxy }) => proxy.status(),

  'proxy.config': async (payload, { proxy }) => {
    const record = asRecord(payload)
    if (record.reset === true) {
      proxy.configure(null)
      return { mounted: null }
    }
    if (typeof record.url !== 'string' || record.url.trim() === '') {
      throw new ApiError(400, 'bad-request', 'url must be a non-empty string (or {"reset":true})')
    }
    const config = parseUpstreamUrl(record.url)
    if (config === null) {
      throw new ApiError(400, 'bad-upstream', 'url must be an http(s) URL without embedded credentials — the full address code serve-web prints, base path and query included')
    }
    // Bounded liveness probe BEFORE adopting: the browser half falls back
    // to the direct cross-origin iframe when the DSH host cannot reach the
    // pasted address (e.g. a remote serve-web). The fetched page doubles
    // as the discovery seed, so the adopt below does not refetch it.
    const fetched = await proxy.probeUpstream(config)
    proxy.configure(config, fetched ?? undefined)
    return { mounted: `${PROXY_MOUNT}/`, reachable: fetched !== null }
  },

  // The settings-document locator: the settings button takeover needs the
  // Host-side absolute path the stock /api method deliberately withholds
  // from the browser. No body is read (nothing to validate), and the
  // answer only rides the same fenced same-origin route family as the
  // open channel — the path names a document whose existence the settings
  // provider itself guarantees (prepareDocument materializes it).
  'settings.document': async (_payload, { settings }) => {
    if (settings === undefined) {
      throw new ApiError(500, 'settings-absent', 'settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) in its composition')
    }
    let path: string | undefined
    try {
      path = await settings.prepareDocument()
    } catch (error) {
      throw new ApiError(500, 'internal', `settings document preparation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (path === undefined || path === '') {
      throw new ApiError(500, 'no-document', 'settings provider has no local document to open')
    }
    return { path }
  },

  'open.capability': async payload => {
    const folder = folderField(payload)
    const marker = await readCapabilityMarker(OPEN_CHANNEL_BASE, folder)
    return { present: marker.present, version: marker.version }
  },

  'open.embedded': async payload => {
    const folder = absoluteFolderField(payload)
    await writeEmbeddedBoot(OPEN_CHANNEL_BASE, folder)
    return undefined
  },

  'open.request': async payload => {
    const command = parseOpenCommand(payload)
    if (command === null) {
      throw new ApiError(400, 'bad-request', 'malformed open request')
    }
    await writeOpenCommand(OPEN_CHANNEL_BASE, command)
    return undefined
  },

  'boot.begin': async payload => {
    const { folder, nonce } = bootFields(payload)
    await writeBootRequest(OPEN_CHANNEL_BASE, folder, nonce)
    // The park-time ledger rides along: the client's DOM-quiet reveal
    // racer keeps the frame hidden while the live tab strip mismatches it
    // (a ghost VS Code's restore replayed that the reconcile has not
    // closed yet). Null = no ledger (first-ever boot: nothing reconciles).
    return { editors: await readBootLedger(OPEN_CHANNEL_BASE, folder) }
  },

  'boot.status': async payload => {
    const { folder, nonce } = bootFields(payload)
    const matched = await readBootStatus(OPEN_CHANNEL_BASE, folder, nonce)
    return { matched }
  },

  'boot.interact': async payload => {
    const { folder, nonce } = bootFields(payload)
    await writeUserInteract(OPEN_CHANNEL_BASE, folder, nonce)
    return undefined
  },
}

/**
 * Mount the vscode-selection pre-step boundary for every agent.
 * @param ctx - host cordis context.
 */
export function apply(ctx: Context): void {
  const readFileRange = createFileRangeReader()
  // The listener lives on the agent's scope (the event is agent-scoped), so it
  // registers per created agent and withdraws with it.
  /* v8 ignore start -- agent-scoped registration glue; the boundary behavior is vscodeMentionPreStep (unit-tested) and the event plumbing is harness-owned. */
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.effect(() => {
      const stop = agent.ctx.on('agent/pre-step', async ({ messages, signal }, next) => {
        return vscodeMentionPreStep(
          agent.session.header.cwd,
          readFileRange,
          messages,
          signal,
          next,
        )
      })
      return () => { stop() }
    }, 'dsh-sidebar-vscode: vscode-mention contexts')
  })
  /* v8 ignore stop */

  // ── Same-origin /vscode reverse proxy ──────────────────────────────────
  // Probe-gated and fail-soft: an unreachable or conflicting upstream only
  // logs, never failing plugin activation (see vscodeProxy.ts). The
  // `proxy.config` route lets the browser half push the `serverUrl`
  // setting (a full `code serve-web` URL, base path + token included) as
  // the proxy's upstream.
  const proxy = createVscodeProxy(ctx as unknown as ProxyPluginContext)

  // ── The fenced route family (method-table dispatch) ────────────────────
  // Fenced like every other plugin route (browser-trust fence over the
  // live trustedHosts); a cross-site page cannot reach them.
  const host = ctx as unknown as HostContextFace
  ctx.effect(() => host.webServer.register({
    kind: 'prefix',
    path: '/sidebar-vscode/api',
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, host.webRuntime.trustedHosts)) {
        writeJson(res, 403, errorBody('forbidden', 'forbidden'))
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, errorBody('method-error', 'method not allowed'))
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeJson(res, 404, errorBody('not-found', 'unknown method'))
        return
      }
      const entry = METHODS[method]
      if (entry === undefined) {
        writeJson(res, 404, errorBody('not-found', `unknown method "${method}"`))
        return
      }
      try {
        // settings.document validates nothing and reads no body; every
        // other method receives the (capped) JSON body.
        const payload = method === 'settings.document' ? null : await readJsonBody(req)
        const value = await entry(payload, { proxy, settings: host.get('settings') })
        writeJson(res, 200, value === undefined ? { ok: true } : { ok: true, value })
      } catch (error) {
        if (error instanceof ApiError) {
          writeJson(res, error.status, errorBody(error.code, error.message))
          return
        }
        writeJson(res, 500, errorBody('internal', error instanceof Error ? error.message : String(error)))
      }
    },
  }), 'dsh-sidebar-vscode: /sidebar-vscode/api routes')
}
