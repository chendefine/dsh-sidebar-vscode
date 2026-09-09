/**
 * Browser half of `dsh-sidebar-vscode`: a thin composition root over the
 * OFFICIAL right-Sidebar system. The plugin's client-side mechanisms live
 * in their own modules — the tab body (VscodeView.tsx and its
 * controllers), the reference pipeline (references.ts / composer.tsx /
 * referencePipeline.ts), the takeover family (takeovers.ts), the settings
 * card (settingsCard.tsx) — and this entry only wires them to the
 * services:
 *
 * - the `vscode` tab type, registered in the official two stages: the
 *   static definition into `ctx.sidebarRightTabs` (guide-page entry box
 *   included) and the body into the keyed `sidebar.right.pane.tab` seat
 *   under the definition's id — the embedded VS Code web workbench at the
 *   session's workspace;
 * - an `@`-trigger source named 'vscode-reference' whose codec serializes
 *   this plugin's occurrence chips back to their canonical mention at
 *   submit (the input machine routes serialization by source name);
 * - a reference lander shared by the clipboard bridge (tab component) and
 *   the paste fallback (composer dock): payload → chips on the addressed
 *   session's composer, plain-text mention as the degraded path;
 * - the takeover family (takeovers.ts): the official
 *   `ctx.sidebarRight.openResource` funnel and the settings page's
 *   「打开配置文件」button rerouted into the workbench tab, all behind
 *   the openAsDefault switch and the open blocklist;
 * - the configuration card (settingsCard.tsx) inside the official
 *   设置 → 插件 → 插件配置 tab, keyed by the `vscode-sidebar` namespace
 *   the Host half serves.
 *
 * @module dsh-sidebar-vscode/client
 */

import { VscodeView } from './VscodeView.tsx'
import { attachLocale } from './i18n.ts'
import { vscodeTabDefinition, VSCODE_ID } from './definition.ts'
import { installTakeovers } from './takeovers.ts'
import { ComposerDock } from './composer.tsx'
import { VscodeSettingsCard } from './settingsCard.tsx'
import type { SettingsScopeFace } from './settings.ts'
import type { SidebarRightLike } from './openIntercept.ts'
import type { SettingsApiLike } from './settingsTakeover.ts'
import {
  setReferenceLander,
  type FallbackOptions,
  type MentionPaster,
  type ReferenceLander,
  type ReferenceRemover,
} from './referencePipeline.ts'
import { adoptPluginStyles } from './styles.ts'
import { NS } from './locales.ts'
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
import { isResourceList, type ClipboardPayload } from './selection.ts'
import { readActiveComposerSelection, restoreActiveComposerCaret } from './composer.tsx'
import { VSCODE_SIDEBAR_SETTINGS_NAMESPACE } from '../shared/settings.ts'

/** Services required before mounting: the official right-Sidebar's tab
 * registry and navigation controller, the slot registry (the tab body,
 * the composer dock, and the settings card seats), the locale service,
 * the session registry, the conversation input service, the trigger
 * registry (chip serialization routing), the settings scope (the
 * `vscode-sidebar` namespace), and the connection service (the legacy
 * settings.openDocument seam). */
export const inject = [
  'sidebarRightTabs', 'sidebarRight', 'slots', 'locale', 'sessions', 'conversation', 'inputTriggers', 'settingsScope', 'connection',
]

/** The structural context face the client body touches. */
interface ClientContextFace {
  /** The official tab-type registry (`ctx.sidebarRightTabs`). */
  sidebarRightTabs?: {
    register(definition: unknown): () => void
  }
  /** The official navigation controller (`ctx.sidebarRight`). */
  sidebarRight?: SidebarRightLike
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(options: {
      name: string
      id?: string
      key?: string
      order?: number
      locale?: string
      inject?: () => Record<string, unknown>
    }, component: unknown): () => void
  }
  locale: Parameters<typeof attachLocale>[0]
  sessions?: SessionsServiceFace & {
    /** The live session list (the cwd source for the session-scope translation). */
    list?: { getSnapshot(): {
      current?: string
      byId?: Record<string, { cwd?: string } | undefined>
    } }
  }
  conversation?: ConversationServiceFace
  inputTriggers?: {
    registerSource(source: VscodeTriggerSource): () => void
  }
  /** The official settings-scope binder (`ctx.settingsScope`). */
  settingsScope?: {
    bind(spec: { namespace: string }): SettingsScopeFace
  }
  /** The connection service (the legacy settings.openDocument seam's target). */
  connection?: { api?: { settings?: SettingsApiLike } }
  /**
   * Nested service injection (cordis `ctx.inject`): parks a child fiber
   * until every named service exists (the settings takeover's era seam).
   */
  inject?(deps: readonly string[], body: (scope: { get(name: string): unknown }) => (() => void) | void): unknown
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

