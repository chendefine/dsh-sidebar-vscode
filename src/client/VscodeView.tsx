/**
 * The VSCode tab component: a composition layer over the workbench
 * lifecycle controllers. Each orthogonal concern of embedding the VS Code
 * web workbench lives in its own unit-testable module, and this component
 * only wires them to the tab's props and renders their state:
 *
 * - the iframe BASE resolution (same-origin mount vs direct URL, with
 *   self-healing graduation) — `workbenchBase.ts`;
 * - the session cwd resolution (scope fast path, `/sidebar/api` authoritative);
 * - the BOOT GATE (park a nonce before the frame mounts, await the
 *   extension's post-reconcile receipt OR the rendered editor strip —
 *   whichever settles first — rotate on in-place reloads) —
 *   `bootGate.ts` (`BootGateController`);
 * - the BOOT LOCK (hold a cross-tab Web Lock while the workbench boots,
 *   release once it has painted — two same-origin tabs racing to create
 *   VS Code's IndexedDB storage deadlock for minutes) — `bootLock.ts`
 *   (`WorkbenchBootLock`);
 * - the FOCUS FENCE (bounce uninvited focus grabs out of the frame) —
 *   `focusFence.ts` (`FocusFenceController`) over the pure rules in
 *   `focusGuard.ts`;
 * - the OPEN REQUESTS (one-shot meta stamps: retire stale, defer until
 *   the gate settles, decline foreign sessions) — `openRequests.ts`
 *   (`OpenRequestConsumer`) driving the two-channel opener in
 *   `workbenchLink.ts` (extension spool first, URL payload degraded);
 * - the CLIPBOARD BRIDGE (same-origin envelope interception) —
 *   `clipboardBridge.ts`;
 * - the paste-fallback options feed — `referencePipeline.ts`.
 *
 * Design notes that belong to the view itself:
 * - The iframe is NOT sandboxed and NOT keyed away on `visible === false`:
 *   the workbench is served same-origin (through the host half's built-in
 *   `/sidebar/vscode` proxy, or the deployment's gateway subpath — cookies
 *   flow, the WebSocket terminal works) and the VS Code session should
 *   survive tab switches inside the sidebar. The FIRST load is deferred,
 *   though, until the tab has been visible once (a workbench booted
 *   inside a hidden iframe steals the caret from the composer via its
 *   Getting Started page, so the boot waits for an audience).
 * - The authoritative cwd comes from better-sidebar's `/sidebar/api`
 *   (`session.cwd`); the scope's optional cwd is used as a fast path.
 * - Settings (`serverUrl`, `pathMap`) are read from the store's prefs
 *   snapshot each render, so edits apply on the next render.
 * - All chrome follows the DSH appearance (light / dark / system) through
 *   the host's `--dsw-alias-*` tokens (the tab stylesheet lives in
 *   styles.ts, adopted by the plugin body with the tab registration).
 *
 * @module dsh-sidebar-vscode/client/VscodeView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TabComponentProps } from 'dsh-better-sidebar'
import { readSetting, readSettingValue } from './settings.ts'
import {
  buildVscodeUrl,
  DEFAULT_SERVER_URL,
  isFullServerUrl,
  mapPath,
  normalizeBaseUrl,
  parsePathMap,
  PROXY_MOUNT,
} from './paths.ts'
import { installClipboardBridge } from './clipboardBridge.ts'
import { BootGateController, type BootGateStatus } from './bootGate.ts'
import { FocusFenceController } from './focusFence.ts'
import { useWorkbenchBase } from './workbenchBase.ts'
import { WorkbenchBootLock, acquireWebLock, type BootLockStatus } from './bootLock.ts'
import { OpenRequestConsumer, pageLoadedAt } from './openRequests.ts'
import { createWorkbenchOpener, type PendingOpen, type WorkbenchOpener } from './workbenchLink.ts'
import type { ClipboardPayload } from './selection.ts'
import { getReferenceLander, setFallbackOptions } from './referencePipeline.ts'
import { extractOpenRequest, clearTabOpenRequest, type OpenRequest } from './openIntercept.ts'
import { beginBoot, pollBootStatus, probeCapability, reportUserInteract, sendOpenCommand } from './openChannelApi.ts'
import { t } from './i18n.ts'

/** What `/sidebar/api/session.cwd` answers on success (`parsed.value`). */
interface CwdResult {
  cwd: string
  root: string
  parent: string | null
}

