/**
 * Reads this tab's persisted pluginSettings blob. The gear popup on the
 * VSCode card (侧边卡片 → VSCode → 功能设置) renders this plugin's own
 * settings panel (settingsRows.tsx — stacked rows: description on top,
 * full-width input below), which writes `serverUrl` / `pathMap` (and the
 * cap keys) into `pluginSettings['dsh-sidebar-vscode:vscode']` in the
 * better-sidebar prefs document; the tab component reads the same keys
 * each render.
 *
 * Also owns the numeric capture-cap contract (`maxLines` / `maxBytes`):
 * the code defaults, the UI bounds, and the pure display/commit helpers
 * the cap settings panel (settingsRows.tsx) and the read side
 * (references.ts) share — one source of truth so the field, the store,
 * and the truncation pipeline can never disagree.
 *
 * @module dsh-sidebar-vscode/client/settings
 */
/** The better-sidebar tab descriptor id this plugin registers. */
export declare const TAB_ID = "dsh-sidebar-vscode:vscode";
/** Default / bounds of the `maxLines` cap (rendered reference lines). */
export declare const MAX_LINES_DEFAULT = 200;
export declare const MAX_LINES_MIN = 1;
export declare const MAX_LINES_MAX = 2000;
/** Default / bounds of the `maxBytes` cap (rendered reference UTF-8 bytes). */
export declare const MAX_BYTES_DEFAULT = 20000;
export declare const MAX_BYTES_MIN = 1000;
export declare const MAX_BYTES_MAX = 200000;
/** The numeric cap rows this plugin's settings panel owns. */
export interface CapSpec {
    /** The pluginSettings key the cap persists under. */
    readonly key: 'maxLines' | 'maxBytes';
    /** Effective value when the key is unset (the field is pre-filled with it). */
    readonly def: number;
    /** Inclusive lower bound (input-time floor). */
    readonly min: number;
    /** Inclusive upper bound (input-time ceiling). */
    readonly max: number;
}
/** The cap rows, in settings-popup order. */
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
 * untouched field never writes anything — the old auto-fill-min bug).
 */
export declare function commitCap(raw: string, effective: number, min: number, max: number): number | null;
/** The minimal store face the settings read needs. */
interface StoreLike {
    getSnapshot(): {
        prefs: {
            pluginSettings: Record<string, Record<string, unknown>>;
        };
    };
}
/**
 * Read one string setting from this tab's pluginSettings blob.
 * Returns '' when absent or not a string (callers treat '' as "not set").
 */
export declare function readSetting(store: StoreLike | undefined, key: string): string;
/**
 * Read one raw setting value from this tab's pluginSettings blob (switches
 * write booleans, number rows write numbers; text rows write strings).
 * Returns undefined when absent or when the store is unavailable.
 */
export declare function readSettingValue(store: StoreLike | undefined, key: string): unknown;
export {};
