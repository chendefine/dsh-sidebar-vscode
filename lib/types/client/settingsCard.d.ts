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
import { type SettingsScopeFace } from './settings.ts';
/** The card's own props: the injected settings scope (root-scope seat). */
export interface VscodeSettingsCardProps {
    /** The bound `vscode-sidebar` settings scope (this plugin's inject). */
    scope: SettingsScopeFace | undefined;
}
/**
 * The card: the disclosure header (collapsed at rest, like every card on
 * that page) over the disclosed body — the takeover switch, the
 * open-blocklist tag row (it qualifies the switch above it — which files
 * that takeover must NOT claim), the serverUrl text row, one {@link
 * CapRow} per declared cap spec, and the reset footer — reading and
 * writing the `vscode-sidebar` settings section.
 */
export declare function VscodeSettingsCard(props: VscodeSettingsCardProps): React.ReactNode;
