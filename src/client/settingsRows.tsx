/**
 * This tab's settings panel (`settings.render` of the tab descriptor),
 * owning every row end-to-end instead of the better-sidebar declarative
 * `pluginToggles` rows:
 *
 * - the serverUrl / pathMap TEXT rows: the declarative row always lays
 *   its control out to the RIGHT of the title/description (a fixed
 *   left-right split with a 200px input), which cramps these two long
 *   free-form values; here each renders stacked — title/description on
 *   top, the input alone on its own full-width line below;
 * - the maxLines / maxBytes NUMBER rows, which the declarative row
 *   cannot express anyway:
 *   - pre-filled defaults: an unset field shows the effective code
 *     default (200 lines / 20000 bytes) as its value, and merely
 *     focusing and blurring it writes nothing (the declarative row
 *     committed '' → 0 → clamped to the MINIMUM, silently storing
 *     1 / 1000);
 *   - input-time range enforcement: an edit below the declared minimum
 *     or above the maximum is flagged the moment it is typed (red field
 *     plus an inline hint; the native min/max bound the spinners and
 *     arrow stepping) and snaps to the nearest bound, visibly, when it
 *     commits (blur / Enter) — what the field shows at rest is exactly
 *     what is stored, so a saved value can never resurface changed on
 *     reopen.
 *
 * The draft is local state that is null at rest (the input mirrors the
 * effective value) and the raw text only while editing, so external
 * store updates never clobber a mid-edit draft and an unchanged draft
 * never produces a write.
 *
 * @module dsh-sidebar-vscode/client/settingsRows
 */

import { useState } from 'react'
import { t } from './i18n.ts'
import { CAP_SPECS, commitCap, displayCap, type CapSpec } from './settings.ts'
import { applyDefaultTab, OPEN_AS_DEFAULT_KEY, type DefaultTabServiceFace } from './defaultTab.ts'
import type { CopyKey } from './locales.ts'

/** Copy of one cap row, resolved through t() at render time. */
const CAP_COPY: Record<CapSpec['key'], { title: CopyKey, desc: CopyKey }> = {
  maxLines: { title: 'settingMaxLines', desc: 'settingMaxLinesDesc' },
  maxBytes: { title: 'settingMaxBytes', desc: 'settingMaxBytesDesc' },
}

/** One stacked text row of the panel (a free-form pluginSettings string). */
interface TextSpec {
  /** The pluginSettings key the value persists under. */
  readonly key: 'serverUrl' | 'pathMap'
  /** Row title copy key. */
  readonly title: CopyKey
  /** Row description copy key. */
  readonly desc: CopyKey
  /** Input placeholder copy key. */
  readonly placeholder: CopyKey
}

/** The stacked text rows, in panel order (above the cap rows — the same
 * order the declarative rows used when they preceded the render panel). */
const TEXT_SPECS: readonly TextSpec[] = [
  {
    key: 'serverUrl',
    title: 'settingServerUrl',
    desc: 'settingServerUrlDesc',
    placeholder: 'settingServerUrlPlaceholder',
  },
  {
    key: 'pathMap',
    title: 'settingPathMap',
    desc: 'settingPathMapDesc',
    placeholder: 'settingPathMapPlaceholder',
  },
]

/** What the render panel needs from better-sidebar's render props. The
 * service is optional: without it (unit tests) the switch still persists,
 * it just cannot offer the immediate swap to the active session. */
export interface CapSettingsPanelProps {
  /** This descriptor's own persisted settings blob. */
  pluginSettings: Record<string, unknown>
  /** Persist one plugin-owned setting of this descriptor. */
  updatePluginSetting(key: string, value: unknown): void
  /** The sidebar service (better-sidebar's render props carry it). */
  service?: DefaultTabServiceFace
}

// ---- panel stylesheet ----

/** Idempotency id of the injected settings <style> element. */
const SETTINGS_STYLE_ID = 'dsh-sidebar-vscode-settings-css'

