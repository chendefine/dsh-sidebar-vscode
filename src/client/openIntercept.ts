/**
 * The chat-open takeover's shared plumbing: the reroute driver, the
 * openRequest meta vehicle, and the `workspaces.openPath` wrapper — the
 * pieces both takeover seams (research options II + III) share.
 *
 * The three seams every chat-originated open can flow through:
 * - the turn-tail slot (option II, turnTail.tsx): the produced-files row
 *   (the "changed files" chips) is claimed at priority -2, before
 *   dsh-better-sidebar's own -1 entry, so its chips open here;
 * - `workspaces.openPath` (option III, below): the pre-gateway client
 *   runtime's funnel for the remaining chat-side opens (tool-row path
 *   links, prose file mentions — ui-conversation's apply.ts was its only
 *   production caller). This also repairs the headless-container hole:
 *   better-sidebar declines its own takeover whenever its built-in editor
 *   tab is disabled, letting opens fall through to the Host OS opener
 *   (`spawn xdg-open ENOENT`); this wrapper keeps them landing in the
 *   VSCode tab regardless.
 * - `remote.session.openWorkspacePath` (option III, the gateway era —
 *   wrapRemoteOpenWorkspacePath below): the current runtime's replacement
 *   funnel (ui-chat's injected openFile is its only production caller),
 *   wrapped through the same gate; exactly one of the two era-specific
 *   openPath wrappers ever installs.
 *
 * The reroute lands as: `openTab({ type: TAB_ID, path })` — a CONTENT seed,
 * so better-sidebar's own "land in sight" logic expands the hosting panel,
 * and the single-instance descriptor focuses an already-open tab — followed
 * by `updateTab(TAB_ID, { meta })` carrying an `openRequest` the VscodeView
 * consumes (meta is the documented cross-tab vehicle; a single-instance
 * focus never applies seed fields, hence the explicit update).
 *
 * Every gate may also reroute one path specifically through the optional
 * `blocked` dep — the open blocklist (openBlocklist.ts): a file type the
 * code editor renders poorly opens in better-sidebar's built-in Files tab
 * instead (its registered file viewers are the sidebar's own surface for
 * Office/image/PDF types), via the optional `rerouteBlocked` dep. When
 * that dep is absent or declines — the Files tab type disabled in the
 * side card settings, the same refusal better-sidebar's own takeover
 * makes — the open falls through to the stock Host opener, the same
 * untouched path a declined switch takes.
 *
 * Dependency-free by design (mirrors better-sidebar's openpath-intercept.ts)
 * so the takeover logic is unit-testable in isolation.
 *
 * @module dsh-sidebar-vscode/client/openIntercept
 */

/** The open-tab seed shape the reroute sends (structural subset of OpenTabSeed). */
export interface OpenTabSeed {
  type: string
  title?: string
  path?: string
  id?: string
  url?: string
  meta?: unknown
}

/** The betterSidebar service slice the reroute driver (below) touches. */
export interface InterceptServiceFace {
  openTab(seed: OpenTabSeed): void
  isTabEnabled(id: string): boolean
  updateTab(tabId: string, patch: { title?: string, path?: string, meta?: unknown }): void
  getSnapshot(): { sessionId?: string | undefined, state?: unknown }
}

/**
 * Per-call decisions the wrappers need (wired to the switch + service).
 */
export interface OpenInterceptDeps {
  /**
   * Whether to take over THIS call: the `openAsDefault` switch (the same
   * switch that seeds new sessions with the VSCode tab) must be on and the
   * VSCode tab type enabled. A declining call falls through untouched.
   */
  takeoverEnabled(): boolean
  /**
   * Decline the VSCode reroute for THIS PATH specifically — the open
   * blocklist (a file type the code editor renders poorly: Office
   * documents, images, PDFs; see openBlocklist.ts). A blocked path is
   * then offered to {@link rerouteBlocked} (the built-in Files tab) and
   * only falls through to the stock Host opener when that declines.
   * Optional: absent wiring blocks nothing (and the settings-open
   * takeover never wires it — its settings.yaml is a text document the
   * blocklist must not break).
   */
  blocked?(path: string): boolean
  /**
   * Reroute a BLOCKED path into better-sidebar's built-in Files tab — the
   * viewer surface for the types the code editor renders poorly. Return
   * true to claim the open (the wrapper resolves the stock success the
   * native opener would have); return false — or leave the dep absent —
   * to decline it back to the stock Host opener (the Files tab type
   * disabled in the side card settings; better-sidebar's own takeover
   * makes the same call, and the headless `xdg-open ENOENT` it can hit is
   * exactly why an accepting reroute must never surface an error).
   */
  rerouteBlocked?(path: string): boolean
  /** Route the open into the VSCode tab (open + meta update). */
  reroute(path: string): void
}

