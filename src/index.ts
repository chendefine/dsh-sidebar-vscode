/**
 * `dsh-sidebar-vscode`, node half: the vscode-selection context boundary
 * plus the extension command channel's two fenced routes.
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
 * - `/sidebar-vscode/api/open.capability` + `/open.request`: the spool the
 *   embedded workbench's extension polls (see `src/openChannel.ts`), fenced
 *   by the same browser-trust rules as every other plugin route.
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
  readCapability,
  writeOpenCommand,
} from './openChannel.ts'
import { isTrustedApiRequest } from './trust-fence.ts'

/** Cordis plugin name (the Loader entry; matches the client bundle id). */
export const name = 'dsh-sidebar-vscode'

/** Services required before load: the agent registry (agent/created
 * events), the webserver (command-channel routes), and the web runtime
 * (the trust fence's live trustedHosts). */
export const inject = ['agents', 'webServer', 'webRuntime']

/** One JSON answer over the response stream. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
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

  // ── Extension command channel routes ───────────────────────────────────
  // POST /sidebar-vscode/api/open.capability {folder} → {ok, value:{present}}
  // POST /sidebar-vscode/api/open.request   {folder, path, nonce, …} → {ok}
  // Fenced like every other plugin route (browser-trust fence over the
  // live trustedHosts); a cross-site page cannot reach them.
  const host = ctx as unknown as HostContextFace
  ctx.effect(() => host.webServer.register({
    kind: 'prefix',
    path: '/sidebar-vscode/api',
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, host.webRuntime.trustedHosts)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/sidebar-vscode/api/')
        ? pathname.slice('/sidebar-vscode/api/'.length)
        : undefined
      if (method === undefined || method.includes('/')) {
        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method' } })
        return
      }
      try {
        const payload = await readJsonBody(req)
        if (method === 'open.capability') {
          const record = payload as { folder?: unknown } | null
          if (record === null || typeof record.folder !== 'string' || record.folder === '') {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'folder must be a non-empty string' } })
            return
          }
          const present = await readCapability(OPEN_CHANNEL_BASE, record.folder)
          writeJson(res, 200, { ok: true, value: { present } })
          return
        }
        if (method === 'open.request') {
          const command = parseOpenCommand(payload)
          if (command === null) {
            writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'malformed open request' } })
            return
          }
          await writeOpenCommand(OPEN_CHANNEL_BASE, command)
          writeJson(res, 200, { ok: true })
          return
        }
        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown method "${method}"` } })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
      }
    },
  }), 'dsh-sidebar-vscode: /sidebar-vscode/api routes')
}
