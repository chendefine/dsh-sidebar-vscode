/**
 * The workbench runtime: the keeper that keeps ONE embedded VS Code
 * workbench alive across right-Sidebar tab switches.
 *
 * WHY A KEEPER: the official pane renders only the active tab's body, so
 * every switch away unmounts this plugin's tab body — and an iframe
 * element removed from its parent loses its nested browsing context per
 * the HTML spec ("The iframe HTML element removing steps … are to destroy
 * a child navigable"). No re-parenting dance can save it (verified
 * against Chromium 151: same-document moves of the iframe AND of its
 * ancestor container both reload it), and VS Code has no
 * snapshot/rehydrate path (the way `ui-sidebar-terminal` rehydrates its
 * xterm from the controller's screen revisions — the pattern this design
 * borrows, adapted to the one element type whose state IS its document).
 * The only survival strategy left: the iframe element NEVER leaves the
 * DOM, so the workbench state must outlive the React component that
 * opened it.
 *
 * WHAT THIS MODULE OWNS, then, is everything the old `VscodeView` kept
 * in per-mount refs, lifted into a page-scoped singleton:
 *
 * - the persistent HOST `div` under `document.body` and the iframe inside
 *   it (created once per workbench lifetime, removed only on destroy);
 * - the boot LOCK, boot GATE, focus FENCE and open-channel OPENER
 *   controllers (each already a headless, dependency-injected object —
 *   they move here unchanged in behavior, only their lifetime changes);
 * - the clipboard BRIDGE (re-installed per frame load, its payload sink
 *   routed to whichever view is attached);
 * - the rect PROJECTION (see `projection.ts`): the attached tab body's
 *   placeholder pins the host's box while that tab is visible.
 *
 * LIFECYCLE RULES (the leak discipline — every rule exists so that
 * nothing outlives the thing that justifies it):
 *
 * - ONE live workbench per page, by BASIS (`${serverUrl}#${mapped
 *   workspace}`): a second basis (another workspace, a settings edit)
 *   reloads the frame in place (`src` reassignment); it never creates a
 *   second VS Code instance — the boot lock exists precisely because two
 *   concurrent same-origin boots deadlock VS Code's IndexedDB.
 * - ADOPTERS: every attached view registers its tab's abort signal; the
 *   runtime survives view unmounts (a tab switch away must NOT destroy
 *   the workbench — that is this module's whole point) and dies when the
 *   LAST adopting tab record goes away (signal abort = the sidebar
 *   removed the record; sidebar close and session switches retain
 *   records, so switching back and forth is free).
 * - PLUGIN DISPOSE (HMR / unload): `destroyWorkbenchRuntime()` tears
 *   everything down — host element removed, listeners and observers
 *   disposed, controllers' own teardowns run.
 * - `release()` (the view's unmount path) detaches the projection and
 *   hides the host; the workbench keeps running invisibly (its boot
 *   finishes, its WebSocket stays open — switching back is INSTANT).
 *
 * The frame never mounts before its audience: creation is gated on the
 * same deferred-first-load rule the view had (visible at least once, cwd
 * resolved, base resolved), and the boot lock → gate → `src` sequence
 * preserves the exact ordering the React effects used to give. The focus
 * fence is minted at the first ATTACH with that attach's visibility —
 * the one sanctioned boot is the deferred first load a hidden component
 * later released, exactly as before.
 *
 * Everything browser-shaped is injected (element factory, body, style
 * adopter, frame timing), so the state machine unit-tests in a bare node
 * environment; the channel transport (`openChannelApi`) stays the real
 * one because the controllers own its cancellation.
 *
 * @module dsh-sidebar-vscode/client/workbenchRuntime
 */

import type { PathMapRule } from './paths.ts'
import { buildVscodeUrl, mapPath } from './paths.ts'
import { BootGateController, type BootGateStatus } from './bootGate.ts'
import { WorkbenchBootLock, acquireWebLock, type BootLockStatus } from './bootLock.ts'
import { FocusFenceController } from './focusFence.ts'
import { createWorkbenchOpener, type PendingOpen, type WorkbenchOpener } from './workbenchLink.ts'
import { installClipboardBridge, type ClipboardPayloadSink } from './clipboardBridge.ts'
import { OverlayProjector, type ProjectionAnchor, type ProjectorTiming } from './projection.ts'
import { adoptPluginStyles } from './styles.ts'
import {
  beginBoot,
  pollBootStatus,
  probeCapability,
  sendOpenCommand,
  type OpenCommand,
} from './openChannelApi.ts'

