/**
 * The workbench iframe-base resolver: which base URL the embedded VS Code
 * workbench opens at — the same-origin proxy mount (`/sidebar/vscode`)
 * whenever the host half's built-in reverse proxy is serving, the
 * configured direct URL otherwise, with a self-healing poll that
 * graduates a direct fallback to the mount once the proxy comes up.
 *
 * Extracted from the VscodeView render body as a controller so the whole
 * decision — the `proxy.config` push, the `proxy.status` ask, the reset
 * of a previously pushed upstream, the 5s graduation loop, and the
 * cancellation discipline — is one unit-testable object with injected
 * transport. The {@link useWorkbenchBase} hook is the thin React binding.
 *
 * Decision table (the base is decided by PROXY REACHABILITY ALONE —
 * `serverUrl` names the UPSTREAM and the fallback base):
 *
 * - a FULL URL (`http(s)://…`, base path and `?tkn=` token included) is
 *   pushed via `proxy.config`; reachable → mount; unreachable (a
 *   serve-web still warming up, a remote address) → the direct
 *   cross-origin iframe plus a notice, with the host still probing and
 *   the graduation loop watching for it to start serving;
 * - anything else (empty = the default local serve-web, or an explicit
 *   relative subpath with gateway semantics) is never pushed: any
 *   previously pushed upstream is RELEASED (`{reset:true}`), and the
 *   host's own proxy state picks the winner — serving → mount, else the
 *   subpath itself as a direct base.
 *
 * @module dsh-sidebar-vscode/client/workbenchBase
 */

import { useEffect, useRef, useState } from 'react'

/** The resolved base states; 'resolving' is the pre-answer state. */
export type WorkbenchBaseState = 'resolving' | 'mount' | 'direct'

/** The structural fetch face the controller needs (injectable for tests). */
export interface BaseFetchLike {
  (url: string, init: { method: string, headers: { 'content-type': string }, body: string }): Promise<{
    ok: boolean
    json(): Promise<unknown>
  }>
}

/** The default fetch binding (the browser's global). */
const defaultFetch: BaseFetchLike = (url, init) => fetch(url, init)

/** The controller's outbound signals (one per state transition). */
export type WorkbenchBaseEmit = (state: WorkbenchBaseState, notice: 'proxyFallback' | undefined) => void

/** How often a direct fallback re-asks the host whether it is serving yet. */
const GRADUATE_POLL_MS = 5_000

/** The timer face the graduation loop needs (injectable for tests). */
export interface BaseTimers {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

/** The browser-global binding. */
const defaultTimers: BaseTimers = {
  setInterval: (handler, ms) => { return window.setInterval(handler, ms) },
  clearInterval: handle => { window.clearInterval(handle as number) },
}

/**
 * One resolution attempt per `serverUrl` shape. `update` cancels the
 * previous attempt and starts a new one; `cancel` stops everything
 * (unmount). The controller remembers what THIS component pushed to the
 * host (the historical `pushedUrl` discipline): switching from a full
 * URL to a relative subpath must RELEASE the previously adopted upstream
 * before the status ask, or the ask would observe the stale one — and
 * the release is awaited first for exactly that reason.
 */
export class WorkbenchBaseController {
  private cancelled = false
  private graduate: (() => void) | null = null
  private pushedUrl: string | null = null

  constructor(
    private readonly emit: WorkbenchBaseEmit,
    private readonly fetchLike: BaseFetchLike = defaultFetch,
    private readonly timers: BaseTimers = defaultTimers,
  ) {}

