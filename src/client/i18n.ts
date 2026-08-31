/**
 * Locale integration: registers the dictionary with the DSH locale service
 * and serves `t()` from the active locale. `t()` is a plain function over a
 * module-level service handle — React re-renders pick the new copy up
 * through the app-wide locale re-render; settings rows use `() => t(...)`
 * callbacks so the settings page re-renders read fresh values.
 *
 * @module dsh-sidebar-vscode/client/i18n
 */

import { en, zh, NS, type CopyKey } from './locales.ts'

/** The locale service face (structural subset of @deepseek-ai/dsh-client-locale). */
interface LocaleServiceFace {
  /** Registers the dictionaries; the real service returns an unregister disposer (void-tolerant for foreign shapes). */
  register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): void | (() => void)
  getSnapshot(): { active: string }
}

/** Attached service (module-level; the plugin is a singleton per page). */
let localeService: LocaleServiceFace | undefined

/** The active locale id: the service snapshot, else the browser language. */
export function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')
}

/**
 * Translate one copy key in the active locale (zh* → zh, else en).
 */
export function t(key: CopyKey): string {
  return (activeLocale().toLowerCase().startsWith('zh') ? zh : en)[key]
}

/**
 * Wire the dictionaries to the service (called once from the plugin body).
 * @returns the disposer cordis holds via `ctx.effect`: unregisters the
 * dictionaries (the service's own disposer, when it returned one) and
 * drops the module-level service handle.
 */
export function attachLocale(service: LocaleServiceFace): () => void {
  localeService = service
  const stop = service.register(NS, { zh: { ...zh }, en: { ...en } })
  return () => {
    if (typeof stop === 'function') stop()
    localeService = undefined
  }
}
