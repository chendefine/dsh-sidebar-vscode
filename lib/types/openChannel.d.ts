/** The spool root (same base the extension derives from `os.tmpdir()`). */
export declare const OPEN_CHANNEL_BASE: string;
/** How old the capability marker may be before "present" turns false. */
export declare const CAPABILITY_MAX_AGE_MS = 120000;
/**
 * Filesystem-safe slug of one workspace folder: non [A-Za-z0-9_-] characters
 * collapse to '_', capped at 64, plus a djb2-xor hex digest of the ORIGINAL
 * string so distinct folders sharing a collapsed form cannot collide.
 * Mirrored in extension/extension.js — keep both in lockstep (spec test).
 */
export declare function slugOf(folder: string): string;
/** One validated open command. */
export interface OpenCommandBody {
    folder: string;
    path: string;
    nonce: number;
    line?: number;
    column?: number;
}
/**
 * Structurally validate one `open.request` payload. Returns null for
 * anything malformed — foreign shapes must never reach the filesystem.
 */
export declare function parseOpenCommand(payload: unknown): OpenCommandBody | null;
/**
 * Write one open command into the folder's spool (atomic tmp+rename, so the
 * extension never observes a partial JSON document).
 */
export declare function writeOpenCommand(base: string, command: OpenCommandBody, now?: () => number): Promise<void>;
/**
 * Whether the extension serving `folder` is alive: its capability marker
 * must exist and be younger than {@link CAPABILITY_MAX_AGE_MS}. Any
 * filesystem error simply answers false (degrade, never throw).
 */
export declare function readCapability(base: string, folder: string, maxAgeMs?: number, now?: () => number): Promise<boolean>;
