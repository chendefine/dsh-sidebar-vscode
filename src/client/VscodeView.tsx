/**
 * The `vscode` tab body of the official right Sidebar: a composition layer
 * over the workbench lifecycle controllers. Each orthogonal concern of
 * embedding the VS Code web workbench lives in its own unit-testable
 * module, and this component only wires them to the tab's props and
 * renders their state:
 *
 * - the iframe BASE resolution (same-origin mount vs direct URL, with
 *   self-healing graduation) — `workbenchBase.ts`;
 * - the session cwd resolution (the sessions registry's live snapshot —
 *   the official standard `useSessions` prop);
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
 * - the OPEN NAVIGATIONS (one-shot revision discipline: retire stale,
 *   defer until the gate settles) — `openRequests.ts`
 *   (`OpenRequestConsumer`) driving the two-channel opener in
 *   `workbenchLink.ts` (extension spool first, URL payload degraded);
 * - the CLIPBOARD BRIDGE (same-origin envelope interception) —
 *   `clipboardBridge.ts`;
 * - the paste-fallback options feed — `referencePipeline.ts`.
 *
 * Props are the official keyed-seat share: the framework-bound
 * `useTabInfo()` (live sidebar/panel/tab state — `tab.visible` is the
 * docked-active-or-floating visibility, `tab.navigation` carries the
 * takeover's `openTab` params with a monotonic revision), the
 * session-scoped standard props (`sessionId`, `useSessions`), and this
 * plugin's injected settings scope (the `vscode-sidebar` namespace).
 *
 * Design notes that belong to the view itself:
 * - The root mounts FULL-BLEED: the docking kit pads every tab body
 *   (`.paneBody` 12px docked, `.floatBody` 10px floated), and a workbench
 *   reads as the pane itself, not a framed picture — `fullBleed.ts`
 *   measures the host's padding and cancels it edge to edge.
 * - The iframe is NOT sandboxed and NOT keyed away on `visible === false`:
 *   the workbench is served same-origin (through the host half's built-in
 *   `/sidebar/vscode` proxy, or the deployment's gateway subpath — cookies
 *   flow, the WebSocket terminal works). The FIRST load is deferred,
 *   though, until the tab has been visible once (a workbench booted
 *   inside a hidden iframe steals the caret from the composer via its
 *   Getting Started page, so the boot waits for an audience). Note the
 *   official pane renders only the ACTIVE tab's body: switching to a
 *   sibling tab in the same pane unmounts the workbench (a reload path
 *   the boot gate + editor-ledger reconcile handle), and switching back
 *   remounts it through this same deferred-first-load rule.
 * - Settings (`serverUrl`, `pathMap`, the caps) are read from the bound
 *   scope each render (the settings card writes the document), so edits
 *   apply on the next render.
 * - All chrome follows the DSH appearance (light / dark / system) through
 *   the host's `--dsw-alias-*` tokens (the tab stylesheet lives in
 *   styles.ts, adopted by the plugin body with the body registration).
 *
 * @module dsh-sidebar-vscode/client/VscodeView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { readSettingCaps, useSettings, type SettingsScopeFace } from './settings.ts'
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
import { OpenRequestConsumer } from './openRequests.ts'
import { createWorkbenchOpener, type PendingOpen, type WorkbenchOpener } from './workbenchLink.ts'
import { useFullBleed } from './fullBleed.ts'
import type { ClipboardPayload } from './selection.ts'
import { getReferenceLander, setFallbackOptions } from './referencePipeline.ts'
import { beginBoot, pollBootStatus, probeCapability, reportUserInteract, sendOpenCommand } from './openChannelApi.ts'
import { t } from './i18n.ts'

/** The framework-bound tab-info hook's answer (structural subset the view reads). */
export interface VscodeTabInfo {
  readonly tab: {
    readonly id: string
    /** Docked bodies need an expanded sidebar and an active tab; floats stay visible. */
    readonly visible: boolean
    readonly navigation: {
      readonly revision: number
      readonly params: unknown
    }
  }
}

