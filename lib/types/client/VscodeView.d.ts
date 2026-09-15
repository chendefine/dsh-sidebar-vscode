/**
 * The `vscode` tab body of the official right Sidebar: the projection
 * and chrome of the persistent workbench.
 *
 * THE SHAPE: the official pane renders only the ACTIVE tab's body, and an
 * iframe removed from its parent loses its browsing context (HTML spec:
 * iframe removing steps destroy the child navigable — every DOM move
 * reloads it; verified against Chromium 151). A VS Code workbench has no
 * snapshot/rehydrate path, so this component does NOT own the iframe —
 * `workbenchRuntime.ts` does, inside a host `div` that never leaves
 * `document.body`. What renders here is a PLACEHOLDER (the projection
 * anchor the runtime's projector pins the host's box to), the toolbar,
 * the notices, and the loading overlay; every boot-gating controller
 * (base resolution aside) lives in the runtime and outlives this
 * component's mounts, which is exactly why switching to a sibling tab
 * and back costs nothing: the workbench never even noticed.
 *
 * What stays per-mount:
 * - the session cwd resolution (the sessions registry's live snapshot —
 *   the official standard `useSessions` prop) and the settings read,
 *   both fed INTO the runtime each render;
 * - the iframe BASE resolution (`workbenchBase.ts`) — a mount-scoped
 *   ask whose transient 'resolving' state never tears the live frame
 *   down (the runtime holds its last resolved base until a DIFFERENT one
 *   lands);
 * - the reference lander's payload handler and the paste-fallback
 *   options feed (`referencePipeline.ts`);
 * - the navigation consumer (`openRequests.ts`) driving the runtime's
 *   opener through `tab.navigation`'s one-shot revision discipline;
 * - the first-gesture interact stamping for the revealed frame.
 *
 * Props are the official keyed-seat share: the framework-bound
 * `useTabInfo()` (live sidebar/panel/tab state — `tab.visible` is the
 * docked-active-or-floating visibility, `tab.navigation` carries the
 * takeover's `openTab` params with a monotonic revision, `tab.signal`
 * aborts when the sidebar removes the record), the session-scoped
 * standard props (`sessionId`, `useSessions`), and this plugin's
 * injected settings scope (the `vscode-sidebar` namespace).
 *
 * Design notes that belong to the view itself:
 * - The root mounts FULL-BLEED: the docking kit pads every tab body
 *   (`.paneBody` 12px docked, `.floatBody` 10px floated), and a workbench
 *   reads as the pane itself, not a framed picture — `fullBleed.ts`
 *   measures the host's padding and cancels it edge to edge.
 * - The iframe itself is NOT sandboxed and is served same-origin
 *   (through the host half's built-in `/sidebar/vscode` proxy, or the
 *   deployment's gateway subpath — cookies flow, the WebSocket terminal
 *   works). Its FIRST load is deferred until the tab has been visible
 *   once (the runtime's `visibleOnce` gate — a workbench booted inside a
 *   hidden iframe steals the caret from the composer via its Getting
 *   Started page, so the boot waits for an audience).
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
        /** Aborts when the sidebar removes this tab's record (close, session cleanup). */
        readonly signal: AbortSignal;
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
 * Render the VS Code workbench's seat for the session's workspace: the
 * placeholder the persistent workbench is projected over, plus its chrome.
 * @param props - the official keyed-seat share plus the settings scope.
 */
export declare function VscodeView(props: VscodeViewProps): React.ReactNode;
