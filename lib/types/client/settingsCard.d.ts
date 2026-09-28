/**
 * The plugin's configuration form on the official Plugins page:
 * 设置 → 插件 → dsh-sidebar-vscode 的配置区(插件页) / 该行的配置页.
 *
 * The form registers into the two seats the Plugins page (dsh ≥ 0.1.7)
 * offers a bundle — `plugins.bundle.config` (keyed by the package name,
 * rendered on the bundle's page between its description and its rows)
 * and `plugins.row.config` (keyed `<package name>#<row id>`, the row's
 * configure control) — mounted while the Host serves the
 * `dsh-sidebar-vscode` namespace (the composition entry id; the section
 * the settings service derives from the entry's `Config` schema). The
 * page draws the title, description, and navigation around the entry;
 * this card is the form body only (the disclosure header of the old
 * settings-list seat is gone with that seat). Reads and writes ride the
 * shared config form (`ctx.configForms.get`): every row commits per
 * action through `settings.set(field, value)` — a refused write reloads
 * Host state through the form itself — and the footer's「恢复默认」
 * clears the user layer field by field (`settings.unset`) so each
 * reverts to the composition base.
 *
 * The rows are the panel this plugin has always owned, carried over
 * end-to-end:
 *
 * - the openAsDefault SWITCH row (the two file-open takeovers' gate);
 * - the openBlocklist TAG row (openBlocklist.ts's contract): extensions
 *   the chat-open takeover must not claim, rendered as removable tag
 *   chips plus one inline free-form input with a suggestion dropdown —
 *   each add/remove persists the whole next array (commit-per-action);
 * - the serverUrl TEXT row, stacked — description on top, the input
 *   alone on its own full-width line below (`pathMap` deliberately has
 *   NO row: the rare split-container rewrite lives in the profile
 *   section only — the read side still honors it when present);
 * - the maxLines / maxBytes NUMBER rows: pre-filled defaults (an unset
 *   field shows the effective default, and merely focusing and blurring
 *   it writes nothing) and input-time range enforcement (an edit below
 *   the declared minimum or above the maximum is flagged the moment it
 *   is typed and snaps to the nearest bound when it commits).
 *
 * A read-only form (memory mode — a remote browser process-local
 * connection) disables every control and says so; the rows still render
 * the effective values.
 *
 * @module dsh-sidebar-vscode/client/settingsCard
 */
import { type SettingsFormFace } from './settings.ts';
/** The card's own props: the view asked for plus the injected config form. */
export interface VscodeSettingsCardProps {
    /**
     * The view the Plugins page asks for: `summary` (the row's
     * description fallback, one line of text) or `page` (this form).
     * Bundle-page seats render `page` only.
     */
    view?: 'summary' | 'page';
    /** The shared `dsh-sidebar-vscode` config form (this plugin's inject). */
    settings: SettingsFormFace | undefined;
}
/**
 * The form: the read-only notice, the staged rows — the takeover switch,
 * the open-blocklist tag row (it qualifies the switch above it — which
 * files that takeover must NOT claim), the serverUrl text row, one
 * {@link CapRow} per declared cap spec — and the reset footer, reading
 * and writing the `dsh-sidebar-vscode` configuration section. The
 * Plugins page draws the title and navigation around it.
 */
export declare function VscodeSettingsCard(props: VscodeSettingsCardProps): React.ReactNode;
