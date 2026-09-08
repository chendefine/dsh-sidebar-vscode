/**
 * The takeover family's installation: every seam that reroutes a
 * host-side file open into the embedded VS Code workbench, wired through
 * ONE gate and ONE decision core instead of four hand-rolled copies.
 *
 * The seams (research options II + III + IV), all behind the same
 * `openAsDefault` switch and the same open blocklist:
 *
 * - **Option II — the turn-tail slot** (`turnTail.tsx` + `producedFiles.ts`):
 *   the produced-files row (the "changed files" chips) is claimed at
 *   priority -2, before dsh-better-sidebar's own -1 entry, so its chips
 *   open the files in the VSCode tab. A decline (switch off / tab
 *   disabled / nothing produced) falls through to its row unchanged.
 * - **Option III — the chat file-open funnels**: exactly one era-specific
 *   seam ever installs — the gateway-era runtime routes every chat-side
 *   open (tool-row path links, prose mentions) through the
 *   `remote.session.openWorkspacePath` Host Remote (reached through a
 *   NESTED inject that parks until the namespace exists; ui-chat's
 *   injected `openFile` is its only production caller); the pre-gateway
 *   runtime through the `workspaces.openPath` client service. Wrapping
 *   them also repairs the headless hole: better-sidebar declines its own
 *   takeover when its built-in Files tab is disabled, letting opens die
 *   on the Host OS opener (`spawn xdg-open ENOENT`).
 * - **Option IV — the settings open-document button** (`settingsTakeover.ts`):
 *   the settings page's「打开配置文件」click resolves the document through
 *   this plugin's own fenced node-half route and opens it in the VSCode
 *   tab, closing the settings dialog behind it. Two era-specific seams
 *   again (`remote.settings.openSettingsDocument` vs the legacy
 *   `connection.api.settings.openDocument`); exactly one ever intercepts.
 *
 * Cross-cutting wiring that lives HERE so no seam carries its own copy:
 *
 * - the gate: `takeoverEnabled` = the switch is on AND the VSCode tab
 *   type enabled (evaluated per call, so flipping the switch applies to
 *   the very next click);
 * - the open blocklist (`openBlocklist.ts`), read per call: a file type
 *   the code editor renders poorly (Office/image/PDF …) declines the
 *   VSCode reroute and opens in better-sidebar's built-in Files tab
 *   instead — the stock Host opener only when that tab type is disabled;
 * - session addressing: every reroute is stamped with the session whose
 *   workbench it targets, and cwd resolution for workspace-relative
 *   produced paths;
 * - peer interop: dsh-better-sidebar ≥ 0.18.0 shadows the same
 *   `openWorkspacePath` method with a value-property wrapper of its own,
 *   and a peer disable/enable cycle can re-run its shadow AFTER this
 *   install — the one-shot re-assert a few seconds in restores the
 *   outermost slot with no polling (an undisplaced wrap just chains a
 *   harmless extra layer).
 *
 * @module dsh-sidebar-vscode/client/takeovers
 */

import { TAB_ID, readSettingValue } from './settings.ts'
import { OPEN_AS_DEFAULT_KEY } from './defaultTab.ts'
import { isBlockedPath, readOpenBlocklist } from './openBlocklist.ts'
import {
  rerouteChatOpen,
  rerouteFilesOpen,
  resolveAgainst,
  SIDEBAR_FILES_TAB_TYPE,
  wrapRemoteOpenWorkspacePath,
  wrapWorkspacesOpenPath,
  type InterceptServiceFace,
  type OpenInterceptDeps,
} from './openIntercept.ts'
import { registerTurnTailVscode, type TurnTailSlotsFace } from './turnTail.tsx'
import {
  closeSettingsDialog,
  wrapRemoteOpenSettingsDocument,
  wrapSettingsOpenDocument,
  type SettingsApiLike,
} from './settingsTakeover.ts'
import { fetchSettingsDocumentPath } from './openChannelApi.ts'
import { adoptPluginStyles } from './styles.ts'

