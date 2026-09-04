/** The spool root (same base the extension derives from `os.tmpdir()`). */
export declare const OPEN_CHANNEL_BASE: string;
/** How old the capability marker may be before "present" turns false. */
export declare const CAPABILITY_MAX_AGE_MS = 120000;
/**
 * The minimum extension build the command channel trusts. The v0.1.1
 * extension CONSUMED commands but never deleted `cmd.json` and persisted no
 * nonce watermark — every workbench reboot (the sidebar tab's iframe
 * teardown/recreate) re-delivered the last opened file, which is exactly
 * the "closed file reopens on next VS Code start" bug. v0.1.2 (CHANNEL_CAP_V
 * in extension/extension.js) deletes consumed commands, skips stale ones,
 * and writes a versioned cap marker; `readCapability` parses that marker,
 * so a deployment still carrying the old build degrades to the URL-payload
 * channel instead of replaying files.
 */
export declare const CAPABILITY_MIN_V = 2;
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
 * Stamp the embedded-boot marker for `folder`: the sidebar's client calls
 * the `open.embedded` route on every workbench iframe load, and the
 * extension reads the marker at activation to tell its EMBEDDED boots (a
 * fresh stamp) from standalone windows (no stamp) — only embedded boots
 * start with a clean editor area, because their iframe teardown skips
 * VS Code's unload lifecycle and its editor-state restore would otherwise
 * replay files the user closed seconds before closing the tab.
 */
export declare function writeEmbeddedBoot(base: string, folder: string, now?: () => number): Promise<void>;
/**
 * Park one boot nonce in `bootreq.json` BEFORE the client mounts the
 * workbench iframe: the extension (≥ 0.1.2) reads it at activation and
 * echoes it back in its `boot.json` receipt after the editor reconcile,
 * so the client can tell THIS boot's receipt from a previous one without
 * trusting cross-process clocks. The nonce is client-generated randomness
 * (bounded here to a sane printable length); a failed write simply leaves
 * the previous nonce, which the fresh echo cannot match — the client's
 * reveal timeout covers it.
 */
export declare function writeBootRequest(base: string, folder: string, nonce: string): Promise<void>;
/**
 * Whether the extension's `boot.json` receipt for `folder` echoes exactly
 * this boot's nonce — i.e. the editor reconcile already ran for the
 * workbench the client is keeping invisible. Any missing file, parse
 * error, or nonce mismatch answers false (keep waiting; the client's
 * timeout reveals regardless).
 */
export declare function readBootStatus(base: string, folder: string, nonce: string): Promise<boolean>;
/**
 * Whether the extension serving `folder` is alive AND new enough to trust:
 * its capability marker must exist, be younger than
 * {@link CAPABILITY_MAX_AGE_MS}, and carry a build version of at least
 * {@link CAPABILITY_MIN_V} (the pre-0.1.2 extension wrote a bare timestamp
 * and replays consumed commands — it must not be handed any). Any
 * filesystem or parse error simply answers false (degrade, never throw).
 */
export declare function readCapability(base: string, folder: string, maxAgeMs?: number, now?: () => number): Promise<boolean>;
