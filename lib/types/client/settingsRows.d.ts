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
import { type DefaultTabServiceFace } from './defaultTab.ts';
/** What the render panel needs from better-sidebar's render props. The
 * service is optional: without it (unit tests) the switch still persists,
 * it just cannot offer the immediate swap to the active session. */
export interface CapSettingsPanelProps {
    /** This descriptor's own persisted settings blob. */
    pluginSettings: Record<string, unknown>;
    /** Persist one plugin-owned setting of this descriptor. */
    updatePluginSetting(key: string, value: unknown): void;
    /** The sidebar service (better-sidebar's render props carry it). */
    service?: DefaultTabServiceFace;
}
/**
 * Idempotently install the panel stylesheet into `document.head`.
 * @returns a disposer that removes the element (safe to call twice).
 */
export declare function adoptSettingsStyles(): () => void;
/**
 * The settings panel body: the default-tab switch, the open-blocklist tag
 * row (it qualifies the switch above it — which files that takeover must
 * NOT claim), the serverUrl text row, then one {@link CapRow} per declared
 * cap spec, reading and writing this descriptor's own pluginSettings blob.
 */
export declare function CapSettingsPanel(props: CapSettingsPanelProps): React.ReactNode;