/**
 * Client plugin body.
 * @param ctx - the client cordis context (the official sidebar services +
 * slots + locale + sessions + conversation + inputTriggers + settingsScope
 * + connection).
 */
export function apply(ctx: unknown): void {
  const client = ctx as ClientContextFace
  client.effect(() => attachLocale(client.locale), 'dsh-sidebar-vscode: dictionaries')

  // ── The `vscode-sidebar` settings scope ────────────────────────────────
  // One binding for the whole plugin: the takeover gates read it per call,
  // the tab body and the settings card read it per render / per write.
  // An absent settings service (a runtime without one) leaves the scope
  // undefined and every consumer reads the code defaults.
  const scope = client.settingsScope?.bind({ namespace: VSCODE_SIDEBAR_SETTINGS_NAMESPACE })

  // ── The reference pipeline: lander + paster + remover ──────────────────
  // One lander shared by the composer dock (paste fallback) and the tab's
  // clipboard bridge. The lander builds one chip per span (editor
  // selections) or per resource (explorer files/folders) and lands them on
  // the addressed session's input machine — at the addressed range: the
  // caller's paste selection when it has one, else (the bridge path, which
  // holds no composer element) the addressed session's live composer
  // caret — the machine's own selection projection on Lexical hosts, the
  // displayed composer's DOM selection otherwise — else the draft tail.
  // The chip's ref IS the canonical mention, so submit serialization needs
  // no state. The paster lands recovered mention copies (rendered-chip
  // text pasted back) the same way — at the paste selection, prose
  // preserved. The remover strips one reference's chips without
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

  // ── The composer dock (the reference rail + paste fallbacks) ───────────
  // The dock's stylesheet lives as long as the dock registration: adopted
  // once, removed on plugin dispose / HMR re-apply.
  client.effect(() => {
    const disposeStyles = adoptPluginStyles('rail')
    const stop = client.slots.inject('conversation.input.dock', () => client.slots.register({
      name: 'conversation.input.dock',
      id: 'dsh-sidebar-vscode-composer',
      order: 30,
      inject: () => ({ lander, pasteMentions, removeRef }),
    }, ComposerDock))
    return () => {
      stop()
      disposeStyles()
    }
  }, 'dsh-sidebar-vscode: composer dock')

  // ── The trigger source (codec-only registration) ───────────────────────
  // Empty candidates keep this source out of every menu; the machine
  // resolves chip serialization by source name at submit.
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

  // ── The official right-Sidebar surfaces ─────────────────────────────────
  // Fail-soft for a runtime without the official sidebar (an older host
  // build): the tab never registers, the takeovers stay off, and the
  // reference plumbing above keeps working for the paste fallback.
  const tabs = client.sidebarRightTabs
  const sidebarRight = client.sidebarRight
  if (tabs === undefined || sidebarRight === undefined) return

  // Stage one — the type declaration (the guide-page entry box included).
  // The tab's stylesheet lives as long as the registration: adopted once,
  // removed on plugin dispose / HMR re-apply.
  client.effect(() => {
    const disposeStyles = adoptPluginStyles('tab')
    const stop = tabs.register(vscodeTabDefinition())
    return () => {
      stop()
      disposeStyles()
    }
  }, 'dsh-sidebar-vscode: vscode tab type')

  // Stage two — the body, keyed by the definition's id. The settings
  // scope rides the registration's inject; the framework binds
  // `useTabInfo()` and the session-scoped standard props.
  client.effect(() => {
    const stop = client.slots.inject('sidebar.right.pane.tab', () => client.slots.register({
      name: 'sidebar.right.pane.tab',
      key: VSCODE_ID,
      locale: NS,
      inject: () => ({ settings: scope }),
    }, VscodeView))
    return () => { stop() }
  }, 'dsh-sidebar-vscode: vscode tab body')

  // The takeover family (the official openResource funnel + the settings
  // open-document button), gated by the same openAsDefault switch: switch
  // off → every seam declines and the chat/settings keep their stock
  // behavior; switch on → the opens land in the workbench tab and its
  // navigation params carry the path.
  client.effect(() => {
    return installTakeovers(client, scope)
  }, 'dsh-sidebar-vscode: chat + settings open takeover')

  // ── The configuration card (设置 → 插件 → 插件配置) ──────────────────────
  // Keyed by the settings namespace the Host half serves; the official
  // configurable-plugins tab dispatches this card under that key. The
  // card's stylesheet lives as long as the registration.
  client.effect(() => {
    const disposeStyles = adoptPluginStyles('settings')
    const stop = client.slots.inject('settings.plugin.item', () => client.slots.register({
      name: 'settings.plugin.item',
      key: VSCODE_SIDEBAR_SETTINGS_NAMESPACE,
      locale: NS,
      inject: () => ({ scope }),
    }, VscodeSettingsCard))
    return () => {
      stop()
      disposeStyles()
    }
  }, 'dsh-sidebar-vscode: settings card')
}