/** What a view feeds the runtime per render (undefined serverUrl = base re-resolving; hold the current one). */
export interface WorkbenchInputs {
  /** The RESOLVED iframe base (mount or direct); undefined while the base resolution is in flight. */
  readonly serverUrl: string | undefined
  /** The parsed `pathMap` rules. */
  readonly pathMap: readonly PathMapRule[]
  /** The session's authoritative cwd (undefined until resolved). */
  readonly cwd: string | undefined
}

/** The observable state the view renders from. */
export interface WorkbenchRuntimeSnapshot {
  /** The load key currently desired (target URL + reload nonce; '' before the first). */
  readonly loadKey: string
  /** Whether the iframe element exists (the first load has been released). */
  readonly frameAlive: boolean
  /** Whether the frame fired a load for the key it carries. */
  readonly loaded: boolean
  /** The pending degraded-channel payload URL, if any. */
  readonly pending: PendingOpen | null
  /** The boot gate's state (keyed reads are the view's discipline). */
  readonly gate: BootGateStatus
  /** The boot lock's state (keyed reads are the view's discipline). */
  readonly lock: BootLockStatus
  /** Which view's placeholder the projection follows (null = nobody's). */
  readonly projected: string | null
}

/**
 * The structural element face this module needs. The default binding is
 * the browser's; tests supply fakes, so it stays minimal: the style bag
 * the projector and frame dressing write, the iframe-ish members the
 * controllers read, and the child/remove plumbing the host needs.
 */
export interface RuntimeElement {
  readonly style: Record<
    'left' | 'top' | 'width' | 'height' | 'zIndex' | 'visibility' | 'opacity' | 'pointerEvents',
    string
  >
  src: string
  className: string
  title: string
  appendChild(child: unknown): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  remove(): void
}

/** The DOM factory the runtime builds its persistent pieces through. */
export interface RuntimeDom {
  /** Create one element (the host div, the frame). */
  createElement(tag: string): RuntimeElement
  /** Where the persistent host is appended; the host's `remove` takes it back out. */
  readonly body: { appendChild(child: unknown): void }
}

/** The browser-global binding (its members evaluate lazily — node imports stay safe). */
const defaultDom: RuntimeDom = {
  createElement: tag => document.createElement(tag) as unknown as RuntimeElement,
  get body() { return document.body },
}

/** The node-half channel face the controllers drive (the real API, injectable for tests). */
export interface WorkbenchChannel {
  /** Park one boot nonce (`boot.begin`). */
  beginBoot(folder: string, nonce: string): Promise<{ began: boolean, editors: string[] | null }>
  /** Whether the extension's receipt echoes the nonce (`boot.status`). */
  pollBootStatus(folder: string, nonce: string): Promise<boolean>
  /** The extension capability probe (false / build version). */
  probeCapability(folder: string): Promise<false | number>
  /** Hand one open command to the extension spool (`open.request`). */
  sendOpenCommand(command: OpenCommand): Promise<boolean>
}

const defaultChannel: WorkbenchChannel = {
  beginBoot: (folder, nonce) => beginBoot(folder, nonce),
  pollBootStatus: (folder, nonce) => pollBootStatus(folder, nonce),
  probeCapability: folder => probeCapability(folder),
  sendOpenCommand: command => sendOpenCommand(command),
}

/** The seams tests substitute (DOM, styles, timing, channel, lock). */
export interface WorkbenchRuntimeDeps {
  readonly dom: RuntimeDom
  /** Style-sheet adoption for the host sheet (default: the plugin registry). */
  readonly adoptStyles: () => () => void
  /** One-shot scheduling for the controllers' cadence. */
  readonly schedule: (callback: () => void, ms: number) => void
  /** The clock the controllers read. */
  readonly now: () => number
  /** The projection loop's frame timing. */
  readonly timing: ProjectorTiming
  /** The node-half channel (default: the real routes). */
  readonly channel: WorkbenchChannel
  /** The cross-tab boot lock acquisition (default: Web Locks, fail-open). */
  readonly acquireLock: () => Promise<(() => void) | null>
}