/** The sessions slice the reroute's cwd resolution reads. */
interface TakeoverSessionsFace {
  list?: { getSnapshot(): {
    current?: string
    byId?: Record<string, { cwd?: string } | undefined>
  } }
}

/** The structural context face the installation touches. */
export interface TakeoverClientFace {
  slots: TurnTailSlotsFace
  sessions?: TakeoverSessionsFace
  /**
   * Nested service injection (cordis `ctx.inject`): parks a child fiber
   * until every named service exists, runs the body with a scope that may
   * read them, and honors the body's returned disposer on service withdraw
   * or plugin unload. Optional so the body can park on services the OLD
   * runtime never provides without blocking activation — the fail-soft
   * contract of every takeover seam.
   */
  inject?(deps: readonly string[], body: (scope: { get(name: string): unknown }) => (() => void) | void): unknown
  /** The client workspaces service (runtime IWorkspaces mirror — openPath only). */
  workspaces?: { openPath(path: string): Promise<void> }
  /** The connection service (the legacy settings.openDocument seam's target). */
  connection?: { api?: { settings?: SettingsApiLike } }
}

/**
 * The betterSidebar service slice the installation touches: the reroute
 * driver's face plus the prefs snapshot the settings reads need (the
 * pluginSettings blob lives in the same store).
 */
export interface TakeoverSidebarFace extends InterceptServiceFace {
  getSnapshot(): {
    sessionId?: string | undefined
    state?: unknown
    prefs: { pluginSettings: Record<string, Record<string, unknown>> }
  }
  /** Monotonic capability list ('tabMeta' / 'updateTab' gate the takeover
   * whenever the peer publishes the list — every better-sidebar in the
   * declared ≥0.12 range does). */
  readonly features?: readonly string[]
}

/**
 * Install every takeover seam behind one gate. Fail-soft at each layer: a
 * better-sidebar without the tabMeta/updateTab capabilities keeps every
 * seam off (the stock behavior stands), and each era-specific seam simply
 * never installs on a runtime that does not provide its service.
 *
 * @param client - the client context face (slots, sessions, era services).
 * @param betterSidebar - the sidebar service face (gate + reroute driver).
 * @returns the disposer unwinding every installed seam (HMR-safe).
 */
