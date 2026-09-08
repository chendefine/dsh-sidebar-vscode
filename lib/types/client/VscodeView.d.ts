/**
 * The VSCode tab component: a composition layer over the workbench
 * lifecycle controllers. Each orthogonal concern of embedding the VS Code
 * web workbench lives in its own unit-testable module, and this component
 * only wires them to the tab's props and renders their state:
 *
 * - the iframe BASE resolution (same-origin mount vs direct URL, with
 *   self-healing graduation) — `workbenchBase.ts`;
 * - the session cwd resolution (scope fast path, `/sidebar/api` authoritative);
 * - the BOOT GATE (park a nonce before the frame mounts, await the
 *   extension's post-reconcile receipt OR the rendered editor strip —
 *   whichever settles first — rotate on in-place reloads) —
 *   `bootGate.ts` (`BootGateController`);
 * - the BOOT LOCK (hold a cross-tab Web Lock while the workbench boots,
 *   release once it has painted — two same-origin tabs racing to create
 *   VS Code's IndexedDB storage deadlock for minutes) — `bootLock.ts`
 *   (`WorkbenchBootLock`);
 * - the FOCUS FENCE (bounce uninvited focus grabs out of the frame) —
 *   `focusFence.ts` (`FocusFenceController`) over the pure rules in
 *   `focusGuard.ts`;
 * - the OPEN REQUESTS (one-shot meta stamps: retire stale, defer until
 *   the gate settles, decline foreign sessions) — `openRequests.ts`
 *   (`OpenRequestConsumer`) driving the two-channel opener in
 *   `workbenchLink.ts` (extension spool first, URL payload degraded);
 * - the CLIPBOARD BRIDGE (same-origin envelope interception) —
 *   `clipboardBridge.ts`;
 * - the paste-fallback options feed — `referencePipeline.ts`.
 *
 * Design notes that belong to the view itself:
 * - The iframe is NOT sandboxed and NOT keyed away on `visible === false`:
 *   the workbench is served same-origin (through the host half's built-in
 *   `/sidebar/vscode` proxy, or the deployment's gateway subpath — cookies
 *   flow, the WebSocket terminal works) and the VS Code session should
 *   survive tab switches inside the sidebar. The FIRST load is deferred,
 *   though, until the tab has been visible once (a workbench booted
 *   inside a hidden iframe steals the caret from the composer via its
 *   Getting Started page, so the boot waits for an audience).
 * - The authoritative cwd comes from better-sidebar's `/sidebar/api`
 *   (`session.cwd`); the scope's optional cwd is used as a fast path.
 * - Settings (`serverUrl`, `pathMap`) are read from the store's prefs
 *   snapshot each render, so edits apply on the next render.
 * - All chrome follows the DSH appearance (light / dark / system) through
 *   the host's `--dsw-alias-*` tokens (the tab stylesheet lives in
 *   styles.ts, adopted by the plugin body with the tab registration).
 *
 * @module dsh-sidebar-vscode/client/VscodeView
 */
import type { TabComponentProps } from 'dsh-better-sidebar';
/**
 * Render the VS Code workbench for the scope's workspace.
 * @param props - the tab component props (scope + the sidebar store).
 */
export declare function VscodeView(props: TabComponentProps): React.ReactNode;
