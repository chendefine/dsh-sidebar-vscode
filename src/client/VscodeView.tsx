/**
 * The VSCode tab component: resolves the session's authoritative working
 * directory, maps it into the embedded VS Code server's filesystem view
 * (identity in the default same-container deployment), and embeds the
 * VS Code workbench in a same-origin iframe
 * (`<base>/?folder=<mapped cwd>`).
 *
 * Design notes:
 * - The iframe is NOT sandboxed and NOT keyed away on `visible === false`:
 *   the default deployment serves the VS Code server behind the same gateway
 *   (cookies flow, WebSocket terminal works) and the VS Code session should
 *   survive tab switches inside the sidebar.
 * - The authoritative cwd comes from better-sidebar's `/sidebar/api`
 * (`session.cwd`); the scope's optional cwd is used as a fast path.
 * - Settings (`serverUrl`, `pathMap`) are read from the store's prefs
 *   snapshot each render, so gear-popup edits apply on the next render.
 * - All chrome follows the DSH appearance (light / dark / system) through
 *   the host's `--dsw-alias-*` tokens — see `adoptTabStyles` below.
 *
 * @module dsh-sidebar-vscode/client/VscodeView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TabComponentProps } from 'dsh-better-sidebar'
import { readSetting, readSettingValue } from './settings.ts'
import { buildVscodeUrl, mapPath, normalizeBaseUrl, parsePathMap } from './paths.ts'
import { installClipboardBridge } from './clipboardBridge.ts'
import type { ClipboardPayload } from './selection.ts'
import { getReferenceLander, setFallbackOptions } from './composer.tsx'
import { t } from './i18n.ts'

/** What `/sidebar/api/session.cwd` answers on success (`parsed.value`). */
interface CwdResult {
  cwd: string
  root: string
  parent: string | null
}

// ---- tab stylesheet ----

/** Idempotency id of the injected tab <style> element. */
const TAB_STYLE_ID = 'dsh-sidebar-vscode-tab-css'

/**
 * The tab's stylesheet. Every surface follows the host appearance (light /
 * dark / system) through the shell's `--dsw-alias-*` design tokens — the
 * same palette better-sidebar's own panels, strips, and banners use — so
 * the toolbar reads as native chrome instead of a hard-coded dark bar:
 * the strip sits on `bg-layer-1` with an `border-l1` hairline, labels use
 * the label ramp, the workbench well uses `bg-base` (what better-sidebar
 * paints behind its own iframes), and notices reuse the warn banner pair
 * (`state-warn-label` on `state-warn-tertiary`).
 */
const TAB_CSS = `
.dsh_vscodeTab_root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_vscodeTab_strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 5px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-secondary);
}
.dsh_vscodeTab_title {
  flex: none;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  white-space: nowrap;
}
.dsh_vscodeTab_path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeTab_spacer {
  flex: 1;
}
.dsh_vscodeTab_reload {
  flex: none;
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.dsh_vscodeTab_reload:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeTab_open {
  flex: none;
  padding: 3px 2px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.12s;
}
.dsh_vscodeTab_open:hover {
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeTab_notice {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 4px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-state-warn-label);
  background: var(--dsw-alias-state-warn-tertiary);
}
.dsh_vscodeTab_noticeText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh_vscodeTab_surface {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
}
.dsh_vscodeTab_frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.dsh_vscodeTab_loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  font: var(--dsw-font-xs-13);
  color: var(--dsw-alias-label-tertiary);
  pointer-events: none;
}
.dsh_vscodeTab_loadingHint {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.8;
  max-width: 420px;
}
`

/**
 * Idempotently install the tab stylesheet into `document.head`. The tokens
 * are host globals maintained by the theme presenter (they flip with the
 * appearance preference, `system` included), so the stylesheet needs no
 * theme awareness of its own.
 * @returns a disposer that removes the element (safe to call twice).
 */