const defaultDeps: WorkbenchRuntimeDeps = {
  dom: defaultDom,
  adoptStyles: () => adoptPluginStyles('host'),
  schedule: (callback, ms) => { window.setTimeout(callback, ms) },
  now: () => Date.now(),
  timing: {
    requestAnimationFrame: callback => { return window.requestAnimationFrame(callback) },
    cancelAnimationFrame: handle => { window.cancelAnimationFrame(handle as number) },
  },
  channel: defaultChannel,
  acquireLock: () => acquireWebLock(),
}

/** One attached view's registration (the projection follows the LATEST attach). */
interface Attachment {
  /** The tab body's placeholder (the projection anchor). */
  readonly anchor: ProjectionAnchor | null
  /** Whether the tab is currently visible (active + expanded, or floated). */
  visible: boolean
}

/** The page-scoped singleton. At most one exists at any moment. */
let runtime: WorkbenchRuntime | null = null

/**
 * The runtime handle a view drives. Every method is safe after destroy
 * (a no-op), so a view never needs to know whether it outlives the
 * workbench it projects.
 */
export interface WorkbenchHandle {
  /** The iframe element (null before creation / after destroy); managed by the runtime, read by views. */
  element: RuntimeElement | null
  /** The open orchestrator (the view's navigation consumer drives it). */
  readonly opener: WorkbenchOpener
  /** Feed the latest resolved inputs (per render; undefined serverUrl = hold). */
  update(inputs: WorkbenchInputs): void
  /**
   * Attach this view: register the tab's abort signal (the runtime dies
   * when the LAST registered signal aborts), point the projection at the
   * placeholder, and feed the visibility flag. Re-attaching replaces the
   * current projection — only one view projects at a time.
   */
  attach(id: string, signal: AbortSignal, anchor: ProjectionAnchor | null, visible: boolean): void
  /** Feed the visibility flag without re-registering (panel collapse/expand). */
  setVisible(visible: boolean): void
  /** The view's unmount path: drop THIS view's projection, keep the workbench. */
  release(id: string): void
  /** The clipboard sink the bridge routes to (null = fall back to the readable text). */
  setPayloadHandler(handler: ClipboardPayloadSink | null): void
  /** The degradation-notice sink (transient UI state lives in the view). */
  setNoticeSink(sink: ((message: string) => void) | null): void
  /** Manual reload: drop any pending payload, force one fresh load of the same target. */
  reload(): void
  /** Whether the gate settled enough to run deferred open requests. */
  gateSettled(): boolean
  /** The boot tag an open command may carry (see the boot gate). */
  taggableNonce(): string | undefined
  /** The observable state the view renders from. */
  getSnapshot(): WorkbenchRuntimeSnapshot
  subscribe(listener: () => void): () => void
}

/**
 * Adopt (or create) the page's workbench runtime.
 *
 * The singleton is created on first use and reused while its basis holds;
 * a basis change reloads in place (never a second instance). A destroyed
 * runtime is replaced transparently by the next adopt.
 * @returns the handle every view of the workbench shares.
 */
export function adoptWorkbenchRuntime(): WorkbenchHandle {
  if (runtime === null) runtime = new WorkbenchRuntime(defaultDeps)
  return runtime.handle
}

/**
 * Tear the runtime down unconditionally (plugin dispose / HMR): host
 * removed from the body, every controller and listener disposed. Safe to
 * call with no live runtime.
 */
export function destroyWorkbenchRuntime(): void {
  runtime?.destroy()
  runtime = null
}

/**
 * Test-only: install a runtime built on injected seams into the
 * singleton slot (destroying any live one first).
 * @param deps - the fake DOM / styles / timing bundle.
 * @returns the handle the tests drive.
 */
export function installWorkbenchRuntimeForTest(deps: WorkbenchRuntimeDeps): WorkbenchHandle {
  destroyWorkbenchRuntime()
  runtime = new WorkbenchRuntime(deps)
  return runtime.handle
}

/** One client-randomness boot nonce (printable, bounded). */
function mintBootNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * One workbench lifetime: host + frame + controllers + adopters. Built
 * through {@link adoptWorkbenchRuntime} (or the test installer); destroyed
 * by the last adopter's signal abort or by {@link destroyWorkbenchRuntime}.
 */
class WorkbenchRuntime {
  private readonly listeners = new Set<() => void>()
  private readonly adopters = new Map<string, AbortSignal>()

