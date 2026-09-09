/**
 * The plugin's configuration card inside the official settings page:
 * 设置 → 插件 → 插件配置 → VSCode 侧边栏.
 *
 * The card registers into the `settings.plugin.item` seat keyed by the
 * `vscode-sidebar` namespace — the same namespace the Host half serves
 * (`src/settingsSection.ts`) — so the configurable-plugins tab pairs the
 * two and dispatches this card under that key. Reads and writes ride the
 * official settings scope (`ctx.settingsScope.bind`): every row commits
 * per action through `scope.set(field, value)`, and the footer's
 * 「恢复默认」 clears the user layer field by field (`scope.unset`) so
 * each reverts to the composition base.
 *
 * The chrome follows the official PluginCard disclosure (the built-in
 * plugin cards and `dsh-web-search-aggregation`'s copy of it): a `<li>`
 * whose header is one full-width button — name over description, a
 * 「已自定义」 chip while any user-layer field is set, a chevron that
 * rotates — disclosing the rows in place. COLLAPSED by default, like
 * every other card on that page: the card is one entry among many, and
 * which card a user opens is a reading gesture this card keeps to itself
 * (`useState`, no persistence).
 *
 * The disclosed rows are the panel this plugin has always owned, carried
 * over end-to-end:
 *
 * - the openAsDefault SWITCH row (the two file-open takeovers' gate);
 * - the openBlocklist TAG row (openBlocklist.ts's contract): extensions
 *   the chat-open takeover must not claim, rendered as removable tag
 *   chips plus one inline free-form input with a suggestion dropdown —
 *   each add/remove persists the whole next array (commit-per-action);
 * - the serverUrl TEXT row, stacked — description on top, the input
 *   alone on its own full-width line below (`pathMap` deliberately has
 *   NO row: the rare split-container rewrite lives in the settings
 *   document only — the read side still honors it when present);
 * - the maxLines / maxBytes NUMBER rows: pre-filled defaults (an unset
 *   field shows the effective default, and merely focusing and blurring
 *   it writes nothing) and input-time range enforcement (an edit below
 *   the declared minimum or above the maximum is flagged the moment it
 *   is typed and snaps to the nearest bound when it commits).
 *
 * A read-only scope (memory mode — a remote browser process-local
 * connection) disables every control and says so; the rows still render
 * the effective values.
 *
 * @module dsh-sidebar-vscode/client/settingsCard
 */

import { useState } from 'react'
import { t } from './i18n.ts'
import {
  CAP_SPECS,
  commitCap,
  displayCap,
  readUserLayer,
  useSettingsSnapshot,
  type CapSpec,
  type SettingsScopeFace,
} from './settings.ts'
import {
  blocklistSuggestions,
  normalizeExtension,
  parseOpenBlocklist,
  OPEN_BLOCKLIST_KEY,
} from './openBlocklist.ts'
import type { CopyKey } from './locales.ts'
import { VSCODE_SIDEBAR_SETTINGS_BASE, type VscodeSidebarSettings } from '../shared/settings.ts'

/** The card's own props: the injected settings scope (root-scope seat). */
export interface VscodeSettingsCardProps {
  /** The bound `vscode-sidebar` settings scope (this plugin's inject). */
  scope: SettingsScopeFace | undefined
}

/** Copy of one cap row, resolved through t() at render time. */
const CAP_COPY: Record<CapSpec['key'], { title: CopyKey, desc: CopyKey }> = {
  maxLines: { title: 'settingMaxLines', desc: 'settingMaxLinesDesc' },
  maxBytes: { title: 'settingMaxBytes', desc: 'settingMaxBytesDesc' },
}

/** One stacked text row of the card (a free-form settings string). */
interface TextSpec {
  /** The settings field the value persists under. */
  readonly key: 'serverUrl'
  /** Row title copy key. */
  readonly title: CopyKey
  /** Row description copy key. */
  readonly desc: CopyKey
  /** Input placeholder copy key. */
  readonly placeholder: CopyKey
}

/** The stacked text rows, in card order (above the cap rows). */
const TEXT_SPECS: readonly TextSpec[] = [
  {
    key: 'serverUrl',
    title: 'settingServerUrl',
    desc: 'settingServerUrlDesc',
    placeholder: 'settingServerUrlPlaceholder',
  },
]

/** Every field the card may clear on「恢复默认」. */
const RESETTABLE_FIELDS: readonly string[] = [
  'openAsDefault', OPEN_BLOCKLIST_KEY, 'serverUrl', 'pathMap', 'maxLines', 'maxBytes',
]

/**
 * One switch row (the card's boolean settings): title/description left,
 * the standard switch right. Flipping persists the value through the
 * scope; the takeovers read it live, so the very next click follows.
 */