export function adoptTabStyles(): () => void {
  const existing = document.getElementById(TAB_STYLE_ID)
  if (existing !== null) {
    const node = existing
    return () => { node.remove() }
  }
  const style = document.createElement('style')
  style.id = TAB_STYLE_ID
  style.dataset.plugin = 'dsh-sidebar-vscode'
  style.dataset.pluginCss = TAB_STYLE_ID
  style.textContent = TAB_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * Render the VS Code workbench for the scope's workspace.
 * @param props - the tab component props (scope + the sidebar store).
 */
export function VscodeView(props: TabComponentProps): React.ReactNode {
  const { scope, store } = props

  // Shared settings (read each render; the gear popup writes the prefs doc).
  const serverUrl = normalizeBaseUrl(readSetting(store, 'serverUrl'))
  const pathMap = parsePathMap(readSetting(store, 'pathMap'))

  // Session cwd resolution: fast path via scope, authoritative via the API.
  const [cwd, setCwd] = useState<string | undefined>(scope.cwd)
  const [cwdFailed, setCwdFailed] = useState(false)

  useEffect(() => {
    if (scope.cwd !== undefined && scope.cwd !== '') {
      setCwd(scope.cwd)
      setCwdFailed(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setCwd(undefined)
    void (async () => {
      try {
        const response = await fetch('/sidebar/api/session.cwd', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: scope.sessionId }),
          signal: controller.signal,
        })
        const parsed: { ok?: boolean; value?: unknown } | null = await response.json().catch(() => null)
        if (cancelled) return
        if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
          setCwdFailed(true)
          return
        }
        const value = parsed.value as Partial<CwdResult>
        if (typeof value.cwd !== 'string' || value.cwd === '') {
          setCwdFailed(true)
          return
        }
        setCwd(value.cwd)
        setCwdFailed(false)
      } catch {
        if (!cancelled) setCwdFailed(true)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [scope.sessionId, scope.cwd])

  // Path translation + iframe target.
  const mapped = cwd === undefined ? undefined : mapPath(cwd, pathMap)
  const unmapped = cwd !== undefined && mapped === null
  const target = buildVscodeUrl(serverUrl, mapped ?? null)

  // Hold the iframe until the cwd resolves (avoids loading the default
  // workspace first and flipping to ?folder= a moment later).
  const ready = cwd !== undefined || cwdFailed

  // Load state: the overlay hides on the iframe's load event; a src change
  // or a manual reload re-shows it. Cross-origin load failures can't be
  // observed from here — the persistent hint row covers that case.
  const [loaded, setLoaded] = useState(false)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    setLoaded(false)
  }, [target])

  // ---- Selection bridge: intercept envelope-carrying clipboard writes the
  // embedded workbench makes (same-origin privilege) and land them in the
  // DSH composer as atomic reference chips. Always on — no switch gates it.
  const maxLinesSetting = readSettingValue(store, 'maxLines')
  const maxLines = typeof maxLinesSetting === 'number' && Number.isFinite(maxLinesSetting) && maxLinesSetting > 0
    ? Math.floor(maxLinesSetting)
    : undefined
  const maxBytesSetting = readSettingValue(store, 'maxBytes')
  const maxBytes = typeof maxBytesSetting === 'number' && Number.isFinite(maxBytesSetting) && maxBytesSetting > 0
    ? Math.floor(maxBytesSetting)
    : undefined
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const bridgeDisposer = useRef<(() => void) | null>(null)
  // Latest values for the async bridge callback (avoids stale closures).
  const bridgeInputs = useRef({ pathMap, maxLines, maxBytes, cwd, sessionId: scope.sessionId })
  bridgeInputs.current = { pathMap, maxLines, maxBytes, cwd, sessionId: scope.sessionId }
  // Keep the paste fallback's options fresh (same live values).
  setFallbackOptions({ reverseRules: pathMap, cwd, maxLines, maxBytes })
  // Degradation notices only (injection failures / text fallback); success
  // is silent — the chip appearing in the composer IS the feedback.
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(() => { setFlash(null) }, 3000)
    return () => { window.clearTimeout(timer) }
  }, [flash])

  // Reports delivery back to the clipboard bridge: on success the bridge
  // swallows the write, so the user's clipboard is never clobbered; only a
  // failed landing lets the envelope's readable fallback reach the
  // clipboard for a manual paste.
  const handlePayload = useCallback((payload: ClipboardPayload): Promise<boolean> => {
    const { pathMap: rules, maxLines: lines, maxBytes: bytes, cwd: workdir, sessionId } = bridgeInputs.current
    return (async () => {
      const lander = getReferenceLander()
      if (lander === undefined) {
        setFlash(t('injectFailed'))
        return false
      }
      const outcome = await lander(sessionId, payload, {
        reverseRules: rules,
        cwd: workdir,
        maxLines: lines,
        maxBytes: bytes,
      })
      if (outcome.failed) {
        setFlash(t('injectFailed'))
        return false
      }
      if (outcome.textFallback > 0) setFlash(t('injectedAsText'))
      return true
    })()
  }, [])

  const installBridge = useCallback(() => {
    bridgeDisposer.current?.()
    bridgeDisposer.current = null
    const frame = iframeRef.current
    if (frame === null) return
    bridgeDisposer.current = installClipboardBridge(frame, handlePayload)
  }, [handlePayload])
  useEffect(() => () => {
    bridgeDisposer.current?.()
    bridgeDisposer.current = null
  }, [])
  useEffect(() => {
    if (loaded) installBridge()
  }, [loaded, installBridge])

  return (
    <div className="dsh_vscodeTab_root">
      {/* Toolbar: workspace path + reload + open-in-new-window */}
      <div className="dsh_vscodeTab_strip">
        <span className="dsh_vscodeTab_title">{t('title')}</span>
        <span className="dsh_vscodeTab_path" title={mapped ?? undefined}>
          {t('workspace')}: {mapped ?? '…'}
        </span>
        <span className="dsh_vscodeTab_spacer" />
        <button
          type="button"
          className="dsh_vscodeTab_reload"
          onClick={() => {
            setLoaded(false)
            setNonce(nonce + 1)
          }}
        >
          ↻ {t('reload')}
        </button>
        <a className="dsh_vscodeTab_open" href={target} target="_blank" rel="noreferrer">
          ⧉ {t('openNewWindow')}
        </a>
      </div>

      {/* Notices: unmappable workspace / cwd resolution failure / injection feedback */}
      {(unmapped || cwdFailed) && (
        <div className="dsh_vscodeTab_notice">
          <span className="dsh_vscodeTab_noticeText">
            {cwdFailed ? t('cwdFailed') : t('unmapped')}
          </span>
        </div>
      )}
      {flash !== null && (
        <div className="dsh_vscodeTab_notice">
          <span className="dsh_vscodeTab_noticeText">
            {flash}
          </span>
        </div>
      )}

      {/* Workbench surface */}
      <div className="dsh_vscodeTab_surface">
        {ready
          ? (
            <iframe
              ref={iframeRef}
              key={`${target}#${nonce}`}
              src={target}
              title="VSCode"
              onLoad={() => {
                setLoaded(true)
                installBridge()
              }}
              className="dsh_vscodeTab_frame"
            />
          )
          : null}
        {!ready || !loaded
          ? (
            <div className="dsh_vscodeTab_loading">
              <div>{t('loading')}</div>
              <div className="dsh_vscodeTab_loadingHint">{t('loadHint')}</div>
            </div>
          )
          : null}
      </div>
    </div>
  )
}