/** One client-randomness boot nonce (printable, bounded). */
function mintBootNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Presentational: the toolbar strip (workspace path + reload + pop-out). */
function Toolbar(props: {
  mapped: string | null | undefined
  target: string
  onReload: () => void
}): React.ReactNode {
  const { mapped, target, onReload } = props
  return (
    <div className="dsh_vscodeTab_strip">
      <span className="dsh_vscodeTab_title">{t('title')}</span>
      <span className="dsh_vscodeTab_path" title={mapped ?? undefined}>
        {t('workspace')}: {mapped ?? '…'}
      </span>
      <span className="dsh_vscodeTab_spacer" />
      <button type="button" className="dsh_vscodeTab_reload" onClick={onReload}>
        ↻ {t('reload')}
      </button>
      <a className="dsh_vscodeTab_open" href={target} target="_blank" rel="noreferrer">
        ⧉ {t('openNewWindow')}
      </a>
    </div>
  )
}

/** Presentational: one amber degradation notice row. */
function NoticeRow(props: { text: string }): React.ReactNode {
  return (
    <div className="dsh_vscodeTab_notice">
      <span className="dsh_vscodeTab_noticeText">{props.text}</span>
    </div>
  )
}

/**
 * Render the VS Code workbench for the scope's workspace.
 * @param props - the tab component props (scope + the sidebar store).
 */