  /** POST one JSON body and answer `{ok, value}` structurally; null on failure. */
  private async post(method: string, body: Record<string, unknown>): Promise<{ ok: boolean, value: unknown } | null> {
    try {
      const response = await this.fetchLike(`/sidebar-vscode/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const parsed: unknown = await response.json().catch(() => null)
      if (!response.ok || parsed === null || typeof parsed !== 'object') return null
      const record = parsed as { ok?: unknown, value?: unknown }
      if (record.ok !== true) return null
      return { ok: true, value: record.value }
    } catch {
      return null
    }
  }

  /** Whether the host's proxy reports itself serving (a mount candidate). */
  private async serving(): Promise<boolean> {
    const parsed = await this.post('proxy.status', {})
    return parsed !== null && (parsed.value as { serving?: unknown } | null)?.serving === true
  }

  /** Start the graduation loop: poll until the host serves, then emit mount. */
  private watchServing(): void {
    const timer = this.timers.setInterval(() => {
      if (this.cancelled) return
      void (async () => {
        // Keep watching on errors too — the host half may itself be
        // restarting (an old bundle, a redeploy).
        if (await this.serving()) {
          this.emit('mount', undefined)
          this.graduate?.()
        }
      })()
    }, GRADUATE_POLL_MS)
    this.graduate = () => { this.timers.clearInterval(timer) }
  }

  /**
   * Resolve the base for one `serverUrl` shape. Cancels any in-flight
   * resolution first; emits 'resolving' immediately, then
   * 'mount'/'direct' once the host answers (plus later 'mount'
   * graduations from the direct fallback's poll).
   *
   * @param effectiveServerUrl - the normalized setting value (empty =
   * DEFAULT_SERVER_URL applied by the caller).
   * @param fullUrl - whether the value is a full http(s) URL.
   */
  update(effectiveServerUrl: string, fullUrl: boolean): void {
    this.cancel()
    this.cancelled = false
    const isCancelled = (): boolean => this.cancelled
    this.emit('resolving', undefined)

    if (!fullUrl) {
      // An explicit subpath (or the unset default) cannot name an
      // upstream: release any previously pushed one (the host returns to
      // its env/default) and let the host's own proxy state pick the
      // winner. The reset is awaited so the status ask right behind it
      // cannot observe the released upstream.
      const previous = this.pushedUrl
      this.pushedUrl = null
      void (async () => {
        if (previous !== null) {
          await this.post('proxy.config', { reset: true }).catch(() => null)
        }
        if (isCancelled()) return
        if (await this.serving()) {
          if (!isCancelled()) this.emit('mount', undefined)
          return
        }
        if (isCancelled()) return
        this.emit('direct', undefined)
        this.watchServing()
      })()
      return
    }

    void (async () => {
      const parsed = await this.post('proxy.config', { url: effectiveServerUrl })
      if (isCancelled()) return
      if (parsed !== null) {
        // Adopted either way (the host keeps probing an unreachable one,
        // claiming the mount with honest 502s): remember the push NOW, so
        // a later switch to a relative subpath resets it.
        this.pushedUrl = effectiveServerUrl
        if ((parsed.value as { reachable?: unknown } | null)?.reachable === true) {
          this.emit('mount', undefined)
          return
        }
      }
      // Unreachable NOW (serve-web may still be warming up): the host
      // adopted the config and keeps probing — fall back to the direct
      // iframe but keep watching for it to start serving.
      this.emit('direct', 'proxyFallback')
      this.watchServing()
    })()
  }

  /** Stop the in-flight resolution (unmount / HMR). */
  cancel(): void {
    this.cancelled = true
    this.graduate?.()
    this.graduate = null
  }
}

/**
 * The React binding: resolves the iframe base for one `serverUrl` shape
 * and re-resolves whenever it changes. `onNotice` receives the
 * degradation notice key ('proxyFallback') at most once per resolution.
 * @returns the live base state.
 */
export function useWorkbenchBase(
  effectiveServerUrl: string,
  fullUrl: boolean,
  onNotice: (key: 'proxyFallback') => void,
): WorkbenchBaseState {
  const [state, setState] = useState<WorkbenchBaseState>('resolving')
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice
  const controller = useRef<WorkbenchBaseController | null>(null)
  if (controller.current === null) {
    controller.current = new WorkbenchBaseController((next, notice) => {
      setState(next)
      if (notice !== undefined) noticeRef.current(notice)
    })
  }
  useEffect(() => {
    controller.current?.update(effectiveServerUrl, fullUrl)
    return () => { controller.current?.cancel() }
  }, [effectiveServerUrl, fullUrl])
  return state
}