export function installTakeovers(
  client: TakeoverClientFace,
  betterSidebar: TakeoverSidebarFace,
): () => void {
  const features = betterSidebar.features
  if (features !== undefined && (!features.includes('tabMeta') || !features.includes('updateTab'))) {
    console.info('[dsh-sidebar-vscode] better-sidebar lacks tabMeta/updateTab; chat-open takeover stays off')
    return () => {}
  }

  // ── the one gate + the one per-call decision table ─────────────────────
  const takeoverEnabled = (): boolean =>
    readSettingValue(betterSidebar, OPEN_AS_DEFAULT_KEY) === true && betterSidebar.isTabEnabled(TAB_ID)
  const blockedPath = (path: string): boolean => isBlockedPath(path, readOpenBlocklist(betterSidebar))
  const sessionCwd = (sessionId: string): string | undefined =>
    client.sessions?.list?.getSnapshot().byId?.[sessionId]?.cwd
  const currentSessionId = (): string => client.sessions?.list?.getSnapshot()?.current ?? ''
  const openInVscode = (sessionId: string, path: string): void => {
    // The turn-tail inject carries its sessionId (its produced paths may
    // be workspace-relative); both openPath funnels pass '' and fall back
    // to the CURRENT session's cwd (their callers resolve absolutes
    // already — ui-chat's openFile, formerly ui-conversation's apply.ts).
    // The resolved id also STAMPS the openRequest (rerouteChatOpen), so a
    // consumer in another session's tab declines the open instead of
    // delivering a foreign file into that workspace's spool.
    const current = sessionId !== '' ? sessionId : currentSessionId()
    const cwd = sessionId !== '' ? sessionCwd(sessionId) : sessionCwd(current)
    rerouteChatOpen(betterSidebar, TAB_ID, resolveAgainst(cwd, path), current)
  }
  // A blocklist hit reroutes into better-sidebar's built-in Files tab —
  // its file viewers are the sidebar's own surface for exactly the types
  // the code editor renders poorly (images, PDFs, Office documents) —
  // instead of the stock Host opener, which on a headless container dies
  // with `spawn xdg-open ENOENT`. Declines — the Files tab type disabled
  // in the side card settings — return false so the callers fall back to
  // the stock opener, the same refusal better-sidebar's own takeover
  // makes for a disabled editor.
  const openInFilesTab = (sessionId: string, path: string): boolean => {
    if (!betterSidebar.isTabEnabled(SIDEBAR_FILES_TAB_TYPE)) return false
    const current = sessionId !== '' ? sessionId : currentSessionId()
    rerouteFilesOpen(betterSidebar, resolveAgainst(sessionCwd(current), path))
    return true
  }

  // ── option II — the produced-files row ────────────────────────────────
  const disposeStyles = adoptPluginStyles('turnTail')
  const stopTurnTail = registerTurnTailVscode(
    client.slots,
    takeoverEnabled,
    openInVscode,
    blockedPath,
    openInFilesTab,
  )

  // ── option III — the chat file-open funnels (one per runtime era) ─────
  const chatDeps: OpenInterceptDeps = {
    takeoverEnabled,
    blocked: blockedPath,
    reroute: path => { openInVscode('', path) },
    rerouteBlocked: path => openInFilesTab('', path),
  }
  if (client.inject !== undefined) {
    client.inject(['remote.session'], scope => {
      const session = scope.get('remote.session')
      if (session === null || typeof session !== 'object') return undefined
      let disposeWrap = wrapRemoteOpenWorkspacePath(session as object, chatDeps)
      // The one-shot re-assert: a peer disable/enable (or HMR) that
      // re-runs its shadow AFTER this wrap would displace ours without
      // withdrawing 'remote.session' — this fiber would never re-run on
      // its own. Re-wrapping once, a few seconds in, restores the
      // outermost slot; an undisplaced wrap just chains a harmless layer.
      const reassert = (): void => {
        disposeWrap()
        disposeWrap = wrapRemoteOpenWorkspacePath(session as object, chatDeps)
      }
      const timer = setTimeout(reassert, 4000)
      return () => {
        clearTimeout(timer)
        disposeWrap()
      }
    })
  }
  const workspaces = client.workspaces
  const stopOpenPath = workspaces === undefined
    ? undefined
    : wrapWorkspacesOpenPath(workspaces, chatDeps)

  // ── option IV — the settings open-document button ─────────────────────
  // The rerouted path is absolute (the settings provider's own document),
  // so it needs no cwd resolution — and mapPathForOpen passes it through
  // even without a mapping-rule match. Fail-soft: a page whose runtime
  // carries neither seam installs no wrapper at all, and any miss on the
  // resolve falls back to the untouched original method.
  const settingsDeps = {
    takeoverEnabled,
    resolvePath: () => fetchSettingsDocumentPath(),
    reroute: (path: string) => { rerouteChatOpen(betterSidebar, TAB_ID, path) },
    closeDialog: () => { closeSettingsDialog() },
  }
  if (client.inject !== undefined) {
    client.inject(['remote.settings'], scope => {
      const settings = scope.get('remote.settings')
      if (settings === null || typeof settings !== 'object') return undefined
      return wrapRemoteOpenSettingsDocument(settings as object, settingsDeps)
    })
  }
  const connection = client.connection
  const stopSettingsOpen = connection === undefined
    ? undefined
    : wrapSettingsOpenDocument(connection.api, settingsDeps)

  return () => {
    stopSettingsOpen?.()
    stopOpenPath?.()
    stopTurnTail()
    disposeStyles()
  }
}