  private inputs: WorkbenchInputs = { serverUrl: undefined, pathMap: [], cwd: undefined }
  /** The last RESOLVED base (the opener and target read it while re-resolving). */
  private resolvedServerUrl: string | undefined
  private visibleOnce = false
  private reloadNonce = 0
  private pending: PendingOpen | null = null
  /** Every mounted view's projection entry, keyed `${sessionId}:${tabId}`. */
  private readonly attachments = new Map<string, Attachment>()
  /** The entry the projection currently follows (the latest attach). */
  private activeId: string | null = null
  private payloadHandler: ClipboardPayloadSink | null = null
  private noticeSink: ((message: string) => void) | null = null

  private readonly host: RuntimeElement
  private frame: RuntimeElement | null = null
  private frameLoadListener: (() => void) | null = null
  private bridgeDispose: (() => void) | null = null
  private fence: FocusFenceController | null = null
  private fenceDispose: (() => void) | null = null
  private readonly disposeStyles: () => void

  /** The load key the frame's current `src` belongs to ('' = none yet). */
  private appliedKey = ''
  /** The load key the current inputs demand ('' = nothing resolvable). */
  private desiredKey = ''
  private loaded = false

  private readonly lock: WorkbenchBootLock
  private readonly gate: BootGateController
  readonly opener: WorkbenchOpener
  private readonly projector: OverlayProjector

  private snapshot: WorkbenchRuntimeSnapshot = {
    loadKey: '',
    frameAlive: false,
    loaded: false,
    pending: null,
    projected: null,
    // Controllers arrive in the constructor; these placeholders are
    // replaced by the first publish() before any listener can read them.
    gate: { key: '', phase: 'pending', nonce: '', workspace: '', ledger: null, revealed: false },
    lock: { key: '', state: 'waiting' },
  }

  private disposed = false

  constructor(private readonly deps: WorkbenchRuntimeDeps) {
    this.disposeStyles = deps.adoptStyles()
    this.host = deps.dom.createElement('div')
    this.host.className = 'dsh_vscodeHost'
    deps.dom.body.appendChild(this.host)

    this.lock = new WorkbenchBootLock({
      acquire: () => deps.acquireLock(),
      rendered: (): boolean => {
        try {
          const doc = this.frameDocument()
          return doc?.querySelector('.monaco-workbench') != null
        } catch {
          return false
        }
      },
      schedule: (callback, ms) => { deps.schedule(callback, ms) },
      now: () => deps.now(),
    })
    this.gate = new BootGateController({
      workspace: () => this.workspaceOf(),
      beginBoot: (folder, nonce) => deps.channel.beginBoot(folder, nonce),
      pollBootStatus: (folder, nonce) => deps.channel.pollBootStatus(folder, nonce),
      domSample: () => this.sampleTabSignature(),
      domPaths: () => this.sampleTabNames(),
      mintNonce: mintBootNonce,
      schedule: (callback, ms) => { deps.schedule(callback, ms) },
      now: () => deps.now(),
    })
    this.opener = createWorkbenchOpener({
      inputs: () => ({
        serverUrl: this.resolvedServerUrl ?? '',
        pathMap: this.inputs.pathMap,
        cwd: this.inputs.cwd,
      }),
      taggableNonce: () => this.gate.taggableNonce(),
      onNotice: message => { this.noticeSink?.(message) },
      onPendingChange: pending => {
        this.pending = pending
        this.advance()
      },
      probeCapability: folder => deps.channel.probeCapability(folder),
      sendOpenCommand: command => deps.channel.sendOpenCommand(command),
      pageHref: () => window.location.href,
      pageHost: () => window.location.host,
    })
    this.projector = new OverlayProjector(this.host, deps.timing)

    // The two progressions the React effects used to drive per key: the
    // lock's grant releases the gate, the gate's parking releases the
    // frame. Each controller transition re-runs the reconciler.
    this.lock.subscribe(() => { this.advance() })
    this.gate.subscribe(() => { this.advance() })
  }