// ---- open-request vehicle (SidebarTab.meta) ----

/** One file-open request carried on the VSCode tab's meta. */
export interface OpenRequest {
  /** Monotonic id; consumers only act on values greater than the last one seen. */
  nonce: number
  /** The DSH-side absolute path to open. */
  path: string
  /**
   * The session whose workbench the request targets. Stamped at mint from
   * the session that produced the path; a consumer mounting another
   * session's VSCode tab declines the request (it would land the file in a
   * FOREIGN workspace — the observed cross-workspace poison deliveries).
   * Absent = wildcard (the settings takeover has no session context).
   */
  sessionId?: string
  /** Optional 1-based cursor position (reserved; produced chips are path-only). */
  line?: number
  column?: number
}

/**
 * Structurally read the openRequest off a tab meta. Returns null for absent
 * or malformed shapes — a foreign meta (another plugin's, or a hand-edited
 * layout) must never crash the consumer.
 */
export function extractOpenRequest(meta: unknown): OpenRequest | null {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
  const record = (meta as { openRequest?: unknown }).openRequest
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null
  const req = record as { nonce?: unknown, path?: unknown, sessionId?: unknown, line?: unknown, column?: unknown }
  if (typeof req.nonce !== 'number' || !Number.isFinite(req.nonce)) return null
  if (typeof req.path !== 'string' || req.path === '') return null
  const out: OpenRequest = { nonce: req.nonce, path: req.path }
  if (typeof req.sessionId === 'string' && req.sessionId !== '') out.sessionId = req.sessionId
  if (typeof req.line === 'number' && Number.isFinite(req.line) && req.line > 0) {
    out.line = Math.floor(req.line)
  }
  if (typeof req.column === 'number' && Number.isFinite(req.column) && req.column > 0) {
    out.column = Math.floor(req.column)
  }
  return out
}

/**
 * Whether `request` is addressed to the session whose VSCode tab mounted
 * the consumer. A request stamped with a `sessionId` (every chat-originated
 * open) only executes for that session — a page/window showing a DIFFERENT
 * conversation (its workbench embeds a different workspace folder) must
 * decline it, or the open lands a foreign file into that workspace's spool
 * (the exact cross-workspace delivery observed in the poisoned spools).
 * An unstamped request (the settings takeover, which has no session
 * context) stays a wildcard.
 */
export function requestAddressedTo(request: OpenRequest, sessionId: string | undefined): boolean {
  if (request.sessionId === undefined) return true
  return sessionId !== undefined && sessionId === request.sessionId
}

/**
 * Merge one openRequest into an existing tab meta, preserving sibling keys
 * (any other plugin-owned fields on the same meta object survive verbatim).
 */
export function mergeOpenRequest(meta: unknown, request: OpenRequest): Record<string, unknown> {
  const base = meta !== null && typeof meta === 'object' && !Array.isArray(meta)
    ? { ...(meta as Record<string, unknown>) }
    : {}
  base.openRequest = { ...request }
  return base
}

/**
 * Copy one tab meta WITHOUT its openRequest, preserving sibling keys.
 * Returns null when there was nothing to strip (the meta carried no
 * request) so callers skip a pointless store mutation.
 *
 * The openRequest is a ONE-SHOT command, not durable tab state: the
 * sidebar layout (meta included) is persisted and shared across windows
 * and reloads, so an executed-but-unstripped request sat in the layout
 * until some later remount mistook it for a fresh click — the mechanism
 * behind the hours-later re-executions that poisoned foreign workspaces'
 * spools. Stripping on consumption retires it for every observer.
 */
