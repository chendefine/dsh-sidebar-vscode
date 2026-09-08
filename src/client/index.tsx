/**
 * Browser half of `dsh-sidebar-vscode`: a thin composition root. The
 * plugin's client-side mechanisms live in their own modules — the tab
 * view (VscodeView.tsx and its controllers), the reference pipeline
 * (references.ts / composer.tsx / referencePipeline.ts), the takeover
 * family (takeovers.ts), the settings panel (settingsRows.tsx) — and this
 * entry only wires them to the services:
 *
 * - the better-sidebar tab ('dsh-sidebar-vscode:vscode') embedding the
 *   VS Code web workbench at the current session workspace;
 * - an `@`-trigger source named 'vscode-reference' whose codec serializes
 *   this plugin's occurrence chips back to their canonical mention at
 *   submit (the input machine routes serialization by source name);
 * - a reference lander shared by the clipboard bridge (tab component) and
 *   the paste fallback (composer dock): payload → chips on the addressed
 *   session's composer, plain-text mention as the degraded path;
 * - the takeover family (takeovers.ts): chat file opens and the settings
 *   page's「打开配置文件」button rerouted into the VSCode tab, all behind
 *   the openAsDefault switch and the open blocklist;
 * - the default-tab watcher (defaultTab.ts): brand-new sessions open the
 *   VSCode tab instead of better-sidebar's seeded Files tab.
 *
 * When better-sidebar is absent (optional peer), tab registration and the
 * takeovers silently skip; the reference plumbing still works for the
 * paste fallback.
 *
 * @module dsh-sidebar-vscode/client
 */

import type { TabDescriptor } from 'dsh-better-sidebar'
import { VscodeView } from './VscodeView.tsx'
import { VscodeIcon } from './icons.tsx'
import { attachLocale, t } from './i18n.ts'
import { watchDefaultTab, type DefaultTabServiceFace } from './defaultTab.ts'
import { installTakeovers } from './takeovers.ts'
import { ComposerDock } from './composer.tsx'
import { CapSettingsPanel } from './settingsRows.tsx'
import {
  setReferenceLander,
  type FallbackOptions,
  type MentionPaster,
  type ReferenceLander,
  type ReferenceRemover,
} from './referencePipeline.ts'
import { adoptPluginStyles } from './styles.ts'
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
 * watcher and the settings panel need — structural over the real
 * `BetterSidebarService`. */
interface ClientContextFace {
  betterSidebar?: DefaultTabServiceFace & {
    registerTab(descriptor: TabDescriptor): () => void
    /** Patch an open tab's display fields (the openRequest meta vehicle). */
    updateTab(tabId: string, patch: { title?: string, path?: string, meta?: unknown }): void
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
  // The dock's and the settings panel's stylesheets live as long as the
  // dock registration: adopted once, removed on plugin dispose / HMR
  // re-apply (the gear popup renders the panel only while the plugin is
  // loaded).
  client.effect(() => {
    const disposeStyles = adoptPluginStyles('rail', 'settings')
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

  // ── The sidebar surfaces (need the optional better-sidebar peer) ───────
  const betterSidebar = client.betterSidebar
  if (betterSidebar === undefined) return
  const descriptor = vscodeTab()
  client.effect(() => {
    // The tab's stylesheet lives as long as the tab registration: adopted
    // once, removed on plugin dispose / HMR re-apply.
    const disposeStyles = adoptPluginStyles('tab')
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

  // The takeover family (chat file opens + the settings open-document
  // button), gated by the same openAsDefault switch as the default-tab
  // swap: switch off → every seam declines and the chat/settings keep
  // their stock behavior; switch on → the opens land in the VSCode tab
  // and its meta carries the path (VscodeView opens it there).
  client.effect(() => {
    return installTakeovers(client, betterSidebar)
  }, 'dsh-sidebar-vscode: chat + settings open takeover')
}
