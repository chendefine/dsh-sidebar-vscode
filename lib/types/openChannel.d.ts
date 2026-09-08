import { CAPABILITY_MAX_AGE_MS, CAPABILITY_MIN_V, slugOf } from './shared/protocol.ts';
export { CAPABILITY_MAX_AGE_MS, CAPABILITY_MIN_V, slugOf };
/** The spool root (same base the extension derives from `os.tmpdir()`). */
export declare const OPEN_CHANNEL_BASE: string;
/** One validated open command. */
export interface OpenCommandBody {
    folder: string;
    path: string;
    nonce: number;
    line?: number;
    column?: number;
    /**
     * The boot nonce of the EMBEDDED workbench this open was minted for
     * (extension cap ≥ 4): the extension consumes a tagged command only on
     * the host that activated with the same nonce, so a lingering previous
     * host cannot eat it (see the extension's boot-tag gate).
     */
    boot?: string;
}
/**
 * Structurally validate one `open.request` payload. Returns null for
 * anything malformed — foreign shapes must never reach the filesystem.
 */
export declare function parseOpenCommand(payload: unknown): OpenCommandBody | null;
/**
 * The per-folder JSON spool: one place for the atomic tmp+rename write and
 * the fail-soft read every channel file shares. A write is never observed
 * half-formed (the extension polls at any instant); a read of a missing or
 * corrupt file answers null instead of throwing, so every caller degrades
 * rather than breaks.
 */
export declare class SpoolStore {
    private readonly base;
    /** @param base - the spool root (usually {@link OPEN_CHANNEL_BASE}). */
    constructor(base: string);
    /** The folder's spool directory (created lazily by {@link write}). */
    private dirOf;
    /** Atomically write one JSON document into the folder's spool. */
    write(folder: string, file: string, document: unknown, now?: () => number): Promise<void>;
    /** Read one JSON document; null when absent, unreadable, or corrupt. */
    readJson(folder: string, file: string): Promise<unknown>;
    /** File facts for freshness checks; null when the file is absent. */
    statFile(folder: string, file: string): Promise<{
        mtimeMs: number;
    } | null>;
}
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
 * Stamp one user interaction for a boot (`interact.json`, `{nonce, ts}`):
 * the client writes it when the REVEALED workbench sees its first user
 * gesture, and the extension's reconcile close loop and ghost passes read
 * it to stand down — the reveal racer can hand the user an interactive
 * workbench while the reconcile is still settling against a ledger that
 * predates their open, and a tab the user opened in that window must
 * never be closed as a restore ghost. The nonce scoping keeps a stale
 * stamp from disarming a later boot.
 */
export declare function writeUserInteract(base: string, folder: string, nonce: string, now?: () => number): Promise<void>;
/**
 * Whether the extension's `boot.json` receipt for `folder` echoes exactly
 * this boot's nonce — i.e. the editor reconcile already ran for the
 * workbench the client is keeping invisible. Any missing file, parse
 * error, or nonce mismatch answers false (keep waiting; the client's
 * timeout reveals regardless).
 */
export declare function readBootStatus(base: string, folder: string, nonce: string): Promise<boolean>;
/**
 * The boot LEDGER (`editors.json`) as it stands at nonce-park time: the
 * open-editor set the extension's reconcile will diff the restored window
 * against (same file, same shape the extension's `readLedger` parses —
 * `v: 1` with an `editors` array of absolute POSIX paths). Answered
 * alongside `boot.begin`'s park so the CLIENT's DOM-quiet reveal racer can
 * tell "the strip is quiet because it is settled" from "the strip is
 * quiet-but-wrong while the reconcile's close is still in flight" — a
 * quiet-but-mismatched strip must keep the frame hidden. Null when absent
 * or malformed: a first-ever boot has no ledger (the reconcile then
 * touches nothing) and an unreadable one gates nothing.
 */
export declare function readBootLedger(base: string, folder: string): Promise<string[] | null>;
/**
 * Whether the extension serving `folder` is alive AND new enough to trust:
 * its capability marker must exist, be younger than
 * {@link CAPABILITY_MAX_AGE_MS}, and carry a build version of at least
 * {@link CAPABILITY_MIN_V} (the pre-0.1.2 extension wrote a bare timestamp
 * and replays consumed commands — it must not be handed any). Any
 * filesystem or parse error simply answers false (degrade, never throw).
 */
export declare function readCapability(base: string, folder: string, maxAgeMs?: number, now?: () => number): Promise<boolean>;
/**
 * The capability probe's full answer: `present` (same contract as
 * {@link readCapability}) plus the marker's build `version` when present
 * (null otherwise) — the client tags open commands with the workbench's
 * boot nonce only from version 4 up (the boot-tag-aware build); an older
 * extension ignores the field, so tagging would be pointless there.
 */
export declare function readCapabilityMarker(base: string, folder: string, maxAgeMs?: number, now?: () => number): Promise<{
    present: boolean;
    version: number | null;
}>;