export function stripOpenRequest(meta: unknown): Record<string, unknown> | null {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null
  const record = meta as Record<string, unknown>
  if (!('openRequest' in record) || record.openRequest === undefined) return null
  const rest = { ...record }
  delete rest.openRequest
  return rest
}

/** The mutating store face the meta strip needs (SidebarStore.update). */
export interface MutatingStoreFace {
  update(mutator: (draft: unknown) => void): void
}

/**
 * Strip the VSCode tab's openRequest from the CURRENT session's persisted
 * layout. One-shot semantics for a one-shot command: call after executing
 * (or declining) a request. Fail-soft by construction — a store without
 * `update` (a foreign peer) is a no-op, and a missing tab id simply finds
 * nothing to strip.
 */
export function clearTabOpenRequest(store: MutatingStoreFace | undefined, tabId: string): void {
  if (store === undefined || typeof store.update !== 'function') return
  try {
    store.update(draft => { stripOpenRequestFromState(draft, tabId) })
  } catch {
    // Never let hygiene break the open path.
  }
}

/** Find the tab in one sidebar state draft and strip its meta request. */
function stripOpenRequestFromState(state: unknown, tabId: string): void {
  if (state === null || typeof state !== 'object') return
  const record = state as { splits?: unknown, bottomSplits?: unknown }
  if (stripOpenRequestFromNode(record.splits, tabId)) return
  stripOpenRequestFromNode(record.bottomSplits, tabId)
}

function stripOpenRequestFromNode(node: unknown, tabId: string): boolean {
  if (node === null || typeof node !== 'object') return false
  const record = node as { kind?: unknown, tabs?: unknown, children?: unknown }
  if (record.kind === 'leaf' && Array.isArray(record.tabs)) {
    for (const tab of record.tabs) {
      if (tab !== null && typeof tab === 'object' && (tab as { id?: unknown }).id === tabId) {
        const target = tab as { meta?: unknown }
        const stripped = stripOpenRequest(target.meta)
        if (stripped !== null) {
          target.meta = Object.keys(stripped).length > 0 ? stripped : undefined
          return true
        }
        return false
      }
    }
    return false
  }
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      if (stripOpenRequestFromNode(child, tabId)) return true
    }
  }
  return false
}

/** The last minted nonce (module state — one monotonic sequence per page). */
let lastNonce = 0

/**
 * Mint the next nonce: wall-clock based so sequences survive reloads, but
 * strictly monotonic within a page (two clicks in the same millisecond must
 * still produce increasing values, or the second would be swallowed).
 */
export function nextNonce(now: () => number = Date.now): number {
  const current = now()
  lastNonce = current > lastNonce ? current : lastNonce + 1
  return lastNonce
}

// ---- state walk + path resolution (reroute plumbing) ----

/** The tab shape the meta walk reads. */
interface TabShape {
  id: string
  meta?: unknown
}

/** The split-tree shape the meta walk descends (leaf | split). */
type WalkShape =
  | { kind: 'leaf', tabs: TabShape[] }
  | { kind: 'split', children: WalkShape[] }

/**
 * Find one tab's meta in a sidebar state (both trees — splits and
 * bottomSplits — are searched). Structural and throw-free: a malformed state
 * simply yields undefined, and `updateTab` on a missing tab is a documented
 * no-op, so a walk failure can never break the reroute.
 */
export function findTabMeta(state: unknown, tabId: string): unknown {
  if (state === null || typeof state !== 'object') return undefined
  const record = state as { splits?: unknown, bottomSplits?: unknown }
  const top = walkTab(record.splits, tabId)
  if (top !== undefined) return top
  return walkTab(record.bottomSplits, tabId)
}

