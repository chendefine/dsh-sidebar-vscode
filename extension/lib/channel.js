'use strict'
/**
 * The command channel, extension side: the /tmp spool poll that turns
 * DSH-side file-open requests into `showTextDocument` calls — no
 * workbench reload. The host half writes
 * `<tmpdir>/dsh-sidebar-vscode/<slug(workspace)>/cmd.json`; this module
 * polls every {@link CHANNEL_POLL_MS} and opens the addressed file.
 *
 * Three independent replay guards make consumption one-shot BY FILESYSTEM
 * STATE (the sidebar tab's close/reopen tears the workbench iframe down
 * and boots a fresh extension host — a fresh host re-reading a leftover
 * cmd.json is exactly the "closed file reopens on every VS Code start"
 * bug):
 *
 * 1. DELETE the command file the moment it is acted on (or skipped as
 *    garbage / TTL-expired — commands older than
 *    {@link protocol.CHANNEL_CMD_TTL_MS} are never opened: a machine
 *    rebooted across the write, or a spool restored from a snapshot, must
 *    never fire a yesterday request);
 * 2. a consumed-nonce WATERMARK persisted in `last.json`, so a delete
 *    that failed (read-only mount) still cannot replay across
 *    extension-host restarts;
 * 3. the BOOT-TAG gate: a command minted by an embedded boot names that
 *    boot's nonce, and only the host that activated with the SAME nonce
 *    may consume it — a lingering previous host (serve-web keeps it — and
 *    its poll — alive for a while after the iframe went away) must not
 *    eat the fresh boot's command, open it into a dying window, and let
 *    the fresh host's ledger reconcile close the file as a ghost.
 *    Skipping (NOT deleting, NOT watermarking) leaves the file for the
 *    rightful host; the TTL eventually cleans an orphaned one.
 *
 * A `cap.json` marker refreshed on every poll tick (when staler than
 * {@link CHANNEL_CAP_REFRESH_MS}) advertises liveness AND build version
 * back: it carries `{v, at}` (v0.1.2+), while the replaying v0.1.1 wrote
 * a bare timestamp; the client probes it through the plugin's fenced
 * route and only trusts the channel from v2 up, falling back to a
 * URL-payload reload otherwise. The spool only works when DSH and the
 * editor share the filesystem (the default same-container topology).
 */

const vscode = require('vscode')
const nodeFs = require('fs')
const nodePath = require('path')
const protocol = require('./protocol')
const { writeMarker, channelDirOf } = require('./fsutil')

/** Command-channel poll interval (ms). */
const CHANNEL_POLL_MS = 500

/** How old the capability marker may get before it is refreshed (ms). */
const CHANNEL_CAP_REFRESH_MS = 60000

/**
 * The persisted last-consumed nonce (`last.json` in the channel dir):
 * seeding the in-memory watermark from it on first sight makes a consumed
 * command STAY consumed across extension-host restarts (Reload Window, a
 * serve-web restart) — the spool's cmd.json is never deleted, so without
 * the marker every restart would replay the last-addressed file once.
 */
function readLastNonce (dir) {
  try {
    const parsed = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, protocol.CHANNEL_FILES.last), 'utf8'))
    return typeof parsed.nonce === 'number' && Number.isFinite(parsed.nonce)
      ? parsed.nonce
      : Number.NEGATIVE_INFINITY
  } catch {
    return Number.NEGATIVE_INFINITY
  }
}

/** Best-effort persisted advance (atomic tmp+rename; failures are silent). */
function persistLastNonce (dir, nonce) {
  try {
    nodeFs.mkdirSync(dir, { recursive: true })
    writeMarker(nodePath.join(dir, protocol.CHANNEL_FILES.last), JSON.stringify({ nonce }))
  } catch { /* best effort */ }
}

/** The versioned capability marker: `{v, at}` (the v0.1.1 wrote a bare timestamp). */
function capMarkerOf (at) {
  return JSON.stringify({ v: protocol.CHANNEL_CAP_V, at })
}

/** Best-effort command-file removal; a failed delete is only a hygiene miss. */
function deleteCommand (dir) {
  try {
    nodeFs.unlinkSync(nodePath.join(dir, protocol.CHANNEL_FILES.cmd))
  } catch { /* absent / read-only — the watermark still guards replays */ }
}

/**
 * One poll tick over every workspace folder: refresh the capability
 * marker when stale, then consume any fresh command (monotonic nonce per
 * folder — a command is consumed at most once even across overlapping
 * ticks). `myBoot` is the boot nonce THIS host activated with (null for a
 * standalone window or a boot whose bootreq could not be read): a
 * boot-tagged command is consumed only by the host owning that boot.
 */
