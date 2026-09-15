/**
 * The `vscode` tab body of the official right Sidebar: the projection
 * and chrome of the persistent workbench.
 *
 * THE SHAPE: the official pane renders only the ACTIVE tab's body, and an
 * iframe removed from its parent loses its browsing context (HTML spec:
 * iframe removing steps destroy the child navigable — every DOM move
 * reloads it; verified against Chromium 151). A VS Code workbench has no
 * snapshot/rehydrate path, so this component does NOT own the iframe —
 * `workbenchRuntime.ts` does, inside a host `div` that never leaves
 * `document.body`. What renders here is a PLACEHOLDER (the projection
 * anchor the runtime's projector pins the host's box to), the toolbar,
 * the notices, and the loading overlay; every boot-gating controller
 * (base resolution aside) lives in the runtime and outlives this
 * component's mounts, which is exactly why switching to a sibling tab
 * and back costs nothing: the workbench never even noticed.
 *
 * What stays per-mount:
 * - the session cwd resolution (the sessions registry's live snapshot —
 *   the official standard `useSessions` prop) and the settings read,
 *   both fed INTO the runtime each render;
 * - the iframe BASE resolution (`workbenchBase.ts`) — a mount-scoped
 *   ask whose transient 'resolving' state never tears the live frame
 *   down (the runtime holds its last resolved base until a DIFFERENT one
 *   lands);
 * - the reference lander's payload handler and the paste-fallback
 *   options feed (`referencePipeline.ts`);
 * - the navigation consumer (`openRequests.ts`) driving the runtime's
 *   opener through `tab.navigation`'s one-shot revision discipline;
 * - the first-gesture interact stamping for the revealed frame.
 *
 * Props are the official keyed-seat share: the framework-bound
 * `useTabInfo()` (live sidebar/panel/tab state — `tab.visible` is the
 * docked-active-or-floating visibility, `tab.navigation` carries the
 * takeover's `openTab` params with a monotonic revision, `tab.signal`
 * aborts when the sidebar removes the record), the session-scoped
 * standard props (`sessionId`, `useSessions`), and this plugin's
 * injected settings scope (the `vscode-sidebar` namespace).
 *
 * Design notes that belong to the view itself:
 * - The root mounts FULL-BLEED: the docking kit pads every tab body
 *   (`.paneBody` 12px docked, `.floatBody` 10px floated), and a workbench
 *   reads as the pane itself, not a framed picture — `fullBleed.ts`
 *   measures the host's padding and cancels it edge to edge.
 * - The iframe itself is NOT sandboxed and is served same-origin
 *   (through the host half's built-in `/sidebar/vscode` proxy, or the
 *   deployment's gateway subpath — cookies flow, the WebSocket terminal
 *   works). Its FIRST load is deferred until the tab has been visible
 *   once (the runtime's `visibleOnce` gate — a workbench booted inside a
 *   hidden iframe steals the caret from the composer via its Getting
 *   Started page, so the boot waits for an audience).
 * - All chrome follows the DSH appearance (light / dark / system) through
 *   the host's `--dsw-alias-*` tokens (the tab stylesheet lives in
 *   styles.ts, adopted by the plugin body with the body registration).
 *
 * @module dsh-sidebar-vscode/client/VscodeView
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { useWorkbenchBase } from './workbenchBase.ts'
import { useFullBleed } from './fullBleed.ts'
import { adoptWorkbenchRuntime, type WorkbenchRuntimeSnapshot } from './workbenchRuntime.ts'
import { OpenRequestConsumer } from './openRequests.ts'
import type { ClipboardPayload } from './selection.ts'
import { getReferenceLander, setFallbackOptions } from './referencePipeline.ts'
import { reportUserInteract } from './openChannelApi.ts'
import type { BootGateStatus } from './bootGate.ts'
import { t } from './i18n.ts'

/** The framework-bound tab-info hook's answer (structural subset the view reads). */
export interface VscodeTabInfo {
  readonly tab: {
    readonly id: string
    /** Docked bodies need an expanded sidebar and an active tab; floats stay visible. */
    readonly visible: boolean
    /** Aborts when the sidebar removes this tab's record (close, session cleanup). */
    readonly signal: AbortSignal
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

/** The keyed boot-gate read for a load key the gate has not met yet. */
const UNGATED: BootGateStatus = { key: '', phase: 'pending', nonce: '', workspace: '', ledger: null, revealed: false }

/**
 * Render the VS Code workbench's seat for the session's workspace: the
 * placeholder the persistent workbench is projected over, plus its chrome.
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
  // Parsed once per spec string: the runtime's input guard compares by
  // reference, so a fresh array per render would feed it endlessly.
  const pathMap = useMemo(() => parsePathMap(values.pathMap), [values.pathMap])
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

  // Latest values for the async paths (avoids stale closures): the
  // interact stamping and the bridge handler all read this.
  const inputsRef = useRef({ serverUrl, pathMap, cwd })
  inputsRef.current = { serverUrl, pathMap, cwd }

  // ── The persistent workbench runtime (the page singleton) ───────────────
  const runtime = adoptWorkbenchRuntime()
  const [snapshot, setSnapshot] = useState<WorkbenchRuntimeSnapshot>(runtime.getSnapshot())
  // A LAYOUT effect declared BEFORE the attach below: attach() publishes
  // the projection-ownership change synchronously, and the subscriber
  // must already be standing or this render's stale snapshot (projected:
  // null from before the mount) would never refresh — the loading
  // overlay would stick under the (perfectly alive) projected frame.
  useLayoutEffect(() => runtime.subscribe(() => { setSnapshot(runtime.getSnapshot()) }), [runtime])

  // Feed the resolved inputs. A 'resolving' base feeds undefined — the
  // runtime HOLDS its live frame (a transient re-resolution after a
  // remount must not reload the workbench) and only swaps on a different
  // RESOLVED base.
  useEffect(() => {
    runtime.update({
      serverUrl: resolvingBase ? undefined : serverUrl,
      pathMap,
      cwd,
    })
  }, [runtime, serverUrl, resolvingBase, pathMap, cwd])

  // ── Projection: adopt the runtime, pin it to this body's placeholder ────
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  // The adopter identity: the runtime dies when the LAST adopting tab
  // record goes away (signal abort), and survives this body's unmounts.
  const viewId = `${sessionId}:${tab.id}`
  useLayoutEffect(() => {
    runtime.attach(viewId, tab.signal, surfaceRef.current, visible)
    return () => { runtime.release(viewId) }
    // `visible` is deliberately absent: attach carries it once, the
    // visibility effect below feeds every later flip, and an unmount is
    // the only teardown that means "this body is gone".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, viewId, tab.signal])
  useLayoutEffect(() => { runtime.setVisible(visible) }, [runtime, visible])

  // ── The open-navigation consumer (one-shot revision discipline) ────────
  const consumerRef = useRef<OpenRequestConsumer | null>(null)
  if (consumerRef.current === null) {
    consumerRef.current = new OpenRequestConsumer({
      execute: request => runtime.opener.open(request),
      gateSettled: () => runtime.gateSettled(),
    })
  }
  const navigation = tab.navigation
  useEffect(() => {
    consumerRef.current?.update(navigation, sessionId, tab.id)
  }, [navigation.revision, navigation.params, sessionId, tab.id, snapshot.gate])

  // The toolbar's pop-out target: the pending payload URL while one is
  // valid for the current basis, else the plain folder URL.
  const targetBasis = `${serverUrl}#${mapped ?? ''}`
  const effectivePending = snapshot.pending !== null && snapshot.pending.basis === targetBasis ? snapshot.pending : null
  const target = effectivePending !== null
    ? effectivePending.url
    : buildVscodeUrl(serverUrl, mapped ?? null)

  // ── Keyed reads off the runtime snapshot (the display discipline) ───────
  const loadKey = snapshot.loadKey
  const bootGate = snapshot.gate.key === loadKey
    ? snapshot.gate
    : UNGATED
  const revealed = bootGate.revealed
  const bootHidden = (bootGate.phase === 'hidden' || bootGate.phase === 'dom' || bootGate.phase === 'rotating') && !revealed
  const lockQueued = snapshot.lock.key === loadKey && snapshot.lock.state === 'queued'
  const frameEl = snapshot.frameAlive ? runtime.element : null

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
    const doc = (frameEl as unknown as { readonly contentDocument?: Document | null } | null)?.contentDocument ?? null
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
    // `frameEl` is the runtime's live element, tracked through the
    // snapshot's frameAlive flag it mirrors.
  }, [revealed, bootGate.phase, bootGate.nonce, loadKey, snapshot.frameAlive])

  // ── Capture caps + the paste-fallback options feed ─────────────────────
  // Kept fresh in an effect (never mid-render): the dock's paste fallback
  // reads the latest values at paste time.
  useEffect(() => {
    setFallbackOptions({ reverseRules: pathMap, cwd, maxLines, maxBytes })
  })

  // ── The clipboard bridge's payload sink (same-origin envelopes) ─────────
  // Registered while this body is mounted: a copy made from a hidden
  // workbench falls back to the readable text on the clipboard (the
  // bridge's own degraded path), exactly as an unmounted body behaved.
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
  useEffect(() => {
    runtime.setPayloadHandler(handlePayload)
    runtime.setNoticeSink(message => { setFlash(message) })
    return () => {
      runtime.setPayloadHandler(null)
      runtime.setNoticeSink(null)
    }
  }, [runtime, handlePayload])

  // ── Full-bleed mounting: cancel the pane body's framing padding ────────
  // The docking kit pads every tab body (12px docked / 10px floated); the
  // workbench should BE the pane, so the root measures its host's padding
  // and pulls itself out to cover the padding box (fullBleed.ts).
  const bleed = useFullBleed<HTMLDivElement>()

  // The surface's own state: ready (cwd + base resolved), frame alive,
  // loaded, revealed, and THIS body holding the projection — everything
  // the overlay needs. The iframe itself lives in the runtime's
  // persistent host, projected over this surface's box while the tab is
  // visible (a displaced pane — two panes, one workbench — reads as
  // loading rather than a blank surface).
  const ready = cwd !== undefined && !resolvingBase
  const projected = snapshot.projected === viewId
  const showLoading = !ready || !projected || !snapshot.frameAlive || !snapshot.loaded || bootHidden

  return (
    <div className="dsh_vscodeTab_root" ref={bleed.ref} style={bleed.style}>
      <Toolbar
        mapped={mapped}
        target={target}
        onReload={() => {
          // A manual reload drops any pending degraded-channel payload:
          // VS Code consumes `payload` only at workbench startup, so a
          // reload at the stale payload URL would bounce the workbench
          // back to that old file. The runtime clears the pending state
          // and re-assigns the plain folder URL's load in the same call.
          runtime.reload()
        }}
      />

      {/* Notices: unmappable workspace / degradations */}
      {unmapped && <NoticeRow text={t('unmapped')} />}
      {flash !== null && <NoticeRow text={flash} />}

      {/* The workbench's projection anchor */}
      <div className="dsh_vscodeTab_surface" ref={surfaceRef}>
        {showLoading
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