function walkTab(node: unknown, tabId: string): unknown {
  if (node === null || typeof node !== 'object') return undefined
  const record = node as { kind?: unknown, tabs?: unknown, children?: unknown }
  if (record.kind === 'leaf' && Array.isArray(record.tabs)) {
    for (const tab of record.tabs) {
      if (tab !== null && typeof tab === 'object' && (tab as TabShape).id === tabId) {
        return (tab as TabShape).meta
      }
    }
    return undefined
  }
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      const found = walkTab(child, tabId)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** Whether a path is absolute (POSIX root, drive letter, or UNC share). */
export function isAbsoluteLike(path: string): boolean {
  if (path.startsWith('/')) return true
  if (path.startsWith('\\\\')) return true
  return /^[a-zA-Z]:[\\/]/.test(path)
}

/**
 * Resolve a (possibly relative) path against the session cwd. The seams
 * differ here: the openPath-funnel callers (ui-conversation's apply.ts on
 * the pre-gateway runtime, ui-chat's openFile now) already resolve to
 * absolute, while turn-tail produced paths come
 * straight from tool callView `locations` and may be workspace-relative —
 * better-sidebar's own `openSidebarFile` resolves them against the session
 * cwd the same way. Mirrors its `resolveSidebarPath` semantics.
 */
export function resolveAgainst(cwd: string | undefined, path: string): string {
  if (isAbsoluteLike(path)) return path
  const base = cwd ?? ''
  if (base === '') return path
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${path}`
}

/**
 * The reroute driver both seams share: land the VSCode tab (content seed →
 * panel auto-expansion + single-instance focus) and stamp the openRequest
 * meta. The `openTab` call lands on the real service untouched — neither
 * seam wraps openTab (option I was rolled back), and the openPath wrapper
 * is not on this path. `sessionId` (the session whose workbench the open
 * targets) rides the request so a consumer in another session's tab
 * declines it instead of delivering a foreign file.
 */
export function rerouteChatOpen(
  service: InterceptServiceFace,
  tabId: string,
  path: string,
  sessionId?: string,
): void {
  service.openTab({ type: tabId, path })
  const state = service.getSnapshot().state
  const request: OpenRequest = { nonce: nextNonce(), path }
  if (sessionId !== undefined && sessionId !== '') request.sessionId = sessionId
  service.updateTab(tabId, { meta: mergeOpenRequest(findTabMeta(state, tabId), request) })
}

// ---- blocklist-hit reroute (the built-in Files tab) ----

/** better-sidebar's built-in Files tab type (the editor/files window). */
export const SIDEBAR_FILES_TAB_TYPE = 'editor'

/**
 * The open-tab seed that lands one file in better-sidebar's built-in
 * Files tab: a structural twin of its own openSidebarFile (intercept.tsx)
 * — the per-path id lets multiple files coexist while the editor
 * descriptor's path dedupeKey focuses an already-open one, and the title
 * shows the file name. No meta vehicle and no updateTab: the editor tab
 * consumes its path seed natively (openTab alone is the whole reroute).
 */
export function filesTabSeed(absolutePath: string): OpenTabSeed {
  const at = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'))
  const title = at === -1 ? absolutePath : absolutePath.slice(at + 1)
  return { type: SIDEBAR_FILES_TAB_TYPE, title, path: absolutePath, id: `editor:${absolutePath}` }
}

/**
 * The blocklist-hit reroute driver: land the file in the sidebar's
 * built-in Files tab, whose registered file viewers render exactly the
 * types the code editor shows poorly (images, PDFs, Office documents —
 * plus any viewer a companion plugin like dsh-sidebar-onlyoffice
 * registers). Callers gate on `isTabEnabled(SIDEBAR_FILES_TAB_TYPE)`
 * first: this driver sends the seed unconditionally, and a disabled type
 * is the service's own refusal contract (warn + no-op).
 */
export function rerouteFilesOpen(service: InterceptServiceFace, absolutePath: string): void {
  service.openTab(filesTabSeed(absolutePath))
}

// ---- workspaces.openPath interception (option III — the legacy runtime funnel) ----

/** The client workspaces service slice the wrapper replaces (runtime IWorkspaces mirror). */
export interface WorkspacesLike {
  openPath(path: string): Promise<void>
}

/**
 * Wrap `workspaces.openPath` — the client runtime's chat file-open funnel —
 * with the SAME takeover gate and reroute as the turn-tail claim (option II).
 *
 * Why this second seam is needed: better-sidebar declines BOTH of its own
 * interceptions whenever its built-in editor tab is disabled in the side
 * card settings (`tabsEnabled['editor'] === false` gates the turn-tail row
 * AND its openPath wrapper — see its intercept.tsx). The open then falls
 * through to the Host OS opener, which on a headless container dies with
 * `spawn xdg-open ENOENT`. Wrapping openPath here keeps chat file opens
 * landing in the VSCode tab even when the user disabled better-sidebar's
 * Files tab (a natural pairing: files belong in VS Code, not the built-in
 * editor).
 *
 * Fail-soft at the seam like wrapSettingsOpenDocument: a workspaces
 * service without a callable `openPath` member (a runtime whose mirror
 * carries a different shape) installs nothing — the funnel keeps its
 * stock behavior and the plugin still activates.
 *
 * Chain-safety: better-sidebar wraps the same method with the identical
 * RAW-reference restore contract, so the two wrappers compose in any
 * install/dispose order. With both active and the switch on, THIS wrapper
 * (installed later, runs first) intercepts and the call never reaches
 * better-sidebar's — same destination either way.
 *
 * @param workspaces - the client workspaces service to wrap.
 * @param deps - per-call takeover decisions (the same gate as the turn-tail claim's).
 * @returns the disposer restoring the original method (HMR-safe).
 */
export function wrapWorkspacesOpenPath(workspaces: WorkspacesLike, deps: OpenInterceptDeps): () => void {
  const original = workspaces.openPath
  if (typeof original !== 'function') {
    return () => {}
  }
  workspaces.openPath = (path: string): Promise<void> => {
    if (deps.takeoverEnabled() && typeof path === 'string' && path !== '') {
      if (deps.blocked?.(path) === true) {
        // A blocklist hit: the built-in Files tab takes it when the
        // wiring accepts; a refusal (tab type disabled) falls through to
        // the stock Host opener below.
        if (deps.rerouteBlocked?.(path) === true) {
          // Callers ignore the result; resolving as success mirrors
          // better-sidebar's own wrapper (a swallowed open must not
          // surface the host's xdg-open rejection to the chat UI).
          return Promise.resolve()
        }
      } else {
        deps.reroute(path)
        // Callers ignore the result; resolving as success mirrors
        // better-sidebar's own wrapper (a swallowed open must not surface
        // the host's xdg-open rejection to the chat UI).
        return Promise.resolve()
      }
    }
    return original.call(workspaces, path)
  }
  return () => {
    workspaces.openPath = original
  }
}

// ---- gateway namespace method redefinition (shared takeover mechanics) ----

/**
 * Redefine one gateway-namespace method with a per-access replacement.
 *
 * The gateway's client projection mounts Remote namespace methods
 * (`remote.<ns>.<method>`) as configurable, getter-only own properties — no
 * setter, so plain assignment throws — and every getter access returns a
 * FRESH invocation closure resolved against the live mount. This helper
 * redefines the property with its own getter that re-invokes the original
 * getter on every access and hands the yielded closure through
 * `makeInterceptor`, so each caller still resolves a fresh chain against the
 * live mount — exactly the stock semantics.
 *
 * The disposer restores the saved descriptor, but only while OUR getter is
 * still the installed one: the gateway deletes the property when it unmounts
 * the method and re-creates it on remount, and clobbering either state with
 * the saved (stale) descriptor would resurrect a dead mount.
 *
 * Fail-soft at the seam: a target carrying no such own property, a non-getter
 * descriptor (a plain value method — a foreign runtime shape), or a getter
 * that does not yield a callable installs nothing.
 *
 * @param target - the namespace service object (or any face carrying the method).
 * @param method - the own property name to redefine.
 * @param makeInterceptor - wraps one original closure; invoked once per
 * property access, so the interceptor never holds a stale mount.
 * @returns the disposer restoring the original descriptor (HMR-safe).
 */
export function redefineGetterMethod<Original extends (...args: never[]) => unknown>(
  target: object,
  method: string,
  makeInterceptor: (original: Original) => Original,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, method)
  if (descriptor === undefined || typeof descriptor.get !== 'function') {
    return () => {}
  }
  // Probe the stock getter once: it must yield the callable invocation
  // closure callers expect (a getter of any other shape is a foreign runtime).
  if (typeof descriptor.get.call(target) !== 'function') {
    return () => {}
  }
  const readOriginal = descriptor.get
  const wrapperGetter = (): Original => {
    const original = readOriginal.call(target) as Original
    return makeInterceptor(original)
  }
  Object.defineProperty(target, method, {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: wrapperGetter,
  })
  return () => {
    const current = Object.getOwnPropertyDescriptor(target, method)
    if (current?.get === wrapperGetter) {
      Object.defineProperty(target, method, descriptor)
    }
  }
}

// ---- remote.session.openWorkspacePath interception (option III — the gateway-era funnel) ----

/**
 * The funnel's result faces (structural subset of the runtime's `RemoteResult`:
 * `{ ok: true, value } | { ok: false, error }`).
 */
export type RemoteOpenResult =
  | { ok: true, value: { opened: true } }
  | { ok: false, error: Error }

/**
 * The remote session namespace slice the wrapper replaces. `openWorkspacePath`
 * is optional because the seam is fail-soft: a namespace without the mounted
 * method (older runtime, method unmounted) installs nothing.
 */
export interface RemoteSessionLike {
  openWorkspacePath?(request: { readonly path: string }, signal?: AbortSignal): Promise<RemoteOpenResult>
}

/**
 * Wrap `remote.session.openWorkspacePath` — the chat file-open funnel of the
 * gateway-era client runtime — with the SAME takeover gate and reroute as the
 * legacy `workspaces.openPath` wrapper above.
 *
 * Why this seam exists: the runtime that replaced `workspaces.openPath` routes
 * every chat-side file open through the `session/openWorkspacePath` Host
 * Remote (ui-chat's injected `openFile` — the Read/Write/... tool-row path
 * links and prose file mentions — is its only production caller), which drives
 * the Host's native opener (`xdg-open` — dead on a headless container). The
 * service now owning the `workspaces` key (the workspace controller) carries
 * no opener at all, so the legacy wrapper above installs nothing there and
 * this seam takes over instead. On the pre-gateway runtime the reverse holds:
 * this wrapper is never installed (the namespace service never appears) and
 * the legacy one keeps the takeover.
 *
 * Mechanics (property redefinition, per-access original, restore-only-ours)
 * live in {@link redefineGetterMethod}; fail-soft at the seam like
 * wrapWorkspacesOpenPath: a service carrying no such property (method not
 * mounted, or a runtime whose namespace shape differs) installs nothing and
 * the funnel keeps its stock behavior.
 *
 * @param session - the remote session namespace service to wrap.
 * @param deps - per-call takeover decisions (the same gate as the turn-tail claim's).
 * @returns the disposer restoring the original property descriptor (HMR-safe).
 */
export function wrapRemoteOpenWorkspacePath(session: RemoteSessionLike, deps: OpenInterceptDeps): () => void {
  return redefineGetterMethod<NonNullable<RemoteSessionLike['openWorkspacePath']>>(
    session, 'openWorkspacePath',
    original => (request: unknown, signal?: AbortSignal): Promise<RemoteOpenResult> => {
      const path = request !== null && typeof request === 'object'
        ? (request as { path?: unknown }).path
        : undefined
      if (deps.takeoverEnabled() && typeof path === 'string' && path !== '') {
        if (deps.blocked?.(path) === true) {
          // A blocklist hit: the built-in Files tab takes it when the
          // wiring accepts; a refusal (tab type disabled) falls through
          // to the stock closure below.
          if (deps.rerouteBlocked?.(path) === true) {
            // Callers check `result.ok`; an intercepted open reports the
            // same success the native receipt would (a rerouted open must
            // not surface the Host opener's failure — or the headless
            // `xdg-open ENOENT` — to the chat UI).
            return Promise.resolve({ ok: true, value: { opened: true } })
          }
        } else {
          deps.reroute(path)
          // Callers check `result.ok`; an intercepted open reports the
          // same success the native receipt would (a rerouted open must
          // not surface the Host opener's failure — or the headless
          // `xdg-open ENOENT` — to the chat UI).
          return Promise.resolve({ ok: true, value: { opened: true } })
        }
      }
      return original(request as { readonly path: string }, signal)
    },
  )
}
