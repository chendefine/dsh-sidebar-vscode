/**
 * The workbench open orchestrator: how ONE open request becomes an open
 * inside the embedded VS Code — the two-channel discipline extracted
 * from the VscodeView so it is a unit-testable object with injected
 * transport.
 *
 * - **Primary channel — the extension command spool**: when a workspace
 *   folder is known and the `dsh.selection-reference` extension answers
 *   its capability probe, the open rides `open.request` (the extension
 *   polls the spool and `showTextDocument`s the file — no workbench
 *   reload). From capability version 4 up the command is TAGGED with the
 *   workbench boot's nonce, so only the extension host that activated
 *   with it consumes the open — a lingering previous host (serve-web
 *   keeps it alive for a while after the iframe went away) must not eat
 *   the command, open the file into its dying window, and let the fresh
 *   host's ledger reconcile close it as a ghost.
 * - **Degraded channel — the URL payload**: without the extension (or a
 *   route failure, or no workspace), the workbench reloads once with VS
 *   Code web's native `payload` query parameter. The pending URL is
 *   stamped with the basis it was computed from and ignored once that
 *   basis changes (cwd flip / settings edit), so a stale payload can
 *   never hijack a later navigation.
 *
 * Path semantics: unmapped ≠ unopenable — a path no `pathMap` rule
 * matches passes through as-is (same-container deployment), and the open
 * channel decides existence (extension stat / VS Code's own not-found
 * error); `null` only for non-absolute garbage, which surfaces a notice.
 *
 * @module dsh-sidebar-vscode/client/workbenchLink
 */
import { type PathMapRule } from './paths.ts';
import type { OpenRequest } from './openRequests.ts';
import type { OpenCommand } from './openChannelApi.ts';
/** The live inputs the opener reads per open (kept fresh by the view). */
export interface WorkbenchInputs {
    /** The resolved iframe base (the mount when proxying, else the URL). */
    readonly serverUrl: string;
    /** The parsed `pathMap` rules. */
    readonly pathMap: readonly PathMapRule[];
    /** The session's authoritative cwd (undefined until resolved). */
    readonly cwd: string | undefined;
}
/** One pending degraded-channel payload URL plus the basis it belongs to. */
export interface PendingOpen {
    readonly basis: string;
    readonly url: string;
}
/** The injected seams (tests substitute fakes). */
export interface WorkbenchOpenerDeps {
    /** The live per-open inputs (base/pathMap/cwd). */
    inputs(): WorkbenchInputs;
    /** The boot tag ('hidden'-phase nonce, else undefined — see BootGateController). */
    taggableNonce(): string | undefined;
    /** Surface one degradation notice (the amber row). */
    onNotice(message: string): void;
    /** The pending payload URL changed (null = cleared). */
    onPendingChange(pending: PendingOpen | null): void;
    /** The extension capability probe (false / build version). */
    probeCapability(folder: string): Promise<false | number>;
    /** Hand one command to the extension through the node half. */
    sendOpenCommand(command: OpenCommand): Promise<boolean>;
    /** The page's URL (authority resolution for the degraded payload). */
    pageHref(): string;
    /** The page's host (the authority fallback). */
    pageHost(): string;
}
/** The opener's public face. */
export interface WorkbenchOpener {
    /** Execute one fresh, addressed open request. */
    open(request: OpenRequest): Promise<void>;
    /** Drop any pending degraded payload (the reload button's companion). */
    clearPending(): void;
}
/**
 * Build the opener. Pure orchestration over the injected seams — the
 * historical `executeOpen` verbatim, with the pending-payload state
 * flowing outward through `onPendingChange` instead of React setState.
 */
export declare function createWorkbenchOpener(deps: WorkbenchOpenerDeps): WorkbenchOpener;
