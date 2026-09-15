/**
 * The plugin's stylesheet registry: every CSS block this plugin injects
 * lives here exactly once, and one idempotent adopter installs any subset —
 * replacing the per-module copies of the find-or-create + dispose
 * boilerplate the feature accretion left behind (tab chrome, composer
 * rail, settings card).
 *
 * All rules ride the host's `--dsw-alias-*` design tokens (maintained by
 * the theme presenter — they flip with the appearance preference), so the
 * sheets need no theme awareness of their own. Class prefixes stay
 * per-surface (`dsh_vscodeTab_`, `dsh_vscodeRef_`, `dsh_vscodeSet_`).
 *
 * @module dsh-sidebar-vscode/client/styles
 */
/** The injectable sheets this plugin owns. */
export type PluginStyleId = 'tab' | 'host' | 'rail' | 'settings';
/**
 * Idempotently install the named stylesheets into `document.head`.
 * Tokens and layout variables are host globals, so the sheets stand alone.
 * @param ids - the sheets to install (any subset, any order).
 * @returns a disposer removing the adopted elements (safe to call twice).
 */
export declare function adoptPluginStyles(...ids: readonly PluginStyleId[]): () => void;