async function channelTick (lastNonceByDir, myBoot) {
  const folders = vscode.workspace.workspaceFolders || []
  for (const folder of folders) {
    const dir = channelDirOf(folder.uri.fsPath)

    // Capability refresh: the client's probe (through the plugin's fenced
    // route) only sees us while this marker is fresh AND versioned — the
    // bare-timestamp marker of the replaying v0.1.1 fails its parse.
    try {
      const capFile = nodePath.join(dir, protocol.CHANNEL_FILES.cap)
      let stale = true
      try {
        stale = Date.now() - nodeFs.statSync(capFile).mtimeMs > CHANNEL_CAP_REFRESH_MS
      } catch { /* absent → stale */ }
      if (stale) {
        nodeFs.mkdirSync(dir, { recursive: true })
        writeMarker(capFile, capMarkerOf(Date.now()))
      }
    } catch { /* best effort */ }

    // Command consumption.
    let command
    try {
      command = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, protocol.CHANNEL_FILES.cmd), 'utf8'))
    } catch {
      continue
    }
    if (command === null || typeof command !== 'object') continue
    const nonce = typeof command.nonce === 'number' && Number.isFinite(command.nonce)
      ? command.nonce
      : null
    const target = typeof command.path === 'string' && command.path.startsWith('/')
      ? command.path
      : null
    if (nonce === null || target === null) {
      // Garbage in the spool: drop it so it cannot confuse a later boot.
      deleteCommand(dir)
      continue
    }
    // The boot-tag gate (see the module doc — the lingering-host hole).
    if (typeof command.boot === 'string' && command.boot !== myBoot) {
      continue
    }
    // A command too old to be a live delivery is dropped, never opened —
    // the replay firewall for a spool entry that predates the current
    // workbench boot (tab closed before the poll consumed it, machine
    // slept, snapshot restore).
    if (typeof command.ts === 'number' && Number.isFinite(command.ts)
      && Date.now() - command.ts > protocol.CHANNEL_CMD_TTL_MS) {
      deleteCommand(dir)
      continue
    }
    if (!lastNonceByDir.has(dir)) lastNonceByDir.set(dir, readLastNonce(dir))
    const last = lastNonceByDir.get(dir) || Number.NEGATIVE_INFINITY
    if (nonce <= last) {
      // Already consumed once (this host or a previous one): the file
      // lingering in the spool is exactly the v0.1.1 replay bug — remove it.
      deleteCommand(dir)
      continue
    }
    // Advance BEFORE acting: a failing open must not retry every tick.
    // The advance is also persisted (last.json), so a host restart reads
    // the watermark back instead of replaying this command.
    lastNonceByDir.set(dir, nonce)
    persistLastNonce(dir, nonce)
    // And the command itself is spent: delete it now so no later boot
    // (extension host restart = every sidebar tab close/reopen) can
    // re-deliver it, watermark or not.
    deleteCommand(dir)
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(target))
    } catch {
      void vscode.window.showWarningMessage(`DSH: 文件不存在 (file not found): ${target}`)
      continue
    }
    const options = { preview: true }
    const line = Number.isFinite(command.line) ? Math.max(1, Math.floor(command.line)) : null
    const column = Number.isFinite(command.column) ? Math.max(1, Math.floor(command.column)) : null
    if (line !== null) {
      const l = line - 1
      const c = (column !== null ? column : 1) - 1
      options.selection = new vscode.Range(l, c, l, c)
    }
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(target), options)
    } catch (error) {
      void vscode.window.showErrorMessage(`DSH: 打开文件失败 — ${String((error && error.message) || error)}`)
    }
  }
}

/**
 * Start the poll loop: a command may already be waiting — the DSH chat
 * click that opened this workbench can race ahead of activation — so the
 * first tick runs on the same cadence. A slow tick never overlaps the
 * next (the timer re-arms only after the tick settles); a throwing tick
 * is logged and skipped, never fatal. Disposal rides the context's
 * subscriptions.
 *
 * @param vscode - the injected VS Code API module.
 * @param context - the extension context (subscriptions).
 * @param bootNonce - the nonce THIS host activated with (null = standalone).
 */
function startChannel (vscode, context, bootNonce) {
  const lastNonceByDir = new Map()
  let pollHandle = null
  const schedulePoll = () => {
    pollHandle = setTimeout(async () => {
      try {
        await channelTick(lastNonceByDir, bootNonce)
      } catch (error) {
        console.error('[dsh.selection-reference] channel tick failed:', error)
      }
      schedulePoll()
    }, CHANNEL_POLL_MS)
  }
  context.subscriptions.push({ dispose () { if (pollHandle !== null) clearTimeout(pollHandle) } })
  schedulePoll()
}

module.exports = { startChannel, channelTick, readLastNonce, persistLastNonce, capMarkerOf, deleteCommand, CHANNEL_POLL_MS, CHANNEL_CAP_REFRESH_MS }
