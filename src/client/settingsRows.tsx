/**
 * This tab's settings panel (`settings.render` of the tab descriptor),
 * owning every row end-to-end instead of the better-sidebar declarative
 * `pluginToggles` rows:
 *
 * - the serverUrl TEXT row: the declarative row always lays its control
 *   out to the RIGHT of the title/description (a fixed left-right split
 *   with a 200px input), which cramps this long free-form value; here it
 *   renders stacked — title/description on top, the input alone on its
 *   own full-width line below. (`pathMap` deliberately has NO row: the
 *   rare split-container rewrite lives in the settings document only —
 *   the read side still honors it when present;)
 * - the openBlocklist TAG row (openBlocklist.ts's contract): extensions
 *   the chat-open takeover must not claim, rendered as removable tag
 *   chips plus one inline free-form input with a suggestion dropdown —
 *   each add/remove persists the whole next array (commit-per-action);
 *   unset displays the code default, an emptied list stores [] = block
 *   nothing;
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
import {
  blocklistSuggestions,
  normalizeExtension,
  parseOpenBlocklist,
  OPEN_BLOCKLIST_KEY,
} from './openBlocklist.ts'
import type { CopyKey } from './locales.ts'

/** Copy of one cap row, resolved through t() at render time. */
const CAP_COPY: Record<CapSpec['key'], { title: CopyKey, desc: CopyKey }> = {
  maxLines: { title: 'settingMaxLines', desc: 'settingMaxLinesDesc' },
  maxBytes: { title: 'settingMaxBytes', desc: 'settingMaxBytesDesc' },
}

/** One stacked text row of the panel (a free-form pluginSettings string). */
interface TextSpec {
  /** The pluginSettings key the value persists under. */
  readonly key: 'serverUrl'
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
 * The blocklist row: the effective extension list as removable tags plus
 * one inline input adding new entries (free-form, normalized on commit —
 * the <datalist> dropdown only SUGGESTS common binary types). Commits per
 * action (each add/remove persists the whole next array — the same
 * commit-per-action discipline better-sidebar's OpenWithSettings uses),
 * so no draft-vs-store reconciliation exists beyond the input's own text:
 * an unset key displays the code default, and the first edit writes an
 * explicit array (removing every tag stores [] — "block nothing", a
 * stored decision, not a reset to the default).
 */
function BlocklistRow(props: { raw: unknown, onWrite: (value: readonly string[]) => void }) {
  const { raw, onWrite } = props
  const effective = parseOpenBlocklist(raw)
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)

  /** Adopt one entered extension: empty reverts silently, junk flags the
   * hint (the draft stays fixable), a duplicate is a silent no-op, a real
   * new entry appends and persists. Returns whether the input cleared.
   * Takes the text explicitly because the comma path commits a value the
   * draft state has not flushed yet. */
  const adopt = (text: string = draft.trim()): boolean => {
    if (text === '') {
      setInvalid(false)
      return true
    }
    const normalized = normalizeExtension(text)
    if (normalized === null) {
      setDraft(text)
      setInvalid(true)
      return false
    }
    if (!effective.includes(normalized)) onWrite([...effective, normalized])
    setDraft('')
    setInvalid(false)
    return true
  }

  const remove = (extension: string): void => {
    onWrite(effective.filter(entry => entry !== extension))
  }

  const label = t('settingOpenBlocklist')
  return (
    <div className="dsh_vscodeSet_row dsh_vscodeSet_row--stack" data-vscode-blocklist-row={OPEN_BLOCKLIST_KEY}>
      <span className="dsh_vscodeSet_text">
        <span className="dsh_vscodeSet_title">{label}</span>
        <span className="dsh_vscodeSet_desc">{t('settingOpenBlocklistDesc')}</span>
        {invalid && <span className="dsh_vscodeSet_hint">{t('settingOpenBlocklistInvalid')}</span>}
      </span>
      <div className="dsh_vscodeSet_tagWrap">
        {effective.map(extension => (
          <span key={extension} className="dsh_vscodeSet_tag">
            {`.${extension}`}
            <button
              type="button"
              className="dsh_vscodeSet_tagX"
              aria-label={t('settingOpenBlocklistRemove')}
              title={t('settingOpenBlocklistRemove')}
              onClick={() => { remove(extension) }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          className="dsh_vscodeSet_input dsh_vscodeSet_input--inline"
          list="dsh-vscode-blocklist-suggest"
          value={draft}
          placeholder={t('settingOpenBlocklistPlaceholder')}
          spellCheck={false}
          aria-label={label}
          aria-invalid={invalid}
          data-invalid={invalid ? 'true' : undefined}
          onChange={event => {
            setDraft(event.currentTarget.value)
            setInvalid(false)
            // A trailing comma commits the typed segment (the classic
            // tag-input affordance; '.' stays a plain character so
            // multi-part entries like tar.gz type naturally).
            if (event.currentTarget.value.endsWith(',')) {
              adopt(event.currentTarget.value.slice(0, -1))
            }
          }}
          onBlur={() => { adopt() }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              adopt()
            }
          }}
        />
        <datalist id="dsh-vscode-blocklist-suggest">
          {blocklistSuggestions(effective).map(suggestion => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </div>
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
 * The settings panel body: the default-tab switch, the open-blocklist tag
 * row (it qualifies the switch above it — which files that takeover must
 * NOT claim), the serverUrl text row, then one {@link CapRow} per declared
 * cap spec, reading and writing this descriptor's own pluginSettings blob.
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
      <BlocklistRow
        raw={pluginSettings[OPEN_BLOCKLIST_KEY]}
        onWrite={(value) => { updatePluginSetting(OPEN_BLOCKLIST_KEY, [...value]) }}
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
