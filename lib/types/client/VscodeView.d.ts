/**
 * The `vscode` tab body of the official right Sidebar: a composition layer
 * over the workbench lifecycle controllers. Each orthogonal concern of
 * embedding the VS Code web workbench lives in its own unit-testable
 * module, and this component only wires them to the tab's props and
 * renders their state:
 *
 * - the iframe BASE resolution (same-origin mount vs direct URL, with
 *   self-healing graduation) — `workbenchBase.ts`;
 * - the session cwd resolution (the sessions registry's live snapshot —
 *   the official standard `useSessions` prop);
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
 * - the OPEN NAVIGATIONS (one-shot revision discipline: retire stale,
 *   defer until the gate settles) — `openRequests.ts`
 *   (`OpenRequestConsumer`) driving the two-channel opener in
 *   `workbenchLink.ts` (extension spool first, URL payload degraded);
 * - the CLIPBOARD BRIDGE (same-origin envelope interception) —
 *   `clipboardBridge.ts`;
 * - the paste-fallback options feed — `referencePipeline.ts`.
 *
 * Props are the official keyed-seat share: the framework-bound
 * `useTabInfo()` (live sidebar/panel/tab state — `tab.visible` is the
 * docked-active-or-floating visibility, `tab.navigation` carries the
 * takeover's `openTab` params with a monotonic revision), the
 * session-scoped standard props (`sessionId`, `useSessions`), and this
 * plugin's injected settings scope (the `vscode-sidebar` namespace).
 *
 * Design notes that belong to the view itself:
 * - The root mounts FULL-BLEED: the docking kit pads every tab body
 *   (`.paneBody` 12px docked, `.floatBody` 10px floated), and a workbench
 *   reads as the pane itself, not a framed picture — `fullBleed.ts`
 *   measures the host's padding and cancels it edge to edge.
 * - The iframe is NOT sandboxed and NOT keyed away on `visible === false`:
 *   the workbench is served same-origin (through the host half's built-in
 *   `/sidebar/vscode` proxy, or the deployment's gateway subpath — cookies
 *   flow, the WebSocket terminal works). The FIRST load is deferred,
 *   though, until the tab has been visible once (a workbench booted
 *   inside a hidden iframe steals the caret from the composer via its
 *   Getting Started page, so the boot waits for an audience). Note the
 *   official pane renders only the ACTIVE tab's body: switching to a
 *   sibling tab in the same pane unmounts the workbench (a reload path
 *   the boot gate + editor-ledger reconcile handle), and switching back
 *   remounts it through this same deferred-first-load rule.
 * - Settings (`serverUrl`, `pathMap`, the caps) are read from the bound
 *   scope each render (the settings card writes the document), so edits
 *   apply on the next render.
 * - All chrome follows the DSH appearance (light / dark / system) through
 *   the host's `--dsw-alias-*` tokens (the tab stylesheet lives in
 *   styles.ts, adopted by the plugin body with the body registration).
 *
 * @module dsh-sidebar-vscode/client/VscodeView
 */
import { type SettingsScopeFace } from './settings.ts';
/** The framework-bound tab-info hook's answer (structural subset the view reads). */
export interface VscodeTabInfo {
    readonly tab: {
        readonly id: string;
        /** Docked bodies need an expanded sidebar and an active tab; floats stay visible. */
        readonly visible: boolean;
        readonly navigation: {
            readonly revision: number;
            readonly params: unknown;
        };
    };
}
/** The sessions-registry selector hook (structural subset: the cwd source). */
export type UseSessionsCwd = <R>(select: (snapshot: {
    byId: Record<string, {
        cwd?: string;
    } | undefined>;
}) => R) => R;
/** The body's composed props: the official keyed-seat share plus the injected scope. */
export interface VscodeViewProps {
    /** The framework-bound tab information reader (`useTabInfo()`). */
    useTabInfo(): VscodeTabInfo;
    /** The session this tab belongs to (session-scoped standard prop). */
    sessionId: string;
    /** The sessions registry selector (the cwd source). */
    useSessions: UseSessionsCwd;
    /** The bound `vscode-sidebar` settings scope (this plugin's registration inject). */
    settings: SettingsScopeFace | undefined;
}
/**
 * Render the VS Code workbench for the session's workspace.
 * @param props - the official keyed-seat share plus the settings scope.
 */
export declare function VscodeView(props: VscodeViewProps): React.ReactNode;
