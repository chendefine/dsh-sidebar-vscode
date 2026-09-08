/**
 * DSH Selection Reference — editor side, activation root.
 *
 * The extension decomposes along the same seams as its counterparts:
 *
 * - lib/protocol.js — the shared protocol plane's mirror (constants +
 *   slug; lockstep-pinned against src/shared/protocol.ts by CI);
 * - lib/fsutil.js — the atomic marker write + the spool directory;
 * - lib/envelope.js — the three send commands and the clipboard envelope
 *   they ride (selection payloads, resource payloads, readable fallbacks);
 * - lib/channel.js — the command spool poll (capability marker, one-shot
 *   command consumption with TTL/nonce/boot-tag guards);
 * - lib/boot.js — the editor ledger, the boot reconcile, the late-ghost
 *   passes, and the nonce fence that owns them.
 *
 * This file only sequences the activation (see the module docs of each
 * lib for the why of every step):
 *
 * 1. register the send commands;
 * 2. read the boot ledger + the parked boot nonce (BEFORE any tab-change
 *    handler registers: what is on disk right now is the previous
 *    session's final state — the exact open set a restore should converge
 *    back to), and register the DISARMED ledger tracker;
 * 3. run the boot reconcile (fenced on the nonce), then arm the tracker;
 * 4. start the command poll AFTER the reconcile — it closes tabs the
 *    ledger does not list, and a command-channel open arriving mid-
 *    reconcile would be such a tab (its file must not bounce
 *    open→closed); commands simply wait the settle budget out in the
 *    spool, and the poll carries this activation's boot nonce so a
 *    boot-tagged command is consumed only by its own host;
 * 5. schedule the late-ghost passes (only when a ledger existed).
 */
'use strict'

const vscode = require('vscode')
const envelope = require('./lib/envelope')
const boot = require('./lib/boot')
const channel = require('./lib/channel')
const { channelDirOf } = require('./lib/fsutil')
const protocol = require('./lib/protocol')

function activate (context) {
  envelope.registerCommands(vscode, context)

  // The FIRST workspace folder owns the window's ledger (the embedded
  // workbench is single-folder in practice).
  const folders = vscode.workspace.workspaceFolders || []
  const bootDir = folders.length > 0 ? channelDirOf(folders[0].uri.fsPath) : null
  const desired = bootDir !== null ? boot.readLedger(bootDir) : null
  const bootNonce = bootDir !== null ? boot.readBootNonce(bootDir) : null
  const tracker = bootDir !== null
    ? new boot.LedgerTracker(vscode, context, bootDir, bootNonce)
    : null

  void (async () => {
    if (bootDir !== null) await boot.reconcileBoot(bootDir, desired, bootNonce)
    tracker?.arm()
    channel.startChannel(vscode, context, bootNonce)
    if (bootDir !== null && desired !== null) {
      boot.scheduleGhostPasses(bootDir, bootNonce, desired)
    }
  })()
}

module.exports = {
  activate,
  deactivate () {},
  // Test seams (not part of the extension contract).
  slugOf: protocol.slugOf,
  channelDirOf,
}
