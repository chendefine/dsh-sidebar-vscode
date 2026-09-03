/**
 * Browser half of `dsh-sidebar-vscode`: registers one better-sidebar tab
 * ('dsh-sidebar-vscode:vscode') that embeds the VS Code web workbench
 * opened at the current session workspace, plus the composer-side
 * plumbing for VS Code selection references:
 *
 * - an `@`-trigger source named 'vscode-reference' whose codec serializes
 *   this plugin's occurrence chips back to their canonical mention at submit
 *   (the input machine routes serialization by source name);
 * - a reference lander shared by the clipboard bridge (tab component) and
 *   the paste fallback (composer dock): payload → chips on the addressed
 *   session's composer, plain-text mention as the degraded path;
 * - a mention paster (composer dock) that recovers copied reference items —
 *   whitespace-mangled or canonical mention text — back into chips;
 * - the chat-open takeover (openIntercept.ts / turnTail.tsx): the
 *   produced-files row and the runtime's chat file-open funnel (the
 *   gateway-era `remote.session.openWorkspacePath` Host Remote, or the
 *   legacy `workspaces.openPath` client service) are rerouted so chat file
 *   clicks open inside the VSCode tab, gated by the same `openAsDefault`
 *   switch as the default-tab swap — except paths whose extension is on
 *   the open blocklist (openBlocklist.ts: Office/image/PDF types), which
 *   open in better-sidebar's built-in Files tab instead (its file viewers
 *   render those types; the stock Host opener only when that tab type is
 *   disabled);
 * - the settings-open takeover (settingsTakeover.ts): the settings page's
 *   「打开配置文件」button resolves the configuration file through this
 *   plugin's fenced node-half route and opens it inside the VSCode tab
 *   instead of the Host OS opener, gated by the same switch.
 *
 * When better-sidebar is absent (optional peer), tab registration silently
 * skips; the reference plumbing still works for the paste fallback.
 *
 * @module dsh-sidebar-vscode/client
 */

import type { TabDescriptor } from 'dsh-better-sidebar'
import { adoptTabStyles, VscodeView } from './VscodeView.tsx'
import { VscodeIcon } from './icons.tsx'
import { attachLocale, t } from './i18n.ts'
import { TAB_ID, readSettingValue } from './settings.ts'
import { watchDefaultTab, OPEN_AS_DEFAULT_KEY, type DefaultTabServiceFace } from './defaultTab.ts'
import {
  rerouteChatOpen,
  rerouteFilesOpen,
  resolveAgainst,
  SIDEBAR_FILES_TAB_TYPE,
  wrapRemoteOpenWorkspacePath,
  wrapWorkspacesOpenPath,
} from './openIntercept.ts'
import { adoptTurnTailStyles, registerTurnTailVscode } from './turnTail.tsx'
import { isBlockedPath, readOpenBlocklist } from './openBlocklist.ts'
import { closeSettingsDialog, wrapRemoteOpenSettingsDocument, wrapSettingsOpenDocument } from './settingsTakeover.ts'
import { fetchSettingsDocumentPath } from './openChannelApi.ts'
import {
  ComposerDock,
  adoptRailStyles,
  setReferenceLander,
  readActiveComposerSelection,
  restoreActiveComposerCaret,
  type FallbackOptions,
  type MentionPaster,
  type ReferenceLander,
  type ReferenceRemover,
} from './composer.tsx'
import { CapSettingsPanel, adoptSettingsStyles } from './settingsRows.tsx'
import {
  buildRefsFromPayload,
  buildResourceRefsFromPayload,
  insertVscodeReferences,
  pasteRecoveredMentions,
  removeVscodeReferences,
  VSCODE_SOURCE,
  type ConversationServiceFace,
  type SessionsServiceFace,
} from './references.ts'
import type { ClipboardPayload } from './selection.ts'
import { isResourceList } from './selection.ts'

/** Services required before mounting: the sidebar service, the slot registry
 * (the turn-tail claim), the locale service, the session registry, the
 * conversation input service, the trigger registry (chip serialization
 * routing), the client workspaces service (the openPath seam), and the
 * connection service (the settings.openDocument seam). */