  /** The handle face every view of this workbench shares. */
  private readonly handleInner: WorkbenchHandle = {
    element: null,
    opener: {
      open: async request => {
        if (!this.disposed) await this.opener.open(request)
      },
      clearPending: () => { if (!this.disposed) this.opener.clearPending() },
    },
    update: inputs => { this.update(inputs) },
    attach: (id, signal, anchor, visible) => { this.attach(id, signal, anchor, visible) },
    setVisible: visible => { this.setVisible(visible) },
    release: id => { this.release(id) },
    setPayloadHandler: handler => { this.setPayloadHandler(handler) },
    setNoticeSink: sink => { this.setNoticeSink(sink) },
    reload: () => { this.reload() },
    gateSettled: () => this.gate.settled(),
    taggableNonce: () => this.gate.taggableNonce(),
    getSnapshot: () => this.snapshot,
    subscribe: listener => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  get handle(): WorkbenchHandle {
    return this.handleInner
  }

  // ---- inputs & adoption -------------------------------------------------

  /** The mapped workspace of the addressed session (null while unresolved). */
  private workspaceOf(): string | null {
    const { pathMap, cwd } = this.inputs
    return cwd !== undefined ? mapPath(cwd, pathMap) : null
  }

  /** The target the current inputs demand (null while anything is unresolved). */
  private targetOf(): { url: string, basis: string } | null {
    if (this.resolvedServerUrl === undefined) return null
    const { pathMap, cwd } = this.inputs
    if (cwd === undefined) return null
    const mapped = mapPath(cwd, pathMap)
    if (mapped === null) return null
    const basis = `${this.resolvedServerUrl}#${mapped}`
    const url = this.pending !== null && this.pending.basis === basis
      ? this.pending.url
      : buildVscodeUrl(this.resolvedServerUrl, mapped)
    return { url, basis }
  }

  /** Feed the view's latest resolved inputs; reconcile the frame when they matter. */
  private update(inputs: WorkbenchInputs): void {
    if (this.disposed) return
    if (inputs.serverUrl !== undefined) this.resolvedServerUrl = inputs.serverUrl
    // The guard compares against what was last FED — not against
    // `resolvedServerUrl`, which the line above has already overwritten:
    // the live flow feeds `undefined` while the base resolves and the
    // RESOLVED value right behind it, and that resolution must run the
    // reconciler (the very first boot depends on it).
    const unchanged = (inputs.serverUrl === undefined || inputs.serverUrl === this.inputs.serverUrl)
      && inputs.pathMap === this.inputs.pathMap
      && inputs.cwd === this.inputs.cwd
    this.inputs = inputs
    if (unchanged) return
    this.advance()
  }

  /** Register one view: adopter signal + projection + fence mint on the first. */
  private attach(id: string, signal: AbortSignal, anchor: ProjectionAnchor | null, visible: boolean): void {
    if (this.disposed) return
    if (!this.adopters.has(id)) {
      this.adopters.set(id, signal)
      signal.addEventListener('abort', this.adoptAbort)
    }
    if (this.fence === null) {
      // Minted at the FIRST attach with that attach's visibility — the
      // view's own `bornVisible` rule: a boot released by a reveal (the
      // component mounted hidden) is the one sanctioned to take focus.
      this.fence = new FocusFenceController(
        {
          getFrame: () => this.frame as unknown as HTMLIFrameElement | null,
          now: () => this.deps.now(),
          setTimeout: (callback, ms) => { this.deps.schedule(callback, ms ?? 0) },
        },
        { bornVisible: visible },
      )
      this.fenceDispose = this.fence.attach()
    }
    this.attachments.set(id, { anchor, visible })
    // The LATEST attach owns the projection (two panes may hold one kind;
    // the one the user just acted on is the one that should show).
    this.activeId = id
    if (visible) this.visibleOnce = true
    this.syncProjection()
    this.advance()
  }

  /** Feed the visibility flag (panel collapse/expand with the tab still mounted). */
  private setVisible(visible: boolean): void {
    if (this.disposed) return
    const entry = this.activeId === null ? undefined : this.attachments.get(this.activeId)
    if (entry !== undefined) entry.visible = visible
    if (visible) this.visibleOnce = true
    this.syncProjection()
    this.advance()
  }

  /**
   * One view's unmount: keep the workbench, drop ITS projection — and if
   * it was the one projecting, fall back to the previous mounted view
   * (still-registered anchor), so a displaced pane regains the workbench
   * instead of staring at a blank surface.
   */
  private release(id: string): void {
    if (this.disposed) return
    this.attachments.delete(id)
    if (this.activeId === id) {
      let fallback: string | null = null
      for (const key of this.attachments.keys()) fallback = key
      this.activeId = fallback
    }
    this.syncProjection()
  }

  /** Point the projector and the fence at the active attachment (if any). */
  private syncProjection(): void {
    const entry = this.activeId === null ? undefined : this.attachments.get(this.activeId)
    this.projector.attach(entry?.anchor ?? null)
    this.projector.setVisible(entry?.visible ?? false)
    // The hidden fence stays armed whenever nobody projects: an invisible
    // frame can never be receiving aimed clicks.
    this.fence?.setVisible(entry?.visible ?? false)
    this.publish()
  }

  /** An adopter's tab record went away; the LAST one takes the workbench with it. */
  private readonly adoptAbort = (): void => {
    if (this.disposed) return
    for (const [id, signal] of this.adopters) {
      if (signal.aborted) this.adopters.delete(id)
    }
    if (this.adopters.size === 0) this.destroy()
  }

  /** Manual reload: fresh nonce, one fresh load of the same target. */
  private reload(): void {
    if (this.disposed) return
    this.opener.clearPending()
    this.pending = null
    this.reloadNonce += 1
    this.advance()
  }

  // ---- the frame reconciler ----------------------------------------------

  /**
   * The state machine's heart: move the frame toward the load the current
   * inputs demand, in the lock → gate → `src` order the React effects
   * used to give, then publish the derived snapshot. Idempotent — a
   * stable situation is a no-op (and publishes nothing new).
   */
  private advance(): void {
    if (this.disposed) return
    const target = this.visibleOnce ? this.targetOf() : null
    // The key names the FULL target (pending payload included): a target
    // change is a load change, exactly as the view's old `${target}#${nonce}`
    // load key treated it.
    const wantKey = target === null ? '' : `${target.url}#${this.reloadNonce}`

    if (wantKey !== this.desiredKey) {
      // A NEW load is demanded: retire the outgoing boot's nonce (the old
      // effect cleanup's `gate.fence()`), stand the lock cycle down, and
      // arm a fresh one for this key. A live frame keeps its old document
      // until the gate parks — a shorter blank than the old
      // unmount-and-remount ever gave.
      this.desiredKey = wantKey
      this.loaded = false
      this.gate.fence()
      this.lock.end()
      if (wantKey !== '') this.lock.begin(wantKey)
    }

    // Progression 1: the lock's grant releases the gate (once per key).
    const lock = this.lock.getSnapshot()
    if (this.desiredKey !== '' && lock.key === this.desiredKey && lock.state === 'held'
      && this.gate.getSnapshot().key !== this.desiredKey) {
      this.gate.begin(this.desiredKey)
    }

    // Progression 2: the gate's parking releases the frame (once per key).
    const gate = this.gate.getSnapshot()
    if (this.desiredKey !== '' && gate.key === this.desiredKey && gate.phase !== 'pending'
      && this.appliedKey !== this.desiredKey) {
      this.applySrc(this.desiredKey, target)
    }

    this.publish()
  }

  /** Assign the frame its target (creating the element on the first load). */
  private applySrc(loadKey: string, target: { url: string, basis: string } | null): void {
    if (target === null || this.disposed) return
    if (this.frame === null) {
      const frame = this.deps.dom.createElement('iframe')
      frame.className = 'dsh_vscodeTab_frame'
      frame.title = 'VSCode'
      this.frameLoadListener = () => { this.onFrameLoad() }
      frame.addEventListener('load', this.frameLoadListener)
      this.host.appendChild(frame)
      this.frame = frame
      this.handleInner.element = frame
    }
    // Assigned even when the string matches: a src assignment is a
    // navigation (the manual-reload path relies on it), and the
    // appliedKey guard keeps it once per load key.
    this.frame.src = target.url
    this.appliedKey = loadKey
    this.syncFrameStyle()
  }

  /** The frame's load event: the whole per-load wiring, once. */
  private onFrameLoad(): void {
    if (this.disposed) return
    this.loaded = true
    this.reinstallBridge()
    this.gate.frameLoaded()
    this.fence?.onFrameLoad()
    this.publish()
  }

  /** (Re)install the clipboard bridge against the current frame document + handler. */
  private reinstallBridge(): void {
    this.bridgeDispose?.()
    this.bridgeDispose = null
    if (this.frame === null) return
    const handler = this.payloadHandler
    this.bridgeDispose = installClipboardBridge(
      this.frame as unknown as HTMLIFrameElement,
      payload => (handler === null ? false : handler(payload)),
    )
  }

  /** Route the bridge's payloads (applied at once when a load already stands). */
  private setPayloadHandler(handler: ClipboardPayloadSink | null): void {
    this.payloadHandler = handler
    if (this.loaded) this.reinstallBridge()
  }

  private setNoticeSink(sink: ((message: string) => void) | null): void {
    this.noticeSink = sink
  }

  /** Publish the derived snapshot when — and only when — it moved. */
  private publish(): void {
    const next: WorkbenchRuntimeSnapshot = {
      loadKey: this.desiredKey,
      frameAlive: this.frame !== null,
      loaded: this.loaded,
      pending: this.pending,
      gate: this.gate.getSnapshot(),
      lock: this.lock.getSnapshot(),
      projected: this.activeId,
    }
    const prior = this.snapshot
    if (next.loadKey === prior.loadKey && next.frameAlive === prior.frameAlive
      && next.loaded === prior.loaded && next.pending === prior.pending
      && next.gate === prior.gate && next.lock === prior.lock
      && next.projected === prior.projected) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
    this.syncFrameStyle()
  }

  /** The boot-hidden / unloaded frame dressing (the element is ours to dress). */
  private syncFrameStyle(): void {
    const frame = this.frame
    if (frame === null) return
    const gate = this.gate.getSnapshot()
    const keyed = gate.key === this.appliedKey ? gate : null
    const bootHidden = keyed !== null
      && (keyed.phase === 'hidden' || keyed.phase === 'dom' || keyed.phase === 'rotating')
      && !keyed.revealed
    frame.style.visibility = !this.loaded ? 'hidden' : ''
    frame.style.opacity = bootHidden ? '0' : ''
    frame.style.pointerEvents = bootHidden ? 'none' : ''
  }

  /** The editor-tab signature the boot gate polls (null = cross-origin). */
  private sampleTabSignature(): string | null {
    const doc = this.frameDocument()
    if (doc === null) return null
    if (doc.querySelector('.monaco-workbench') === null) return ''
    const tabs = doc.querySelectorAll('.editor-group-container .tab')
    if (tabs.length === 0) return '(none)'
    const parts: string[] = []
    tabs.forEach(tab => {
      const label = tab.querySelector('.tab-label')
      parts.push(`${label !== null ? label.textContent ?? '' : ''}${tab.classList.contains('active') ? '*' : ''}`)
    })
    return parts.join('|')
  }

  /** The open-editor name strip the ledger gate samples (null = unreadable). */
  private sampleTabNames(): string[] | null {
    const doc = this.frameDocument()
    if (doc === null) return null
    if (doc.querySelector('.monaco-workbench') === null) return null
    const names: string[] = []
    doc.querySelectorAll('.editor-group-container .tab').forEach(tab => {
      names.push((tab.getAttribute('data-resource-name')
        ?? tab.querySelector('.tab-label')?.textContent ?? '').trim())
    })
    return names
  }

  /** The frame's live document, cross-origin-safe (null = unreadable). */
  private frameDocument(): Document | null {
    try {
      return (this.frame as unknown as { contentDocument?: Document | null } | null)?.contentDocument ?? null
    } catch {
      return null
    }
  }

  // ---- teardown ----------------------------------------------------------

  /** Destroy the workbench: host removed, controllers disposed, listeners gone. */
  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    for (const signal of this.adopters.values()) signal.removeEventListener('abort', this.adoptAbort)
    this.adopters.clear()
    this.attachments.clear()
    this.activeId = null
    this.projector.dispose()
    if (this.frameLoadListener !== null && this.frame !== null) {
      this.frame.removeEventListener('load', this.frameLoadListener)
    }
    this.bridgeDispose?.()
    this.fenceDispose?.()
    this.gate.fence()
    this.gate.dispose()
    this.lock.dispose()
    this.disposeStyles()
    this.host.remove()
    this.frame = null
    this.handleInner.element = null
    this.snapshot = { ...this.snapshot, frameAlive: false, loaded: false, loadKey: '' }
    for (const listener of this.listeners) listener()
    this.listeners.clear()
  }
}
