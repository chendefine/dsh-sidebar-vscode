/**
 * Locale integration: registers the dictionary with the DSH locale service
 * and serves `t()` from the active locale. `t()` is a plain function over a
 * module-level service handle — React re-renders pick the new copy up
 * through the app-wide locale re-render; settings rows use `() => t(...)`
 * callbacks so the settings page re-renders read fresh values.
 *
 * @module dsh-sidebar-vscode/client/i18n
 */
import { type CopyKey } from './locales.ts';
/** The locale service face (structural subset of @deepseek-ai/dsh-client-locale). */
interface LocaleServiceFace {
    register(ns: string, dicts: {
        zh: Record<string, string>;
        en: Record<string, string>;
    }): unknown;
    getSnapshot(): {
        active: string;
    };
}
/** The active locale id: the service snapshot, else the browser language. */
export declare function activeLocale(): string;
/**
 * Translate one copy key in the active locale (zh* → zh, else en).
 */
export declare function t(key: CopyKey): string;
/**
 * Wire the dictionaries to the service (called once from the plugin body).
 * @returns the disposer cordis holds via `ctx.effect`.
 */
export declare function attachLocale(service: LocaleServiceFace): () => void;
export {};
