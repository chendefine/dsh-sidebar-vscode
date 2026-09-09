/**
 * The takeover family's installation for the OFFICIAL right Sidebar: the
 * seams that reroute a host-side file open into the embedded VS Code
 * workbench, wired through ONE gate and live settings reads.
 *
 * - **The chat-open seam** (`openIntercept.ts`): `ctx.sidebarRight
 *   .openResource` — the official navigation controller's public resource
 *   funnel and the one route every chat-originated open of the current
 *   runtime takes (ui-chat's `openFile`: tool-row path links and prose
 *   mentions; the deliverables row's produced-files chips). The wrapper
 *   claims the open for the workbench (`openTab('vscode', { params })`)
 *   or falls through untouched — switch off, blocklisted path, or an
 *   unresolvable session scope — to the stock registry routing, where
 *   the official text preview (or a future viewer plugin) claims it.
 * - **The settings open-document seam** (`settingsTakeover.ts`): the
 *   settings page's「打开配置文件」click resolves the document through
 *   this plugin's own fenced node-half route and opens it in the
 *   workbench tab, closing the settings dialog behind it. Two era-specific
 *   seams (`remote.settings.openSettingsDocument` vs the legacy
 *   `connection.api.settings.openDocument`); exactly one ever intercepts.
 *
 * Cross-cutting wiring that lives HERE so no seam carries its own copy:
 *
 * - the gate: `takeoverEnabled` = the `openAsDefault` switch resolved from
 *   the live settings scope (evaluated per call, so flipping the switch
 *   applies to the very next click);
 * - the open blocklist (`openBlocklist.ts`), read per call from the same
 *   scope: a file type the code editor renders poorly (Office/image/PDF …)
 *   declines the VSCode reroute and falls through to the official
 *   sidebar's own viewer surface;
 * - session addressing: the session-scope address translation resolves
 *   the workspace root from the sessions registry's live snapshot.
 *
 * @module dsh-sidebar-vscode/client/takeovers
 */

import { VSCODE_KIND } from './definition.ts'
import { readSettings, takeoverSwitchOn, type SettingsScopeFace } from './settings.ts'
import { isBlockedPath, readOpenBlocklist } from './openBlocklist.ts'
import { wrapSidebarRightOpenResource, type SidebarRightLike } from './openIntercept.ts'
import {
  closeSettingsDialog,
  wrapRemoteOpenSettingsDocument,
  wrapSettingsOpenDocument,
  type SettingsApiLike,
} from './settingsTakeover.ts'
import { fetchSettingsDocumentPath } from './openChannelApi.ts'

/** The sessions slice the session-scope translation reads. */
interface TakeoverSessionsFace {
  list?: { getSnapshot(): {
    byId?: Record<string, { cwd?: string } | undefined>
  } }
}

/** The structural context face the installation touches. */
export interface TakeoverClientFace {
  /** The official right-Sidebar navigation controller (`ctx.sidebarRight`). */
  sidebarRight?: SidebarRightLike
  sessions?: TakeoverSessionsFace
  /**
   * Nested service injection (cordis `ctx.inject`): parks a child fiber
   * until every named service exists, runs the body with a scope that may
   * read them, and honors the body's returned disposer on service withdraw
   * or plugin unload. Optional so the body can park on services the OLD
   * runtime never provides without blocking activation — the fail-soft
   * contract of the settings seam.
   */
  inject?(deps: readonly string[], body: (scope: { get(name: string): unknown }) => (() => void) | void): unknown
  /** The connection service (the legacy settings.openDocument seam's target). */
  connection?: { api?: { settings?: SettingsApiLike } }
}

/**
 * Install every takeover seam behind one gate. Fail-soft at each layer:
 * the openResource wrapper declines per call (switch off / blocklist /
 * unresolvable address) and installs nothing on a foreign service shape;
 * each era-specific settings seam simply never installs on a runtime that
 * does not provide its service.
 *
 * @param client - the client context face (sidebarRight, sessions, era services).
 * @param scope - the bound `vscode-sidebar` settings scope (live reads;
 * undefined = no settings service, every read falls back to the code
 * defaults — the switch reads off, so every seam declines).
 * @returns the disposer unwinding every installed seam (HMR-safe).
 */
export function installTakeovers(
  client: TakeoverClientFace,
  scope: SettingsScopeFace | undefined,
): () => void {
  // ── the one gate + the one per-call decision table ─────────────────────
  const takeoverEnabled = (): boolean => takeoverSwitchOn(scope)
  const blockedPath = (path: string): boolean => isBlockedPath(path, readOpenBlocklist(scope))
  const cwdOf = (sessionId: string): string | undefined =>
    client.sessions?.list?.getSnapshot().byId?.[sessionId]?.cwd

  // ── the chat-open seam (the official openResource funnel) ──────────────
  // Fail-soft at the seam: no controller, no wrapper (the plugin body has
  // usually already returned in that case; this keeps the installer
  // unit-testable on partial fakes).
  const sidebarRight = client.sidebarRight
  const stopOpenResource = sidebarRight === undefined
    ? undefined
    : wrapSidebarRightOpenResource(sidebarRight, {
      takeoverEnabled,
      blocked: blockedPath,
      cwdOf,
      kind: VSCODE_KIND,
    })

  // ── the settings open-document seam (one per runtime era) ──────────────
  // The rerouted path is absolute (the settings provider's own document),
  // so it needs no cwd resolution — and mapPathForOpen passes it through
  // even without a mapping-rule match. Fail-soft: a page whose runtime
  // carries neither seam installs no wrapper at all, and any miss on the
  // resolve falls back to the untouched original method.
  const settingsDeps = {
    takeoverEnabled,
    resolvePath: () => fetchSettingsDocumentPath(),
    reroute: (path: string) => {
      sidebarRight?.openTab(VSCODE_KIND, { params: { path } })
    },
    closeDialog: () => { closeSettingsDialog() },
  }
  if (client.inject !== undefined) {
    client.inject(['remote.settings'], scopeCtx => {
      const settings = scopeCtx.get('remote.settings')
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
    stopOpenResource?.()
  }
}
