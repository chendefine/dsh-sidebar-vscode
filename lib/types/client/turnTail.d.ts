/**
 * The turn-tail takeover (research option II): this plugin registers the
 * `conversation.chat.turnTail` slot at priority -2 — BEFORE
 * dsh-better-sidebar's own -1 entry — and claims the produced-files row
 * (the "changed files" chips at the end of a turn) with the same
 * `selectProducedFiles` derivation. The rendered row is a visual twin of
 * better-sidebar's, but the chips open the file in THIS plugin's VSCode tab
 * instead of the built-in editor tab.
 *
 * When the gate declines (the `openAsDefault` switch off, the VSCode tab
 * type disabled, or the turn produced nothing) the select returns null and
 * the chain falls through untouched — better-sidebar's -1 entry, then the
 * default deliverables row — so switch-off keeps the stock behavior.
 *
 * Per-chip routing honors the open blocklist (openBlocklist.ts): a chip
 * whose path is blocked calls the render site's own stock `openFile`
 * (carried on the matched value) instead of the VSCode reroute — the same
 * funnel the prose path links drive, where the blocklist declines the
 * open to the Host OS opener.
 *
 * The slot is a CHILD slot the host's ui-conversation declares in its
 * `conversation.chat.node` children table (kind: chain, scope: session).
 * Registering it directly races the declaration — the ui-slots core's
 * load-time validation throws "not declared (a parent entry's children
 * table must declare it)" when the parent entry is not on the ledger yet.
 * slots.inject waits for the declaration (mirrors better-sidebar's
 * registration of the same slot).
 *
 * @module dsh-sidebar-vscode/client/turnTail
 */
import type { ReactNode } from 'react';
import { type TurnTailMatch } from './producedFiles.ts';
/** Idempotently install the row stylesheet into `document.head`. */
export declare function adoptTurnTailStyles(): () => void;
/** The intercepted produced-files row (visual twin of the deliverables chips). */
export declare function TurnTailProducedFiles(props: {
    matched: TurnTailMatch;
    openInVscode: (path: string) => void;
    /** The open blocklist verdict (per click): a blocked path routes to the
     * stock `matched.openFile` when the composition provides one, else
     * degrades to the VSCode open (never a dead chip). */
    isBlocked: (path: string) => boolean;
}): ReactNode;
/** The slots service slice the registration touches (structural). */
export interface TurnTailSlotsFace {
    inject(key: string, callback: () => () => void): () => void;
    register(options: {
        name: string;
        priority?: number;
        registrant?: string;
        select?: (owner: unknown) => unknown;
        inject?: (sessionId: string) => Record<string, unknown>;
    }, component: unknown): () => void;
}
/**
 * Register the turn-tail takeover (returns the disposer).
 *
 * @param slots - the client slots service.
 * @param takeoverEnabled - the gate (the openAsDefault switch AND the VSCode
 * tab type enabled — evaluated per render/claim, so flipping the switch
 * applies to the next row render).
 * @param openInVscode - the chip click handler (reroutes into the VSCode tab).
 * @param isBlocked - the open blocklist verdict per path (a blocked chip
 * routes to the stock `matched.openFile` instead).
 */
export declare function registerTurnTailVscode(slots: TurnTailSlotsFace, takeoverEnabled: () => boolean, openInVscode: (sessionId: string, path: string) => void, isBlocked?: (path: string) => boolean): () => void;
