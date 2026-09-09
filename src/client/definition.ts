/**
 * Stage one of this plugin's registration with the official right
 * Sidebar: what the `vscode` tab type IS.
 *
 * The type is a PAGE, not a viewer: it claims no resource address, because
 * the workbench is ONE surface per session (a second iframe racing the
 * first re-opens VS Code's IndexedDB and deadlocks — see bootLock.ts),
 * while the registry's identity rule would mint one tab per address. The
 * guide page offers it as an entry box (点选即在引导标签的位置打开),
 * chat-originated file opens reach it through the `openResource` takeover
 * (`openIntercept.ts`) as `openTab('vscode', { params })`, and the params
 * arrive at the body as `tab.navigation.params` with a monotonic
 * `revision` (the one-shot open command's vehicle).
 *
 * Structural over the official `SidebarRightTabDefinition` — the client
 * bundle keeps its zero-official-value-imports discipline; the shapes
 * match the registry's contract exactly.
 *
 * @module dsh-sidebar-vscode/client/definition
 */

import { t } from './i18n.ts'
import { VscodeGuideIcon } from './icons.tsx'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const VSCODE_ID = 'dsh-sidebar-vscode'

/** The tab kind this plugin owns (`openTab('vscode')` names it). */
export const VSCODE_KIND = 'vscode'

/**
 * The page type's navigation parameters (the `SidebarRightTabParamsMap`
 * entry this kind accepts, structural): where an open should land inside
 * the workbench. `path` is the DSH-side absolute path; `line`/`column`
 * are optional 1-based positions.
 */
export interface VscodeTabParams {
  readonly path?: string
  readonly line?: number
  readonly column?: number
}

/** One guide entry box (structural over the official `SidebarRightGuideEntry`). */
export interface VscodeGuideEntry {
  readonly order: number
  readonly title: () => string
  readonly description: () => string
  readonly icon?: unknown
}

/** The registry definition face this plugin registers (structural). */
export interface VscodeTabDefinition {
  readonly id: string
  readonly kind: string
  /** `extension` is the default band; spelled out for the record. */
  readonly priority: 'extension'
  readonly title: (address: string) => string
  readonly guide?: readonly VscodeGuideEntry[]
}

/**
 * The `vscode` type's registry definition.
 * @returns the definition to register into `ctx.sidebarRightTabs`.
 */
export function vscodeTabDefinition(): VscodeTabDefinition {
  return {
    id: VSCODE_ID,
    kind: VSCODE_KIND,
    priority: 'extension',
    // The chip text, captured into the layout record at open time. The
    // address of a page tab is the sidebar's own `sidebar://vscode`; the
    // label is the product name either way.
    title: () => t('title'),
    guide: [{
      // After the official files entry (order 10): the code editor
      // follows the workspace it edits.
      order: 20,
      title: () => t('guideTitle'),
      description: () => t('guideDescription'),
      icon: VscodeGuideIcon,
    }],
  }
}