/**
 * The panel's stylesheet: the same row chrome and geometry as the
 * better-sidebar settings popup rows (l2 hairline, 12px radius, layer-3
 * fill) over the host's `--dsw-alias-*` design tokens, plus the
 * `[data-invalid]` range-enforcement state. Cap rows keep the popup's
 * left-right split (76px-class numeric input right); text rows stack —
 * the title/description block on top, the input alone full-width below.
 * No top margin: since the text rows moved in, this panel is the popup's
 * ONLY body (there is no declarative row list above it to separate from).
 */
const SETTINGS_CSS = `
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
/* The switch row's control — the same visual switch better-sidebar's
 * settings popup uses (label + visually-hidden checkbox input + track /
 * thumb spans), so the popup reads as one design language. */
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
`

/**
 * Idempotently install the panel stylesheet into `document.head`.
 * @returns a disposer that removes the element (safe to call twice).
 */
export function adoptSettingsStyles(): () => void {
  const existing = document.getElementById(SETTINGS_STYLE_ID)
  if (existing !== null) {
    const node = existing
    return () => { node.remove() }
  }
  const style = document.createElement('style')
  style.id = SETTINGS_STYLE_ID
  style.dataset.plugin = 'dsh-sidebar-vscode'
  style.dataset.pluginCss = SETTINGS_STYLE_ID
  style.textContent = SETTINGS_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * One switch row (the panel's boolean settings): title/description left,
 * the popup-standard switch right. Flipping ON persists the value AND (when
 * the service is available) offers the default-tab swap to the active
 * session immediately — see defaultTab.ts; flipping OFF only affects
 * future sessions and never touches any open layout.
 */
function SwitchRow(props: { title: string, desc: string, checked: boolean, onWrite: (next: boolean) => void }) {
  const { title, desc, checked, onWrite } = props
  return (
    <div className="dsh_vscodeSet_row" data-vscode-switch-row={OPEN_AS_DEFAULT_KEY}>
      <span className="dsh_vscodeSet_text">
        <span className="dsh_vscodeSet_title">{title}</span>
        <span className="dsh_vscodeSet_desc">{desc}</span>
      </span>
      <span className="dsh_vscodeSet_control">
        <label className="dsh_vscodeSet_switch">
          <input
            type="checkbox"
            className="dsh_vscodeSet_switchInput"
            checked={checked}
            aria-label={title}
            onChange={event => { onWrite(event.currentTarget.checked) }}
          />
          <span className="dsh_vscodeSet_switchTrack">
            <span className="dsh_vscodeSet_switchThumb" />
          </span>
        </label>
      </span>
    </div>
  )
}

/**
 * One stacked text row: title/description on top, the input alone on its
 * own full-width line below. Displays the stored string ('' when unset,
 * which the read side treats as "not set" and falls back to the code
 * default); commits the raw text on blur/Enter exactly like the
 * declarative text row did — as-is, including '' when cleared — but only
 * when it actually changed.
 */
function TextRow(props: { spec: TextSpec, raw: unknown, onWrite: (value: string) => void }) {
  const { spec, raw, onWrite } = props
  const title = t(spec.title)
  const placeholder = t(spec.placeholder)
  // The value the row shows at rest: the stored string, else '' (unset).
  const effective = typeof raw === 'string' ? raw : ''
  // null at rest (the input mirrors `effective`); the raw text while
  // editing — same draft discipline as the cap rows.
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? effective

  /** Blur / Enter: persist the draft only when it differs from the stored
   * value (merely focusing and blurring an untouched field writes nothing);
   * an unchanged draft never produces a write, a cleared one stores ''. */
  const commit = (): void => {
    if (draft === null) return
    setDraft(null)
    if (draft !== effective) onWrite(draft)
  }

  return (
    <div className="dsh_vscodeSet_row dsh_vscodeSet_row--stack" data-vscode-text-row={spec.key}>
      <span className="dsh_vscodeSet_text">
        <span className="dsh_vscodeSet_title">{title}</span>
        <span className="dsh_vscodeSet_desc">{t(spec.desc)}</span>
      </span>
      <input
        type="text"
        className="dsh_vscodeSet_input dsh_vscodeSet_input--block"
        value={shown}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={title}
        onChange={event => { setDraft(event.currentTarget.value) }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </div>
  )
}

/**
 * One numeric cap row: title/desc left, a bounded number input right.
 * Displays the stored value, or the code default when unset; flags
 * out-of-range drafts live; commits clamped on blur/Enter.
 */
function CapRow(props: { spec: CapSpec, raw: unknown, onWrite: (value: number) => void }) {
  const { spec, raw, onWrite } = props
  const copy = CAP_COPY[spec.key]
  // The value the row shows at rest: the stored number, else the default.
  const effective = displayCap(raw, spec.def)
  // null at rest (the input mirrors `effective`); the raw text while
  // editing. Kept across re-renders so external store updates never
  // clobber a mid-edit draft.
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(effective)
  const parsed = Number(shown)
  const outOfRange = shown.trim() !== '' && (!Number.isFinite(parsed) || parsed < spec.min || parsed > spec.max)

  /** Blur / Enter: adopt the clamped draft (writing only on change),
   * or revert to the effective value on empty / unparsable input. */
  const commit = (): void => {
    if (draft === null) return
    const next = commitCap(draft, effective, spec.min, spec.max)
    setDraft(null)
    if (next !== null) onWrite(next)
  }

  const title = t(copy.title)
  return (
    <div className="dsh_vscodeSet_row" data-vscode-cap-row={spec.key}>
      <span className="dsh_vscodeSet_text">
        <span className="dsh_vscodeSet_title">{title}</span>
        <span className="dsh_vscodeSet_desc">{t(copy.desc)}</span>
        {outOfRange && <span className="dsh_vscodeSet_hint">{t('settingRangeHint')}</span>}
      </span>
      <span className="dsh_vscodeSet_control">
        <input
          type="number"
          className="dsh_vscodeSet_input"
          value={shown}
          min={spec.min}
          max={spec.max}
          step={1}
          inputMode="numeric"
          aria-label={title}
          aria-invalid={outOfRange}
          title={outOfRange ? t('settingRangeHint') : undefined}
          data-invalid={outOfRange ? 'true' : undefined}
          onChange={event => { setDraft(event.currentTarget.value) }}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </span>
    </div>
  )
}

/**
 * The settings panel body: the default-tab switch, the stacked text rows
 * (serverUrl / pathMap), then one {@link CapRow} per declared cap spec,
 * reading and writing this descriptor's own pluginSettings blob.
 */
export function CapSettingsPanel(props: CapSettingsPanelProps): React.ReactNode {
  const { pluginSettings, updatePluginSetting, service } = props
  return (
    <div className="dsh_vscodeSet_rows" data-vscode-settings>
      <SwitchRow
        title={t('settingOpenAsDefault')}
        desc={t('settingOpenAsDefaultDesc')}
        checked={pluginSettings[OPEN_AS_DEFAULT_KEY] === true}
        onWrite={(next) => {
          updatePluginSetting(OPEN_AS_DEFAULT_KEY, next)
          // Flipping ON offers the swap to the active session right away:
          // a still-pristine session becomes a VSCode-default one behind
          // the popup (the async prefs write would reach the same result
          // through the watcher — this just skips the round-trip), while
          // a used session keeps its layout either way.
          if (next && service !== undefined) applyDefaultTab(service)
        }}
      />
      {TEXT_SPECS.map(spec => (
        <TextRow
          key={spec.key}
          spec={spec}
          raw={pluginSettings[spec.key]}
          onWrite={(value) => { updatePluginSetting(spec.key, value) }}
        />
      ))}
      {CAP_SPECS.map(spec => (
        <CapRow
          key={spec.key}
          spec={spec}
          raw={pluginSettings[spec.key]}
          onWrite={(value) => { updatePluginSetting(spec.key, value) }}
        />
      ))}
    </div>
  )
}