export const inject = [
  'betterSidebar', 'slots', 'locale', 'sessions', 'conversation', 'inputTriggers', 'workspaces', 'connection',
]

/** The structural context face the client body touches. The betterSidebar
 * member is the service's registry face plus the slices the default-tab
 * watcher, the settings panel, and the chat-open reroute need — structural
 * over the real `BetterSidebarService`. */
interface ClientContextFace {
  betterSidebar?: DefaultTabServiceFace & {
    registerTab(descriptor: TabDescriptor): () => void
    /** Patch an open tab's display fields (the openRequest meta vehicle). */
    updateTab(tabId: string, patch: { title?: string, path?: string, meta?: unknown }): void
    /** Monotonic capability list ('tabMeta' / 'updateTab' gate the takeover
     * whenever the peer publishes the list — every better-sidebar in the
     * declared ≥0.12 range does). */
    readonly features?: readonly string[]
  }
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(options: {
      name: string
      id: string
      order?: number
      inject?: () => { lander: ReferenceLander, pasteMentions?: MentionPaster, removeRef?: ReferenceRemover }
    }, component: unknown): () => void
  }
  locale: Parameters<typeof attachLocale>[0]
  sessions?: SessionsServiceFace & {
    /** The live session list (the cwd source for the chat-open reroute). */
    list?: { getSnapshot(): {
      current?: string
      byId?: Record<string, { cwd?: string } | undefined>
    } }
  }
  conversation?: ConversationServiceFace
  inputTriggers?: {
    registerSource(source: VscodeTriggerSource): () => void
  }
  /** The client workspaces service (runtime IWorkspaces mirror — openPath only). */
  workspaces?: {
    openPath(path: string): Promise<void>
  }
  /**
   * Nested service injection (cordis `ctx.inject`): parks a child fiber until
   * every named service exists, runs the body with a scope that may read
   * them, and honors the body's returned disposer when a service withdraws
   * or the plugin unloads. Optional so the body below can park on services
   * the OLD runtime never provides (the remote session namespace) without
   * blocking activation — the fail-soft contract of every takeover seam.
   */
  inject?(deps: readonly string[], body: (scope: { get(name: string): unknown }) => (() => void) | void): unknown
  /** The connection service (the settings.openDocument wrapper's target;
   * the api/settings members are optional — the wrapper fail-softs a page
   * whose connection service carries a different shape). */
  connection?: {
    api?: { settings?: import('./settingsTakeover.ts').SettingsApiLike }
  }
  effect(register: () => () => void, name?: string): void
}

/**
 * Structural member of the frozen `InputTriggerSource` contract: this source
 * never surfaces in the menu (its candidates are always empty); registering
 * it exists so the machine's submit serializer finds this plugin's codec by
 * source name.
 */
interface VscodeTriggerSource {
  trigger: '/' | '@'
  name: string
  showGroupTitle?: boolean
  candidates(session: unknown, req: { signal: AbortSignal }): Promise<readonly unknown[]>
  onPick(): undefined
  codec: {
    clipboardText(ref: string): string
    serialize(ref: string, signal: AbortSignal): Promise<string>
  }
}

/**
 * Whether the currently displayed conversation is the addressed session —
 * the gate for reading (and restoring) the displayed composer's caret on
 * its behalf: a composer showing another session holds another draft, so
 * its selection offsets would be meaningless for this landing.
 */
function composerDisplayedFor(
  sessions: ClientContextFace['sessions'],
  sessionId: string | undefined,
): boolean {
  if (sessionId === undefined) return false
  return sessions?.list?.getSnapshot().current === sessionId
}

/** One resolved composer point plus where it came from. */
interface ComposerPoint {
  readonly point: { readonly start: number, readonly end: number }
  /** True when the point was read off the displayed DOM surface (its caret
   * restore must therefore write that surface back; a machine-resolved
   * point leaves the editor's own post-insert selection alone). */
  readonly fromDom: boolean
}

