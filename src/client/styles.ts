/**
 * The plugin's stylesheet registry: every CSS block this plugin injects
 * lives here exactly once, and one idempotent adopter installs any subset —
 * replacing the per-module copies of the find-or-create + dispose
 * boilerplate the feature accretion left behind (tab chrome, composer
 * rail, settings card).
 *
 * All rules ride the host's `--dsw-alias-*` design tokens (maintained by
 * the theme presenter — they flip with the appearance preference), so the
 * sheets need no theme awareness of their own. Class prefixes stay
 * per-surface (`dsh_vscodeTab_`, `dsh_vscodeRef_`, `dsh_vscodeSet_`).
 *
 * @module dsh-sidebar-vscode/client/styles
 */

/** The injectable sheets this plugin owns. */
export type PluginStyleId = 'tab' | 'host' | 'rail' | 'settings'

/** One sheet: its idempotency id and its rules. */
interface StyleSheetSpec {
  readonly id: string
  readonly css: string
}

/** The registry. Keep each block byte-identical when moving a sheet in. */
const STYLE_SHEETS: Record<PluginStyleId, StyleSheetSpec> = {
  tab: {
    id: 'dsh-sidebar-vscode-tab-css',
    css: `
.dsh_vscodeTab_root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_vscodeTab_strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 5px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-secondary);
}
.dsh_vscodeTab_title {
  flex: none;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  white-space: nowrap;
}
.dsh_vscodeTab_path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeTab_spacer {
  flex: 1;
}
.dsh_vscodeTab_reload {
  flex: none;
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.dsh_vscodeTab_reload:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeTab_open {
  flex: none;
  padding: 3px 2px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.12s;
}
.dsh_vscodeTab_open:hover {
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeTab_notice {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 4px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-state-warn-label);
  background: var(--dsw-alias-state-warn-tertiary);
}
.dsh_vscodeTab_noticeText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh_vscodeTab_surface {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
}
.dsh_vscodeTab_frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.dsh_vscodeTab_loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  font: var(--dsw-font-xs-13);
  color: var(--dsw-alias-label-tertiary);
  pointer-events: none;
}
.dsh_vscodeTab_loadingHint {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.8;
  max-width: 420px;
}
`,
  },
  host: {
    id: 'dsh-sidebar-vscode-host-css',
    css: `
/* The persistent workbench host (see workbenchRuntime.ts): the ONE
 * document.body child the embedded VS Code iframe lives in so that its
 * element never leaves the DOM across right-Sidebar tab switches (any
 * removal destroys an iframe's browsing context — a reload). The
 * projector (projection.ts) drives left/top/width/height/z-index per
 * frame while the tab is visible; the level it writes sits between the
 * host UI's own — the fullscreen panel draws at 40, the float host at
 * 60, portalled menus at 70 — so the projected frame covers what its
 * placeholder covers and nothing else. The container itself never takes
 * pointers; the iframe inside re-enables them, so nothing outside the
 * projected rect is blocked. Visibility (not display) hides it: a
 * display:none host would collapse the iframe to a 0x0 viewport and
 * force a VS Code re-layout on every hide/show cycle. */
.dsh_vscodeHost {
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  display: block;
  overflow: hidden;
  pointer-events: none;
  visibility: hidden;
  z-index: 45;
}
.dsh_vscodeHost iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: auto;
}
`,
  },
  rail: {
    id: 'dsh-sidebar-vscode-composer-css',
    css: `
.dsh_vscodeRef_rail {
  box-sizing: border-box;
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 6px;
  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance));
  max-width: var(--dsh-composer-card-max-width);
  min-width: 0;
  margin: 0 auto;
}
.dsh_vscodeRef_row {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  height: 28px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_vscodeRef_row[data-invalid='true'] {
  opacity: 0.55;
}
.dsh_vscodeRef_row[data-invalid='true'] .dsh_vscodeRef_path {
  text-decoration: line-through;
}
.dsh_vscodeRef_path {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 360px;
  height: 100%;
  padding: 0 6px 0 10px;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh_vscodeRef_icon {
  flex: none;
  width: 14px;
  height: 14px;
}
.dsh_vscodeRef_text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh_vscodeRef_remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  margin-right: 4px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--dsw-alias-label-dimmed);
  cursor: pointer;
}
.dsh_vscodeRef_remove svg {
  width: 12px;
  height: 12px;
}
.dsh_vscodeRef_remove:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
`,
  },
  settings: {
    id: 'dsh-sidebar-vscode-settings-css',
    css: `
/* The card shell: one plugin's disclosure box inside the official
 * configurable-plugins tab (设置 → 插件 → 插件配置), matching that tab's
 * card rhythm over the same host tokens — collapsed at rest, the whole
 * header one button, the body disclosed in place. */
.dsh_vscodeSet_card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color 0.16s, background 0.16s;
}
.dsh_vscodeSet_card:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh_vscodeSet_card--open {
  border-color: var(--dsw-alias-label-dimmed);
  background: var(--dsw-alias-bg-layer-2);
}
/* The header: one full-width button stacking the name over the line
 * describing what the settings govern, with the disclosure glyph at its
 * end (the official PluginCard rhythm). */
.dsh_vscodeSet_cardHead {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 16px;
  border: 0;
  border-radius: 12px;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh_vscodeSet_cardHead:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
.dsh_vscodeSet_cardText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}
.dsh_vscodeSet_cardTitle {
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeSet_cardDesc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
/* Marker for a card holding user-layer overrides (the chip the official
 * chrome gives an unsaved card; ours marks persisted customization). */
.dsh_vscodeSet_chip {
  flex: none;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.dsh_vscodeSet_chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 0.16s;
}
.dsh_vscodeSet_card--open .dsh_vscodeSet_chevron {
  transform: rotate(180deg);
}
/* The disclosed body: separated from the header by the section hairline,
 * inset to the header's text column. */
.dsh_vscodeSet_cardBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 16px;
  padding: 12px 0 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh_vscodeSet_foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 0;
  min-height: 30px;
}
.dsh_vscodeSet_footNote {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeSet_reset {
  flex: none;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.dsh_vscodeSet_reset:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeSet_reset:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh_vscodeSet_readonly {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-state-warn-label);
  font: var(--dsw-font-xxs-12);
}
.dsh_vscodeSet_rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
}
.dsh_vscodeSet_row {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color 0.16s, background 0.16s;
}
.dsh_vscodeSet_row:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh_vscodeSet_row--stack {
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
}
.dsh_vscodeSet_text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsh_vscodeSet_title {
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeSet_desc {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeSet_hint {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}
.dsh_vscodeSet_control {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dsh_vscodeSet_input {
  width: 96px;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
}
.dsh_vscodeSet_input--block {
  width: 100%;
}
.dsh_vscodeSet_input:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dsh_vscodeSet_input[data-invalid='true'] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh_vscodeSet_input[data-invalid='true']:focus-visible {
  outline-color: var(--dsw-alias-state-error-primary);
}
/* The blocklist row: existing extensions as removable tags, one inline
 * input (with a <datalist> of common suggestions) growing in their wrap.
 * Tag chrome mirrors the turn-tail chips over the same host tokens. */
.dsh_vscodeSet_tagWrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.dsh_vscodeSet_tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px 1px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsh_vscodeSet_tagX {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh_vscodeSet_tagX:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeSet_tagX:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh_vscodeSet_input--inline {
  flex: 1 1 88px;
  width: auto;
  min-width: 72px;
}
/* The switch row's control — the platform-standard switch shape (label +
 * visually-hidden checkbox input + track/thumb spans), so the card reads
 * as one design language with the host's own settings surfaces. */
.dsh_vscodeSet_switch {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
}
.dsh_vscodeSet_switchInput {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
}
.dsh_vscodeSet_switchTrack {
  display: inline-flex;
  align-items: center;
  width: 36px;
  height: 20px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.dsh_vscodeSet_switchThumb {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  transition: transform 0.15s ease, background 0.15s ease;
}
.dsh_vscodeSet_switch:hover .dsh_vscodeSet_switchTrack {
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh_vscodeSet_switchInput:checked + .dsh_vscodeSet_switchTrack {
  border-color: var(--dsw-alias-button-primary-fill);
  background: var(--dsw-alias-button-primary-fill);
}
.dsh_vscodeSet_switchInput:checked + .dsh_vscodeSet_switchTrack .dsh_vscodeSet_switchThumb {
  transform: translateX(16px);
  background: var(--dsw-alias-bg-layer-3);
}
.dsh_vscodeSet_switchInput:focus-visible + .dsh_vscodeSet_switchTrack {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
`,
  },
}

/**
 * Idempotently install the named stylesheets into `document.head`.
 * Tokens and layout variables are host globals, so the sheets stand alone.
 * @param ids - the sheets to install (any subset, any order).
 * @returns a disposer removing the adopted elements (safe to call twice).
 */
export function adoptPluginStyles(...ids: readonly PluginStyleId[]): () => void {
  const owned: HTMLElement[] = []
  for (const id of ids) {
    const sheet = STYLE_SHEETS[id]
    const existing = document.getElementById(sheet.id)
    if (existing !== null) {
      owned.push(existing)
      continue
    }
    const style = document.createElement('style')
    style.id = sheet.id
    style.dataset.plugin = 'dsh-sidebar-vscode'
    style.dataset.pluginCss = sheet.id
    style.textContent = sheet.css
    document.head.appendChild(style)
    owned.push(style)
  }
  return () => {
    for (const node of owned) node.remove()
  }
}
