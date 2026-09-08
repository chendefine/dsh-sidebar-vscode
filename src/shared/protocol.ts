/**
 * The single-source protocol plane of `dsh-sidebar-vscode`: every constant
 * and pure function that crosses a process boundary — the host (node) half,
 * the browser half, and the VS Code extension's plain-JS mirror
 * (`extension/lib/protocol.js`) — is defined HERE exactly once.
 *
 * The extension cannot import this module (vsce packages only
 * `extension/`), so it carries a hand-maintained CJS mirror whose equality
 * with this table is pinned by `tests/protocolLockstep.spec.ts`: CI fails
 * if the two sides drift. Modules below re-export from here (instead of
 * declaring their own copies) so a change lands in exactly one place.
 *
 * What belongs here: wire markers, spool file names, capability versions,
 * freshness/TTL bounds that both endpoints of a channel must agree on, the
 * workspace-folder slug, and the browser-facing proxy mount. What does
 * NOT: single-sided policy knobs (the extension's poll cadence, the
 * reconcile settle budget — pure extension concerns) and anything that
 * needs Node builtins (the spool root derives from `os.tmpdir()`, so it
 * stays in `src/openChannel.ts`).
 *
 * Pure constants and pure functions only: no Node builtins, no
 * `@deepseek-ai/*` value imports — the client bundle's purity gate rejects
 * both, and the host reuses the module verbatim.
 *
 * @module dsh-sidebar-vscode/shared/protocol
 */

/** Clipboard envelope marker (must match the VS Code extension's mirror). */
export const SELECTION_MARKER = '@@DSH_REF::'

/**
 * The subpath the host half's reverse proxy owns on the DSH web port —
 * the browser-facing mount every same-origin workbench URL flows through
 * (host: `src/vscodeProxy.ts`; client: `src/client/paths.ts`).
 */
export const PROXY_MOUNT = '/sidebar/vscode'

/** Spool directory name under the platform tmpdir (both halves derive it). */
export const OPEN_CHANNEL_DIR = 'dsh-sidebar-vscode'

/**
 * The per-workspace spool files of the extension command channel. One
 * directory `<tmpdir>/dsh-sidebar-vscode/<slug(folder)>/` holds them all;
 * the host half writes, the extension polls:
 *
 * - `cmd` — the last open command (one-shot; the consumer deletes it).
 * - `cap` — the extension's liveness+version marker (`{v, at}`).
 * - `bootreq` — the boot nonce the client parks BEFORE the iframe loads.
 * - `boot` — the extension's post-reconcile receipt echoing that nonce.
 * - `editors` — the editor ledger the reconcile restores from.
 * - `last` — the persisted consumed-nonce watermark (replay firewall).
 * - `embed` — the embedded-boot stamp (fresh = an EMBEDDED boot).
 * - `interact` — the user-interaction stamp of a boot (`{nonce, ts}`):
 *   written once the REVEALED workbench sees its first user gesture, read
 *   by the reconcile's close loop and the ghost passes to stand down — a
 *   boot whose user is already interacting must never have a tab they
 *   opened closed out from under them as a restore ghost.
 */
export const CHANNEL_FILES = {
  cmd: 'cmd.json',
  cap: 'cap.json',
  bootreq: 'bootreq.json',
  boot: 'boot.json',
  editors: 'editors.json',
  last: 'last.json',
  embed: 'embed.json',
  interact: 'interact.json',
} as const

/** Upper bound on every nonce string the routes accept and write. */
export const NONCE_MAX_LENGTH = 128

/**
 * The extension build the channel currently speaks (extension's
 * `CHANNEL_CAP_V`). History: v2 = deletes consumed commands + versioned
 * cap marker (0.1.2); v4 = boot-tagged commands (0.1.3); v5 = the
 * fenced-ledger build (ledger writes/reconcile/ghost passes gated on the
 * parked boot nonce). The host mirrors this only for diagnostics — its
 * trust decision uses {@link CAPABILITY_MIN_V}.
 */
export const CHANNEL_CAP_V = 5

/**
 * The minimum extension build the host hands commands to. The v0.1.1
 * extension consumed commands but never deleted `cmd.json` and kept no
 * nonce watermark — every workbench reboot replayed the last opened file —
 * so its bare-timestamp cap marker must fail the probe.
 */
export const CAPABILITY_MIN_V = 2

/** How old the capability marker may be before "present" turns false (host). */
export const CAPABILITY_MAX_AGE_MS = 120_000

/**
 * How old a command may be when consumed (extension replay firewall). The
 * `ts` field of `cmd.json` is written by the host, so the bound itself is
 * a contract both sides document here.
 */
export const CHANNEL_CMD_TTL_MS = 600_000

/**
 * Filesystem-safe slug of one workspace folder: non `[A-Za-z0-9_-]`
 * characters collapse to '_', capped at 64, plus a djb2-xor hex digest of
 * the ORIGINAL string so distinct folders sharing a collapsed form cannot
 * collide. BOTH sides derive the spool path from the folder they
 * independently know, so the function must stay byte-identical — pinned by
 * `tests/protocolLockstep.spec.ts` (vectors) and `tests/openChannel.spec.ts`
 * (behavior).
 */
export function slugOf(folder: string): string {
  const clean = folder.trim()
  const safe = clean.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  let digest = 5381
  for (let at = 0; at < clean.length; at += 1) {
    digest = ((digest * 33) ^ clean.charCodeAt(at)) >>> 0
  }
  return `${safe}-${digest.toString(16)}`
}