export function VscodeView(props: TabComponentProps): React.ReactNode {
  const { scope, store, visible } = props

  // ── Shared settings (read each render; the gear popup writes the doc) ──
  const rawServerUrl = readSetting(store, 'serverUrl')
  const effectiveServerUrl = rawServerUrl.trim() === '' ? DEFAULT_SERVER_URL : normalizeBaseUrl(rawServerUrl)
  const fullUrl = isFullServerUrl(effectiveServerUrl)
  const pathMap = parsePathMap(readSetting(store, 'pathMap'))

  // Degradation notices only (unmapped opens / injection failures / text
  // fallback / proxy fallback); success is silent.
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(() => { setFlash(null) }, 3000)
    return () => { window.clearTimeout(timer) }
  }, [flash])

  // ── The iframe base (mount vs direct), resolved by the controller ──────
  const baseState = useWorkbenchBase(effectiveServerUrl, fullUrl, () => { setFlash(t('proxyFallback')) })
  const resolvingBase = baseState === 'resolving'
  const serverUrl = baseState === 'mount' ? PROXY_MOUNT : effectiveServerUrl

  // ── Session cwd resolution: fast path via scope, authoritative via API ─
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

  // Path translation. With no rules (the unset default) mapPath passes the
  // raw cwd through; `unmapped` degenerates to its null-only case, so the
  // notice only fires for a non-absolute cwd.
  const mapped = cwd === undefined ? undefined : mapPath(cwd, pathMap)
  const unmapped = cwd !== undefined && mapped === null

  // Latest values for the async paths (avoids stale closures): the gate's
  // workspace provider, the opener's inputs, and the bridge all read this.
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const inputsRef = useRef({ serverUrl, pathMap, cwd })
  inputsRef.current = { serverUrl, pathMap, cwd }
  const workspaceOf = useCallback((): string | null => {
    const { pathMap: rules, cwd: workdir } = inputsRef.current
    return workdir !== undefined ? mapPath(workdir, rules) : null
  }, [])

  // ── The boot gate controller (nonce handshake + rotation + reveal) ─────
  const gateRef = useRef<BootGateController | null>(null)
  if (gateRef.current === null) {
    gateRef.current = new BootGateController({
      workspace: workspaceOf,
      beginBoot,
      pollBootStatus,
      domSample: (): string | null => {
        try {
          const doc = iframeRef.current?.contentDocument ?? null
          if (doc === null) return null
          if (doc.querySelector('.monaco-workbench') === null) return ''
          const tabs = Array.from(doc.querySelectorAll('.editor-group-container .tab'))
          if (tabs.length === 0) return '(none)'
          return tabs.map(tab => {
            const label = tab.querySelector('.tab-label')
            return `${label !== null ? label.textContent ?? '' : ''}${tab.classList.contains('active') ? '*' : ''}`
          }).join('|')
        } catch {
          return null
        }
      },
      domPaths: (): string[] | null => {
        // The ledger-aware reveal gate's strip sample: one entry per file
        // tab, the `data-resource-name` basename the tab DOM exposes (VS
        // Code bakes no full path into the strip — the hover tooltip is a
        // custom widget). Non-file tabs carry no resource name and answer
        // their label text instead, which then mismatches the ledger's
        // basenames — the conservative direction (keep waiting).
        try {
          const doc = iframeRef.current?.contentDocument ?? null
          if (doc === null) return null
          if (doc.querySelector('.monaco-workbench') === null) return null
          return Array.from(
            doc.querySelectorAll('.editor-group-container .tab'),
            tab => (tab.getAttribute('data-resource-name')
              ?? tab.querySelector('.tab-label')?.textContent ?? '').trim(),
          )
        } catch {
          return null
        }
      },
      mintNonce: mintBootNonce,
      schedule: (callback, ms) => { window.setTimeout(callback, ms) },
      now: () => Date.now(),
    })
  }
  const gate = gateRef.current
  const [gateState, setGateState] = useState<BootGateStatus>(gate.getSnapshot())
  useEffect(() => gate.subscribe(() => { setGateState(gate.getSnapshot()) }), [gate])
  useEffect(() => () => { gate.dispose() }, [gate])

  // ── The cross-tab boot lock (serialize first paints across tabs) ───────
  // Two same-origin DSH pages booting the workbench concurrently race to
  // CREATE VS Code's IndexedDB (`vscode-web-db`) and one can then hang for
  // minutes inside its own boot (`willOpenDatabase`) — see bootLock.ts.
  // The frame may mount only behind this lock, which releases as soon as
  // the workbench has painted (the race is over by then).
  const bootLockRef = useRef<WorkbenchBootLock | null>(null)
  if (bootLockRef.current === null) {
    bootLockRef.current = new WorkbenchBootLock({
      acquire: () => acquireWebLock(),
      rendered: () => {
        try {
          return iframeRef.current?.contentDocument?.querySelector('.monaco-workbench') != null
        } catch {
          return false
        }
      },
      schedule: (callback, ms) => { window.setTimeout(callback, ms) },
      now: () => Date.now(),
    })
  }
  const bootLock = bootLockRef.current
  const [lockSnap, setLockSnap] = useState<BootLockStatus>(bootLock.getSnapshot())
  useEffect(() => bootLock.subscribe(() => { setLockSnap(bootLock.getSnapshot()) }), [bootLock])
  useEffect(() => () => { bootLock.dispose() }, [bootLock])

  // ── The workbench opener (extension spool first, URL payload degraded) ─
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(null)
  const openerRef = useRef<WorkbenchOpener | null>(null)
  if (openerRef.current === null) {
    openerRef.current = createWorkbenchOpener({
      inputs: () => ({
        serverUrl: inputsRef.current.serverUrl,
        pathMap: inputsRef.current.pathMap,
        cwd: inputsRef.current.cwd,
      }),
      taggableNonce: () => gateRef.current?.taggableNonce(),
      onNotice: message => { setFlash(message) },
      onPendingChange: pending => { setPendingOpen(pending) },
      probeCapability,
      sendOpenCommand,
      pageHref: () => window.location.href,
      pageHost: () => window.location.host,
    })
  }
  const opener = openerRef.current

  // ── The open-request consumer (one-shot meta stamps) ───────────────────
  const consumerRef = useRef<OpenRequestConsumer | null>(null)
  if (consumerRef.current === null) {
    consumerRef.current = new OpenRequestConsumer({
      retire: () => {
        const tabId = (props.tab as { id?: unknown } | undefined)?.id
        if (typeof tabId === 'string') clearTabOpenRequest(store, tabId)
      },
      execute: (request: OpenRequest) => openerRef.current?.open(request),
      gateSettled: () => gateRef.current !== null && gateRef.current.settled(),
      pageLoadedAt,
    })
  }
  const openRequest = extractOpenRequest((props.tab as { meta?: unknown } | undefined)?.meta)
  useEffect(() => {
    consumerRef.current?.update(openRequest, scope.sessionId)
  }, [openRequest?.nonce, scope.sessionId, gateState.phase, store])

  // The iframe target: the pending payload URL while one is valid for the
  // current basis, else the plain folder URL.
  const targetBasis = `${serverUrl}#${mapped ?? ''}`
  const effectivePending = pendingOpen !== null && pendingOpen.basis === targetBasis ? pendingOpen : null
  const target = effectivePending !== null
    ? effectivePending.url
    : buildVscodeUrl(serverUrl, mapped ?? null)

  // ── Focus guards: deferred first load ───────────────────────────────────
  // Hold the iframe back until this tab has been visible at least once
  // (active tab AND open panel): the openAsDefault swap lands this tab as
  // a brand-new session's default while the panel is usually collapsed —
  // a hidden boot buys nothing the user can see and only invites the
  // focus grab. `visible === undefined` (a better-sidebar peer too old to
  // pass the flag) fails OPEN — load as before, never defer on a guess.
  const [everVisible, setEverVisible] = useState(visible !== false)
  useEffect(() => {
    if (visible !== false) setEverVisible(true)
  }, [visible])

  // Hold the iframe until the cwd resolves (avoids loading the default
  // workspace first and flipping to ?folder= a moment later), until the
  // iframe base settles — a flip after the first load would reload the
  // workbench once for nothing — and until the tab has been shown once.
  const ready = (cwd !== undefined || cwdFailed) && !resolvingBase && everVisible

  // Load state: the overlay hides on the iframe's load event; a src change
  // or a manual reload re-shows it.
  const [loaded, setLoaded] = useState(false)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    setLoaded(false)
  }, [target])
  const loadKey = `${target}#${nonce}`

  // Keyed reads: a changed loadKey starts its gate at 'pending' in the
  // very render that remounts the iframe — no stale phase can leak across
  // loads, and the frame never mounts before its boot nonce is parked.
  const bootGate = gateState.key === loadKey
    ? gateState
    : { key: loadKey, phase: 'pending' as const, nonce: '', workspace: '', ledger: null as string[] | null, revealed: false }
  const revealed = bootGate.revealed
  const bootHidden = (bootGate.phase === 'hidden' || bootGate.phase === 'dom' || bootGate.phase === 'rotating') && !revealed

  // Keyed lock reads, same discipline: a changed loadKey re-arms the boot
  // lock before the frame may remount (a stale 'held' from the previous
  // load must not leak across loads), and 'queued' past the grace drives
  // the overlay's waiting hint.
  const bootLockHeld = lockSnap.key === loadKey && lockSnap.state === 'held'
  const lockQueued = lockSnap.key === loadKey && lockSnap.state === 'queued'

  // The lock lifecycle: acquire per load key (first mounts AND reloads —
  // every boot re-opens the database), release when that key goes away.
  useEffect(() => {
    if (!ready) return
    bootLock.begin(loadKey)
    return () => { bootLock.end() }
  }, [ready, loadKey, bootLock])

  // The gate lifecycle: a new load key parks a fresh nonce before the
  // frame may mount — behind the boot lock, so the nonce is minted close
  // to the mount it gates rather than while queued behind another tab;
  // the going-away fence rotates the parked nonce once more (retiring
  // every lingering extension host still bound to the old boot before
  // its invisible window poisons the shared editor ledger).
  useEffect(() => {
    if (!ready || !bootLockHeld) return
    gate.begin(loadKey)
    return () => { gate.fence() }
  }, [ready, bootLockHeld, loadKey, gate])

  // ── The user-interaction stamp (post-reveal deference signal) ───────────
  // The reveal racer can reveal the frame before the extension's
  // reconcile runs, and the reconcile diffs against a ledger that predates
  // anything the user opens in that window — their tab would be closed as
  // a restore ghost. The FIRST user gesture inside the revealed frame
  // therefore stamps `interact.json` for THIS boot (nonce-scoped, see
  // `boot.interact`), and the extension's close loop and ghost passes
  // stand down for a boot whose user is already interacting.
  useEffect(() => {
    if (!revealed || bootGate.phase !== 'hidden' || bootGate.nonce === '') return
    const doc = iframeRef.current?.contentDocument ?? null
    if (doc === null) return
    const options: AddEventListenerOptions = { capture: true }
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      doc.removeEventListener('pointerdown', gesture, options)
      doc.removeEventListener('keydown', gesture, options)
    }
    const gesture = (): void => {
      cleanup()
      const { pathMap: rules, cwd: workdir } = inputsRef.current
      const workspace = workdir !== undefined ? mapPath(workdir, rules) : null
      if (workspace !== null) void reportUserInteract(workspace, bootGate.nonce)
    }
    doc.addEventListener('pointerdown', gesture, options)
    doc.addEventListener('keydown', gesture, options)
    return cleanup
  }, [revealed, bootGate.phase, bootGate.nonce, loadKey])

  // ── Capture caps + the paste-fallback options feed ─────────────────────
  const maxLinesSetting = readSettingValue(store, 'maxLines')
  const maxLines = typeof maxLinesSetting === 'number' && Number.isFinite(maxLinesSetting) && maxLinesSetting > 0
    ? Math.floor(maxLinesSetting)
    : undefined
  const maxBytesSetting = readSettingValue(store, 'maxBytes')
  const maxBytes = typeof maxBytesSetting === 'number' && Number.isFinite(maxBytesSetting) && maxBytesSetting > 0
    ? Math.floor(maxBytesSetting)
    : undefined
  // Kept fresh in an effect (never mid-render): the dock's paste fallback
  // reads the latest values at paste time.
  useEffect(() => {
    setFallbackOptions({ reverseRules: pathMap, cwd, maxLines, maxBytes })
  })

  // ── The clipboard bridge (same-origin envelope interception) ────────────
  // Always on — no switch gates it. Reports delivery back: on success the
  // bridge swallows the write (the user's clipboard keeps whatever it
  // held); only a failed landing lets the envelope's readable fallback
  // reach the clipboard for a manual paste.
  const handlePayload = useCallback((payload: ClipboardPayload): Promise<boolean> => {
    return (async () => {
      const lander = getReferenceLander()
      if (lander === undefined) {
        setFlash(t('injectFailed'))
        return false
      }
      const outcome = await lander(scope.sessionId, payload, {
        reverseRules: inputsRef.current.pathMap,
        cwd: inputsRef.current.cwd,
        maxLines,
        maxBytes,
      })
      if (outcome.failed) {
        setFlash(t('injectFailed'))
        return false
      }
      if (outcome.textFallback > 0) setFlash(t('injectedAsText'))
      return true
    })()
  }, [scope.sessionId, maxLines, maxBytes])

  const bridgeDisposer = useRef<(() => void) | null>(null)
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

  // ── The focus fence controller (hidden + boot windows) ──────────────────
  const fenceRef = useRef<FocusFenceController | null>(null)
  if (fenceRef.current === null) {
    fenceRef.current = new FocusFenceController(
      {
        getFrame: () => iframeRef.current,
        now: () => Date.now(),
        setTimeout: (callback, ms) => { window.setTimeout(callback, ms) },
      },
      { bornVisible: visible !== false },
    )
  }
  const fence = fenceRef.current
  useEffect(() => { fence.setVisible(visible) }, [fence, visible])
  useEffect(() => fence.attach(), [fence])

  // Frame load completion: bridge install + gate driving + fence arming.
  const handleFrameLoad = useCallback(() => {
    setLoaded(true)
    installBridge()
    gate.frameLoaded()
    fence.onFrameLoad()
  }, [installBridge, gate, fence])

  return (
    <div className="dsh_vscodeTab_root">
      <Toolbar
        mapped={mapped}
        target={target}
        onReload={() => {
          // A manual reload drops any pending degraded-channel payload:
          // VS Code consumes `payload` only at workbench startup, so a
          // reload at the stale payload URL would bounce the workbench
          // back to that old file. Clearing flips `target` to the plain
          // folder URL in the same click that remounts the iframe anyway.
          opener.clearPending()
          setLoaded(false)
          setNonce(nonce + 1)
        }}
      />

      {/* Notices: unmappable workspace / cwd failure / degradations */}
      {(unmapped || cwdFailed) && (
        <NoticeRow text={cwdFailed ? t('cwdFailed') : t('unmapped')} />
      )}
      {flash !== null && <NoticeRow text={flash} />}

      {/* Workbench surface */}
      <div className="dsh_vscodeTab_surface">
        {ready && bootLockHeld && bootGate.phase !== 'pending'
          ? (
            <iframe
              ref={iframeRef}
              key={loadKey}
              src={target}
              title="VSCode"
              onLoad={handleFrameLoad}
              className="dsh_vscodeTab_frame"
              style={bootHidden ? { opacity: 0, pointerEvents: 'none' } : undefined}
            />
          )
          : null}
        {!ready || !loaded || bootHidden
          ? (
            <div className="dsh_vscodeTab_loading">
              <div>{t('loading')}</div>
              <div className="dsh_vscodeTab_loadingHint">{lockQueued ? t('bootQueue') : t('loadHint')}</div>
            </div>
          )
          : null}
      </div>
    </div>
  )
}