/**
 * The addressed session's live composer caret, in the plane the machine
 * addresses edits in — the bridge path's insertion point.
 *
 * Lexical hosts answer through the input resolver's keyboard face
 * (`conversation.input.keyboard(id).caretSpan()`): the editor's own
 * selection projection, per-session correct and kept through focus loss
 * into the VS Code iframe. Hosts without the face fall back to the DOM
 * selection of the displayed composer (the modern contenteditable mapping,
 * or the old textarea), gated on the displayed session matching — only the
 * displayed conversation's surface is meaningful there.
 */
function readComposerPoint(
  client: ClientContextFace,
  sessionId: string | undefined,
): ComposerPoint | undefined {
  if (sessionId === undefined) return undefined
  const keyboard = client.conversation?.input.keyboard
  if (keyboard !== undefined) {
    try {
      return { point: keyboard(sessionId).caretSpan(), fromDom: false }
    } catch {
      // No shell for the id (never-focused session): fall through to the DOM.
    }
  }
  if (!composerDisplayedFor(client.sessions, sessionId)) return undefined
  const fromSurface = readActiveComposerSelection()
  return fromSurface === undefined ? undefined : { point: fromSurface, fromDom: true }
}

/** The tab descriptor this plugin registers. */
export function vscodeTab(): TabDescriptor {
  return {
    id: 'dsh-sidebar-vscode:vscode',
    title: () => t('title'),
    icon: (size: number) => VscodeIcon(size),
    order: 55,
    single: true,
    settings: {
      // Every settings row renders through the custom panel below — no
      // declarative `pluginToggles`: their fixed left-right split (control
      // beside the description) cramps the long free-form `serverUrl`
      // value, which the panel stacks instead (description on top,
      // full-width input on its own line below; `pathMap` renders no row
      // anywhere — settings-document only); the numeric
      // capture caps (maxLines / maxBytes) need the custom panel anyway,
      // because the declarative number row cannot pre-fill the code
      // default on an unset key (its empty draft commits '' → 0 → the
      // declared MINIMUM on a mere focus/blur) nor flag out-of-range
      // input as it is typed. The panel shows the effective value
      // (stored, else the default), enforces the declared bounds at input
      // time, and persists only real changes.
      render: (props) => (
        <CapSettingsPanel
          pluginSettings={props.pluginSettings}
          updatePluginSetting={props.updatePluginSetting}
          service={props.service}
        />
      ),
    },
    component: (props) => <VscodeView {...props} />,
  }
}

/**
 * Client plugin body.
 * @param ctx - the client cordis context (sidebar + slots + locale + sessions
 * + conversation + inputTriggers services).
 */