function SwitchRow(props: { title: string, desc: string, checked: boolean, disabled: boolean, onWrite: (next: boolean) => void }) {
  const { title, desc, checked, disabled, onWrite } = props
  return (
    <div className="dsh_vscodeSet_row" data-vscode-switch-row="openAsDefault">
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
            disabled={disabled}
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
 * default); commits the raw text on blur/Enter exactly as typed —
 * including '' when cleared — but only when it actually changed.
 */
function TextRow(props: { spec: TextSpec, raw: unknown, disabled: boolean, onWrite: (value: string) => void }) {
  const { spec, raw, disabled, onWrite } = props
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
        disabled={disabled}
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
 * action (each add/remove persists the whole next array), so no
 * draft-vs-store reconciliation exists beyond the input's own text: the
 * composition base is the default list, and the first edit writes an
 * explicit array (removing every tag stores [] — "block nothing", a
 * stored decision, not a reset to the default).
 */
function BlocklistRow(props: { raw: unknown, disabled: boolean, onWrite: (value: readonly string[]) => void }) {
  const { raw, disabled, onWrite } = props
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
              disabled={disabled}
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
          disabled={disabled}
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
 * Displays the stored value, or the default when unset; flags
 * out-of-range drafts live; commits clamped on blur/Enter.
 */
function CapRow(props: { spec: CapSpec, raw: unknown, disabled: boolean, onWrite: (value: number) => void }) {
  const { spec, raw, disabled, onWrite } = props
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
          disabled={disabled}
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
 * The card: the disclosure header (collapsed at rest, like every card on
 * that page) over the disclosed body — the takeover switch, the
 * open-blocklist tag row (it qualifies the switch above it — which files
 * that takeover must NOT claim), the serverUrl text row, one {@link
 * CapRow} per declared cap spec, and the reset footer — reading and
 * writing the `vscode-sidebar` settings section.
 */
export function VscodeSettingsCard(props: VscodeSettingsCardProps): React.ReactNode {
  const { scope } = props
  const snapshot = useSettingsSnapshot(scope)
  const values: VscodeSidebarSettings = snapshot.value ?? VSCODE_SIDEBAR_SETTINGS_BASE
  const disabled = !snapshot.writable
  const user = readUserLayer(scope)
  const overridden = RESETTABLE_FIELDS.filter(field => field in user)
  const [resetting, setResetting] = useState(false)
  // Card-local, like the official chrome: which card a user has open is a
  // reading gesture, not something the Host has any stake in — and every
  // card on the page starts collapsed.
  const [open, setOpen] = useState(false)

  /** 「恢复默认」: clear the user layer field by field, so every row
   * re-inherits the composition base (the code defaults). */
  const resetDefaults = (): void => {
    if (scope === undefined || resetting) return
    setResetting(true)
    void Promise.all(overridden.map(field => scope.unset(field)))
      .catch(() => {
        // A rejected clear reloads Host state through the scope itself;
        // the card simply follows the next snapshot.
      })
      .finally(() => { setResetting(false) })
  }

  const write = (field: string, value: unknown): void => {
    void scope?.set(field, value).catch(() => {
      // Same recovery contract: the scope re-reads on failure.
    })
  }

  const title = t('cardTitle')
  return (
    <div
      className={open ? 'dsh_vscodeSet_card dsh_vscodeSet_card--open' : 'dsh_vscodeSet_card'}
      data-vscode-settings-card={snapshot.status}
      data-vscode-card-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        className="dsh_vscodeSet_cardHead"
        aria-expanded={open}
        aria-label={`${t(open ? 'cardCollapse' : 'cardExpand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="dsh_vscodeSet_cardText">
          <span className="dsh_vscodeSet_cardTitle">{title}</span>
          <span className="dsh_vscodeSet_cardDesc">{t('cardDescription')}</span>
        </span>
        {overridden.length > 0 && <span className="dsh_vscodeSet_chip">{t('cardCustomized')}</span>}
        <svg className="dsh_vscodeSet_chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="dsh_vscodeSet_cardBody">
          {disabled && <div className="dsh_vscodeSet_readonly">{t('cardReadOnly')}</div>}
          <div className="dsh_vscodeSet_rows" data-vscode-settings>
            <SwitchRow
              title={t('settingOpenAsDefault')}
              desc={t('settingOpenAsDefaultDesc')}
              checked={values.openAsDefault === true}
              disabled={disabled}
              onWrite={(next) => { write('openAsDefault', next) }}
            />
            <BlocklistRow
              raw={values.openBlocklist}
              disabled={disabled}
              onWrite={(value) => { write(OPEN_BLOCKLIST_KEY, [...value]) }}
            />
            {TEXT_SPECS.map(spec => (
              <TextRow
                key={spec.key}
                spec={spec}
                raw={values[spec.key]}
                disabled={disabled}
                onWrite={(value) => { write(spec.key, value) }}
              />
            ))}
            {CAP_SPECS.map(spec => (
              <CapRow
                key={spec.key}
                spec={spec}
                raw={values[spec.key]}
                disabled={disabled}
                onWrite={(value) => { write(spec.key, value) }}
              />
            ))}
          </div>
          <div className="dsh_vscodeSet_foot">
            {overridden.length > 0 && (
              <>
                <span className="dsh_vscodeSet_footNote">{t('cardCustomized')}</span>
                <button
                  type="button"
                  className="dsh_vscodeSet_reset"
                  disabled={disabled || resetting}
                  onClick={resetDefaults}
                >
                  {t('cardReset')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
