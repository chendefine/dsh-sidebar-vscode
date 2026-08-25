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
 *   whitespace-mangled or canonical mention text — back into chips.
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
import { watchDefaultTab, type DefaultTabServiceFace } from './defaultTab.ts'
import {
  ComposerDock,
  adoptRailStyles,
  setReferenceLander,
  type FallbackOptions,
  type MentionPaster,
  type ReferenceLander,
} from './composer.tsx'
import { CapSettingsPanel, adoptSettingsStyles } from './settingsRows.tsx'
import {
  buildRefsFromPayload,
  buildResourceRefsFromPayload,
  insertVscodeReferences,
  pasteRecoveredMentions,
  VSCODE_SOURCE,
  type ConversationServiceFace,
  type SessionsServiceFace,
} from './references.ts'
import type { ClipboardPayload } from './selection.ts'
import { isResourceList } from './selection.ts'

/** Services required before mounting: the sidebar service, the slot registry,
 * the locale service, the session registry, the conversation input service,
 * and the trigger registry (chip serialization routing). */
export const inject = [
  'betterSidebar', 'slots', 'locale', 'sessions', 'conversation', 'inputTriggers',
]

/** The structural context face the client body touches. The betterSidebar
 * member is the service's registry face plus the default-tab slice (open /
 * close / enablement / snapshot subscription) the watcher and the settings
 * panel need — structural over the real `BetterSidebarService`. */
interface ClientContextFace {
  betterSidebar?: DefaultTabServiceFace & {
    registerTab(descriptor: TabDescriptor): () => void
  }
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(options: {
      name: string
      id: string
      order?: number
      inject?: () => { lander: ReferenceLander }
    }, component: unknown): () => void
  }
  locale: Parameters<typeof attachLocale>[0]
  sessions?: SessionsServiceFace
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
      // beside the description) cramps the two long free-form text values
      // (serverUrl / pathMap), which the panel stacks instead (description
      // on top, full-width input on its own line below); the numeric
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
  // lands them on the addressed session's input machine; the chip's ref IS
  // the canonical mention, so submit serialization needs no state. The paster
  // lands recovered mention copies (rendered-chip text pasted back) the same
  // way — at the paste selection, prose preserved.
  const lander: ReferenceLander = (
    sessionId: string | undefined,
    payload: ClipboardPayload,
    options: FallbackOptions,
  ) => {
    return (async () => {
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
      return insertVscodeReferences(client.sessions, client.conversation, sessionId, refs)
    })()
  }
  const pasteMentions: MentionPaster = (sessionId, parts, selection) => {
    return pasteRecoveredMentions(client.sessions, client.conversation, sessionId, parts, selection)
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
      inject: () => ({ lander, pasteMentions }),
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
}
