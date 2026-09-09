/**
 * The `vscode-sidebar` settings read side: one typed window over the
 * official settings scope, plus the numeric capture-cap contract the
 * settings card and the reference pipeline share.
 *
 * The settings live in the Host-served user-settings document (namespace
 * `vscode-sidebar`; the Host half registers it — `src/settingsSection.ts`)
 * and reach the browser through `ctx.settingsScope.bind`. The card
 * (`settingsCard.tsx`) edits them there; the tab body and the takeover
 * gates read them per render / per call, so edits apply to the very next
 * interaction with no re-wiring.
 *
 * Fail-soft by construction: a scope that has not answered yet (or a
 * deployment serving no settings provider) reads as the composition base
 * — the same values the Host would resolve for an all-unset section — so
 * every consumer keeps working with the code defaults.
 *
 * Also owns the numeric capture-cap contract (`maxLines` / `maxBytes`):
 * the defaults and bounds live in `src/shared/settings.ts` (one source
 * shared with the Host schema), and the pure display/commit helpers here
 * serve the card and the read side alike.
 *
 * @module dsh-sidebar-vscode/client/settings
 */
import { MAX_BYTES_DEFAULT, MAX_BYTES_MAX, MAX_BYTES_MIN, MAX_LINES_DEFAULT, MAX_LINES_MAX, MAX_LINES_MIN, type VscodeSidebarSettings } from '../shared/settings.ts';
export { MAX_BYTES_DEFAULT, MAX_BYTES_MAX, MAX_BYTES_MIN, MAX_LINES_DEFAULT, MAX_LINES_MAX, MAX_LINES_MIN, };
/** The numeric cap rows this plugin's settings card owns. */
export interface CapSpec {
    /** The settings field the cap persists under. */
    readonly key: 'maxLines' | 'maxBytes';
    /** Effective value when the field is unset (the field is pre-filled with it). */
    readonly def: number;
    /** Inclusive lower bound (input-time floor). */
    readonly min: number;
    /** Inclusive upper bound (input-time ceiling). */
    readonly max: number;
}
/** The cap rows, in card order. */
export declare const CAP_SPECS: readonly CapSpec[];
/** Clamp one candidate cap onto the integer lattice inside [min, max]. */
export declare function clampCap(value: number, min: number, max: number): number;
/**
 * The value a cap field displays at rest: the stored number when one is
 * set (displayed as-is, so a stale out-of-range store shows up as invalid
 * instead of masquerading as a bound value), otherwise the code default —
 * an unset field is pre-filled with the default, never left empty.
 */
export declare function displayCap(raw: unknown, def: number): number;
/**
 * Resolve one cap commit from the field's raw text against the value the
 * row currently shows. Returns the number to persist (already clamped to
 * the declared bounds — an out-of-range edit snaps to the nearest bound,
 * visibly, at commit time), or null when nothing must be written: empty
 * or unparsable input reverts to the displayed value, and an edit that
 * lands on that same value is a no-op (merely focusing and blurring an
 * untouched field never writes anything).
 */
export declare function commitCap(raw: string, effective: number, min: number, max: number): number | null;
/** The settings scope's snapshot (structural over `SettingsScopeSnapshot<T>`). */
export interface SettingsScopeSnapshot {
    /** `loading` until the first accepted section; `unavailable` when not served. */
    readonly status: 'loading' | 'ready' | 'unavailable';
    /** Last accepted schema-resolved section; undefined before the first acceptance. */
    readonly value: VscodeSidebarSettings | undefined;
    /** Whether the Host document accepts writes (memory mode does not). */
    readonly writable: boolean;
}
/**
 * The settings scope face this plugin touches — structural over the
 * official `SettingsScope<VscodeSidebarSettings>` (bind of
 * `ctx.settingsScope`), so the client bundle stays free of official-package
 * value imports while keeping the exact shapes the service serves.
 */
export interface SettingsScopeFace {
    getSnapshot(): SettingsScopeSnapshot;
    subscribe(listener: () => void): () => void;
    /** Queue one field write (JSON-shaped value selected by the user). */
    set(field: string, value: unknown): Promise<void>;
    /** Queue one field clear, so the field re-inherits the composition base. */
    unset(field: string): Promise<void>;
}
/**
 * The effective settings: the scope's accepted section once ready, else
 * the composition base (the code defaults — a not-yet-answered or absent
 * provider must degrade, never break).
 */
export declare function readSettings(scope: SettingsScopeFace | undefined): VscodeSidebarSettings;
/**
 * Whether the two file-open takeovers may act right now: the
 * `openAsDefault` switch resolved from the live scope.
 */
export declare function takeoverSwitchOn(scope: SettingsScopeFace | undefined): boolean;
/**
 * The capture caps as the reference pipeline consumes them: the resolved
 * numeric fields, defensively re-defaulted (a wire section that slipped a
 * non-number past the schema still reads as the code default, never NaN).
 */
export declare function readSettingCaps(values: VscodeSidebarSettings): {
    maxLines: number;
    maxBytes: number;
};
/**
 * One field's user-override state (the card's reset affordance): `true`
 * while the raw user layer carries the field, `false` while it reverts to
 * the composition base.
 */
export declare function readUserLayer(scope: SettingsScopeFace | undefined): Readonly<Record<string, unknown>>;
/**
 * React binding over one settings scope's RAW snapshot: re-renders on
 * every snapshot replacement. A scope that is absent (tests, a runtime
 * without the settings service) reads as eternally loading.
 * @param scope - the bound settings scope (stable identity assumed).
 * @returns the scope's current snapshot.
 */
export declare function useSettingsSnapshot(scope: SettingsScopeFace | undefined): SettingsScopeSnapshot;
/**
 * React binding over one settings scope's VALUES: the accepted section
 * once ready, else the composition base (the code defaults — a
 * not-yet-answered or absent provider must degrade, never break).
 * @param scope - the bound settings scope (stable identity assumed).
 * @returns the effective settings for the current snapshot.
 */
export declare function useSettings(scope: SettingsScopeFace | undefined): VscodeSidebarSettings;
