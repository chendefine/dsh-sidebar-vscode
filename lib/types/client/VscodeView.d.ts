/**
 * The VSCode tab component: resolves the session's authoritative working
 * directory, maps it into the embedded VS Code server's filesystem view
 * (pass-through when no `pathMap` rules are configured — the default),
 * and embeds the VS Code workbench in a same-origin iframe
 * (`<base>/?folder=<mapped cwd>`).
 *
 * Design notes:
 * - The iframe is NOT sandboxed and NOT keyed away on `visible === false`:
 *   the workbench is served same-origin (through the host half's built-in
 *   `/sidebar/vscode` proxy, or the deployment's gateway subpath — cookies
 *   flow, the WebSocket terminal works) and the VS Code session should
 *   survive tab switches inside the sidebar. The FIRST load is deferred,
 *   though, until the tab has been visible once (see the hidden-frame
 *   focus guards below): a workbench booted inside a hidden iframe steals
 *   the caret from the composer via its Getting Started page, so the boot
 *   waits for an audience — and a focus fence keeps a hidden, already
 *   loaded workbench from grabbing focus later.
 * - The authoritative cwd comes from better-sidebar's `/sidebar/api`
 * (`session.cwd`); the scope's optional cwd is used as a fast path.
 * - Settings (`serverUrl`, `pathMap`) are read from the store's prefs
 *   snapshot each render, so edits apply on the next render (`serverUrl`
 *   through the gear popup; `pathMap` is settings-document-only — no
 *   panel row, honored when present).
 * - All chrome follows the DSH appearance (light / dark / system) through
 *   the host's `--dsw-alias-*` tokens — see `adoptTabStyles` below.
 *
 * @module dsh-sidebar-vscode/client/VscodeView
 */
import type { TabComponentProps } from 'dsh-better-sidebar';
/**
 * Idempotently install the tab stylesheet into `document.head`. The tokens
 * are host globals maintained by the theme presenter (they flip with the
 * appearance preference, `system` included), so the stylesheet needs no
 * theme awareness of its own.
 * @returns a disposer that removes the element (safe to call twice).
 */
export declare function adoptTabStyles(): () => void;
/**
 * Render the VS Code workbench for the scope's workspace.
 * @param props - the tab component props (scope + the sidebar store).
 */
export declare function VscodeView(props: TabComponentProps): React.ReactNode;