export function apply(ctx: unknown): void {
  const client = ctx as ClientContextFace
  client.effect(() => attachLocale(client.locale), 'dsh-sidebar-vscode: dictionaries')

  // Selection references: one lander shared by the composer dock (paste
  // fallback) and the tab's clipboard bridge. The lander builds one chip per
  // span (editor selections) or per resource (explorer files/folders) and
  // lands them on the addressed session's input machine — at the addressed
  // range: the caller's paste selection when it has one, else (the bridge
  // path, which holds no composer element) the addressed session's live
  // composer caret — the machine's own selection projection on Lexical
  // hosts, the displayed composer's DOM selection otherwise — else the
  // draft tail. The chip's ref IS the canonical mention, so submit
  // serialization needs no state. The paster lands recovered mention copies
  // (rendered-chip text pasted back) the same way — at the paste selection,
  // prose preserved. The remover strips one reference's chips without
  // flattening the others (the rail's close affordance).
  const lander: ReferenceLander = (
    sessionId: string | undefined,
    payload: ClipboardPayload,
    options: FallbackOptions,
    at?: { readonly start: number, readonly end: number },
  ) => {
    return (async () => {
      // Read the addressed composer's selection before any await: every
      // async gap is a window where a machine write could flush a new value
      // through React and collapse the surface's selection to the tail.
      // The bridge path passes no `at`: resolve the insertion point here.
      const ownPoint = at === undefined
      const resolved = at === undefined ? readComposerPoint(client, sessionId) : undefined
      const point = at !== undefined ? at : resolved?.point
      const refs = isResourceList(payload)
        ? buildResourceRefsFromPayload(payload, {
          reverseRules: options.reverseRules,
          cwd: options.cwd,
        })
        : await buildRefsFromPayload(payload, {
          reverseRules: options.reverseRules,
          cwd: options.cwd,
          maxLines: options.maxLines,
          maxBytes: options.maxBytes,
        })
      const outcome = await insertVscodeReferences(client.sessions, client.conversation, sessionId, refs, point)
      // Caret restore is the point owner's duty: a caller that passed `at`
      // restores through its own surface (the paste fallbacks); only a point
      // this wrapper resolved from the DOM is restored here — a
      // machine-resolved point leaves the editor's own post-insert
      // selection, already right after the chip, alone.
      if (ownPoint && resolved?.fromDom === true && outcome.caret !== undefined) {
        restoreActiveComposerCaret(outcome.caret)
      }
      return outcome
    })()
  }
  const pasteMentions: MentionPaster = (sessionId, parts, selection) => {
    return pasteRecoveredMentions(client.sessions, client.conversation, sessionId, parts, selection)
  }
  const removeRef: ReferenceRemover = (sessionId, ref) => {
    return removeVscodeReferences(client.sessions, client.conversation, sessionId, ref)
  }
  client.effect(() => {
    setReferenceLander(lander)
    return () => { setReferenceLander(undefined) }
  }, 'dsh-sidebar-vscode: reference lander handle')
  client.effect(() => {
    // The dock's stylesheet lives as long as the dock registration: adopted
    // once, removed on plugin dispose / HMR re-apply. The settings panel's
    // stylesheet rides the same effect (the gear popup renders the panel
    // only while the plugin is loaded).
    const disposeStyles = adoptRailStyles()
    const disposeSettingsStyles = adoptSettingsStyles()
    const stop = client.slots.inject('conversation.input.dock', () => client.slots.register({
      name: 'conversation.input.dock',
      id: 'dsh-sidebar-vscode-composer',
      order: 30,
      inject: () => ({ lander, pasteMentions, removeRef }),
    }, ComposerDock))
    return () => {
      stop()
      disposeSettingsStyles()
      disposeStyles()
    }
  }, 'dsh-sidebar-vscode: composer dock')

  // The trigger source: codec-only registration (empty candidates keep this
  // source out of every menu; the machine resolves chip serialization by
  // source name at submit).
  const source: VscodeTriggerSource = {
    trigger: '@',
    name: VSCODE_SOURCE,
    showGroupTitle: false,
    async candidates() {
      return []
    },
    onPick() {
      return undefined
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  }
  client.effect(() => {
    const stop = client.inputTriggers?.registerSource(source)
    return () => { stop?.() }
  }, 'dsh-sidebar-vscode: @ source')

  const betterSidebar = client.betterSidebar
  if (betterSidebar === undefined) return
  const descriptor = vscodeTab()
  client.effect(() => {
    // The tab's stylesheet lives as long as the tab registration: adopted
    // once, removed on plugin dispose / HMR re-apply.
    const disposeStyles = adoptTabStyles()
    const stop = betterSidebar.registerTab(descriptor)
    return () => {
      stop()
      disposeStyles()
    }
  }, 'dsh-sidebar-vscode: vscode tab')

  // The default-tab watcher: better-sidebar seeds every brand-new session
  // with a hardcoded 'Files' tab; when the openAsDefault switch is on, this
  // swaps that pristine seed for the VSCode tab (new sessions only — used
  // sessions keep their own layouts; see defaultTab.ts).
  client.effect(() => {
    const stop = watchDefaultTab(betterSidebar)
    return () => { stop() }
  }, 'dsh-sidebar-vscode: default tab watcher')

  // The chat-open takeover (options II + III from the research) plus the
  // settings-open takeover (option IV), gated by the SAME openAsDefault
  // switch as the default-tab swap: switch off → every seam declines and the
  // chat/settings keep their stock behavior; switch on → chat file opens and
  // the settings「打开配置文件」click land in the VSCode tab and its meta
  // carries the path (VscodeView opens it there). All also require the tab
  // type enabled and the peer's tabMeta/updateTab capabilities
  // (better-sidebar ≥ 0.12).
  client.effect(() => {
    const features = betterSidebar.features
    if (features !== undefined && (!features.includes('tabMeta') || !features.includes('updateTab'))) {
      console.info('[dsh-sidebar-vscode] better-sidebar lacks tabMeta/updateTab; chat-open takeover stays off')
      return () => {}
    }
    const takeoverEnabled = (): boolean => readSettingValue(betterSidebar, OPEN_AS_DEFAULT_KEY) === true
      && betterSidebar.isTabEnabled(TAB_ID)
    // The open blocklist (openBlocklist.ts), read per call like the gate:
    // a file type the code editor renders poorly (Office/image/PDF …)
    // declines THIS path's VSCode takeover — the open reroutes into the
    // built-in Files tab instead (openInFilesTab below), the stock Host
    // opener only when that tab type is disabled. Settings edits therefore
    // apply to the very next click.
    const blockedPath = (path: string): boolean => isBlockedPath(path, readOpenBlocklist(betterSidebar))
    const currentCwd = (): string | undefined => {
      const snapshot = client.sessions?.list?.getSnapshot()
      const id = snapshot?.current
      return id !== undefined ? snapshot?.byId?.[id]?.cwd : undefined
    }
    const openInVscode = (sessionId: string, path: string): void => {
      // The turn-tail inject carries its sessionId (its produced paths may
      // be workspace-relative); both openPath wrappers pass '' and fall back
      // to the CURRENT session's cwd (their callers resolve absolutes
      // already — ui-chat's openFile, formerly ui-conversation's apply.ts).
      const cwd = sessionId !== ''
        ? client.sessions?.list?.getSnapshot()?.byId?.[sessionId]?.cwd
        : currentCwd()
      rerouteChatOpen(betterSidebar, TAB_ID, resolveAgainst(cwd, path))
    }
    // A blocklist hit reroutes into better-sidebar's built-in Files tab —
    // its file viewers are the sidebar's own surface for exactly the types
    // the code editor renders poorly (images, PDFs, Office documents) —
    // instead of the stock Host opener, which on a headless container dies
    // with `spawn xdg-open ENOENT` (the very hole the openPath wrappers
    // repair for every other path). Declines — the Files tab type disabled
    // in the side card settings — return false so the callers fall back to
    // the stock opener, the same refusal better-sidebar's own takeover
    // makes for a disabled editor.
    const openInFilesTab = (sessionId: string, path: string): boolean => {
      if (!betterSidebar.isTabEnabled(SIDEBAR_FILES_TAB_TYPE)) return false
      const cwd = sessionId !== ''
        ? client.sessions?.list?.getSnapshot()?.byId?.[sessionId]?.cwd
        : currentCwd()
      rerouteFilesOpen(betterSidebar, resolveAgainst(cwd, path))
      return true
    }

    // Option II — the produced-files row (the "changed files" chips):
    // claimed at priority -2, before better-sidebar's own -1 entry, so the
    // chips open the files in the VSCode tab. A decline (switch off / tab
    // disabled / nothing produced) falls through to its row unchanged.
    // Per-chip routing honors the blocklist: a blocked chip reroutes into
    // the built-in Files tab (openInFilesTab), degrading to the render
    // site's own stock openFile (carried on the matched value) — and then
    // to the VSCode open — when that reroute declines (never a dead chip).
    const disposeStyles = adoptTurnTailStyles()
    const stopTurnTail = registerTurnTailVscode(
      client.slots,
      takeoverEnabled,
      openInVscode,
      blockedPath,
      openInFilesTab,
    )

    // Option III — the runtime's single remaining chat file-open funnel
    // (tool-row path links, prose file mentions), which ALSO repairs the
    // headless hole: better-sidebar declines its own takeover when its
    // built-in Files tab is disabled, letting opens die on the Host OS
    // opener (`spawn xdg-open ENOENT`); this wrapper keeps them landing
    // here regardless of that setting. Two era-specific seams, exactly one
    // of which ever installs:
    //
    // - the gateway-era runtime routes the opens through the
    //   `remote.session.openWorkspacePath` Host Remote (ui-chat's injected
    //   `openFile` is its only production caller) — the workspace controller
    //   now owning the 'workspaces' service key carries no opener, so the
    //   legacy wrapper below installs nothing there. The namespace service
    //   is reached through a NESTED inject: the child fiber parks until
    //   'remote.session' exists (on the old runtime that is never — there
    //   the legacy wrapper keeps the takeover), runs the wrap, and honors
    //   the returned restore disposer on service withdraw, on plugin
    //   unload, and on HMR re-apply (no manual dispose needed: cordis
    //   parents the fiber to this plugin's own context).
    // - the pre-gateway runtime through `workspaces.openPath` (legacy).
    if (client.inject !== undefined) {
      client.inject(['remote.session'], scope => {
        const session = scope.get('remote.session')
        if (session === null || typeof session !== 'object') return undefined
        return wrapRemoteOpenWorkspacePath(session, {
          takeoverEnabled,
          blocked: blockedPath,
          reroute: path => { openInVscode('', path) },
          rerouteBlocked: path => openInFilesTab('', path),
        })
      })
    }

    const workspaces = client.workspaces
    const stopOpenPath = workspaces === undefined
      ? undefined
      : wrapWorkspacesOpenPath(workspaces, {
        takeoverEnabled,
        blocked: blockedPath,
        reroute: path => { openInVscode('', path) },
        rerouteBlocked: path => openInFilesTab('', path),
      })

    // Option IV — the settings page's「打开配置文件」button: the stock click
    // drives the Host OS opener (dead on headless containers); this wrapper
    // resolves the document through this plugin's own fenced node-half route
    // and opens it in the VSCode tab instead. The rerouted path is absolute
    // (the settings provider's own document), so it needs no cwd resolution
    // — and mapPathForOpen passes it through even without a mapping-rule
    // match. Fail-soft: a page whose runtime carries neither seam (an
    // older/newer/third-party web shell) installs no wrapper at all, and any
    // miss on the resolve falls back to the untouched original method. A
    // successful reroute also closes the settings dialog (the file is now in
    // view; the modal would only cover the workbench). Two era-specific
    // seams, exactly one of which ever intercepts:
    //
    // - the gateway-era runtime routes the button through the
    //   `remote.settings.openSettingsDocument` Host Remote
    //   (SettingsDocumentStore.open is its only production caller) — the
    //   legacy connection.api member below installs nothing there. Same
    //   nested-inject parking as the remote.session seam above.
    // - the pre-gateway runtime through `connection.api.settings
    //   .openDocument` (legacy).
    if (client.inject !== undefined) {
      client.inject(['remote.settings'], scope => {
        const settings = scope.get('remote.settings')
        if (settings === null || typeof settings !== 'object') return undefined
        return wrapRemoteOpenSettingsDocument(settings, {
          takeoverEnabled,
          resolvePath: () => fetchSettingsDocumentPath(),
          reroute: path => { rerouteChatOpen(betterSidebar, TAB_ID, path) },
          closeDialog: () => { closeSettingsDialog() },
        })
      })
    }

    const connection = client.connection
    const stopSettingsOpen = connection === undefined
      ? undefined
      : wrapSettingsOpenDocument(connection.api, {
        takeoverEnabled,
        resolvePath: () => fetchSettingsDocumentPath(),
        reroute: path => { rerouteChatOpen(betterSidebar, TAB_ID, path) },
        closeDialog: () => { closeSettingsDialog() },
      })

    return () => {
      stopSettingsOpen?.()
      stopOpenPath?.()
      stopTurnTail()
      disposeStyles()
    }
  }, 'dsh-sidebar-vscode: chat + settings open takeover')
}