/** The sessions-registry selector hook (structural subset: the cwd source). */
export type UseSessionsCwd = <R>(select: (snapshot: { byId: Record<string, { cwd?: string } | undefined> }) => R) => R

/** The body's composed props: the official keyed-seat share plus the injected scope. */
export interface VscodeViewProps {
  /** The framework-bound tab information reader (`useTabInfo()`). */
  useTabInfo(): VscodeTabInfo
  /** The session this tab belongs to (session-scoped standard prop). */
  sessionId: string
  /** The sessions registry selector (the cwd source). */
  useSessions: UseSessionsCwd
  /** The bound `vscode-sidebar` settings scope (this plugin's registration inject). */
  settings: SettingsScopeFace | undefined
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
 * Render the VS Code workbench for the session's workspace.
 * @param props - the official keyed-seat share plus the settings scope.
 */
export function VscodeView(props: VscodeViewProps): React.ReactNode {
  const { sessionId, useSessions } = props
  const { tab } = props.useTabInfo()
  const visible = tab.visible

  // ── Shared settings (read each render; the settings card writes the doc) ─
  const values = useSettings(props.settings)
  const rawServerUrl = values.serverUrl
  const effectiveServerUrl = rawServerUrl.trim() === '' ? DEFAULT_SERVER_URL : normalizeBaseUrl(rawServerUrl)
  const fullUrl = isFullServerUrl(effectiveServerUrl)
  const pathMap = parsePathMap(values.pathMap)
  const { maxLines, maxBytes } = readSettingCaps(values)

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

  // ── Session cwd: the sessions registry's live snapshot ─────────────────
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)

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

  // ── The open-navigation consumer (one-shot revision discipline) ────────
  const consumerRef = useRef<OpenRequestConsumer | null>(null)
  if (consumerRef.current === null) {
    consumerRef.current = new OpenRequestConsumer({
      execute: request => openerRef.current?.open(request),
      gateSettled: () => gateRef.current !== null && gateRef.current.settled(),
    })
  }
  const navigation = tab.navigation
  useEffect(() => {
    consumerRef.current?.update(navigation, sessionId, tab.id)
  }, [navigation.revision, navigation.params, sessionId, tab.id, gateState.phase])

  // The iframe target: the pending payload URL while one is valid for the
  // current basis, else the plain folder URL.
  const targetBasis = `${serverUrl}#${mapped ?? ''}`
  const effectivePending = pendingOpen !== null && pendingOpen.basis === targetBasis ? pendingOpen : null
  const target = effectivePending !== null
    ? effectivePending.url
    : buildVscodeUrl(serverUrl, mapped ?? null)

  // ── Focus guards: deferred first load ───────────────────────────────────
  // Hold the iframe back until this tab has been visible at least once
  // (active tab AND open panel — the official docked-body visibility; a
  // float is always visible): a takeover open landing this tab while the
  // panel is collapsed waits for its audience, because a hidden boot buys
  // nothing the user can see and only invites the focus grab.
  const [everVisible, setEverVisible] = useState(visible)
  useEffect(() => {
    if (visible) setEverVisible(true)
  }, [visible])

  // Hold the iframe until the cwd resolves (avoids loading the default
  // workspace first and flipping to ?folder= a moment later), until the
  // iframe base settles — a flip after the first load would reload the
  // workbench once for nothing — and until the tab has been shown once.
  const ready = cwd !== undefined && !resolvingBase && everVisible

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
      const outcome = await lander(sessionId, payload, {
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
  }, [sessionId, maxLines, maxBytes])

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
      { bornVisible: visible },
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

  // ── Full-bleed mounting: cancel the pane body's framing padding ────────
  // The docking kit pads every tab body (12px docked / 10px floated); the
  // workbench should BE the pane, so the root measures its host's padding
  // and pulls itself out to cover the padding box (fullBleed.ts).
  const bleed = useFullBleed<HTMLDivElement>()

  return (
    <div className="dsh_vscodeTab_root" ref={bleed.ref} style={bleed.style}>
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

      {/* Notices: unmappable workspace / degradations */}
      {unmapped && <NoticeRow text={t('unmapped')} />}
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
