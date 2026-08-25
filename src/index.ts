/**
 * `dsh-sidebar-vscode`, node half: the vscode-selection context boundary.
 *
 * Everything UI-shaped (the better-sidebar VS Code tab, the composer
 * chips, the reference rail) lives in the browser half. This half owns the
 * model-facing seam: for every live agent it listens at `agent/pre-step`,
 * expands canonical `dsh-vscode:` (editor selections) and `dsh-vscode-res:`
 * (explorer file/folder) mentions in the claimed user messages into
 * readable labels plus bounded `<text-selection>` context messages sourced
 * `{ kind: 'vscode-mention', … }` — or, for resources, content-less
 * `<file-selection>`/`<folder-selection>` markers sourced
 * `{ kind: 'vscode-resource', … }` (see `src/mention.ts`). File bytes are
 * read only to mark freshness; the snapshot content itself rides inside the
 * mention, so nothing here depends on filesystem availability.
 *
 * @module dsh-sidebar-vscode
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: brings the agent event and PreStepDecision declarations in.
import type {} from '@deepseek-ai/dsh-agent'
import { createFileRangeReader, vscodeMentionPreStep } from './mention.ts'

/** Cordis plugin name (the Loader entry; matches the client bundle id). */
export const name = 'dsh-sidebar-vscode'

/** Services required before load: the agent registry (agent/created events). */
export const inject = ['agents']

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
}
