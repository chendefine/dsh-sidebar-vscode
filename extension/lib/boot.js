'use strict'
/**
 * Clean embedded boots, extension side: the editor ledger, the boot
 * reconcile, the late-ghost passes, and the nonce fence that owns them.
 *
 * The problem set (all pinned by tests/extensionChannel.spec.ts):
 *
 * - The sidebar tab's iframe teardown SKIPS VS Code's unload lifecycle,
 *   so its periodic editor-state flush never lands for edits made seconds
 *   before the close — and the next boot RESTORES a stale editor set (a
 *   file the user closed reopens "by itself"). The LEDGER (`editors.json`)
 *   records the window's open file-tabs (order + active editor)
 *   synchronously on every tab change, so the teardown race cannot lose
 *   it; at activation the RECONCILE makes the restored window match it:
 *   restored tabs the ledger does not list are closed (dirty tabs survive
 *   — data wins), ledger files the restore lost are reopened, and the
 *   active editor is restored. A boot with NO ledger keeps VS Code's own
 *   behavior untouched. The sidebar's client hides the iframe (opacity 0)
 *   until the extension reports completion through the `boot.json`
 *   receipt — echoing the boot nonce the client parked in `bootreq.json`
 *   before the iframe ever loaded.
 *
 * - serve-web keeps extension hosts alive for a while after their renderer
 *   went away, and such a LINGERING host keeps its armed handlers: it
 *   would write ITS (invisible) window's tab set into the shared ledger —
 *   and the reconcile's reopen loop would re-open ledger files into that
 *   window, whose tab events then re-write the ledger again — poisoning
 *   editors.json with files the visible workbench never showed, which
 *   every later boot faithfully restored (the "closed files come back"
 *   regression). The ledger is therefore OWNED BY THE BOOT: every ledger
 *   write, the reconcile itself, and the ghost passes re-check that the
 *   parked boot nonce is still the one this host activated with (the
 *   client rotates it when a still-mounted frame reloads and as the tab
 *   unmounts, retiring every host that still holds the old nonce).
 *
 * - VS Code's own restore can still be landing tabs AFTER the reconcile's
 *   settle budget ran out (a slow first boot of a heavy workspace), and
 *   those late arrivals are exactly the closed-file ghosts nobody else
 *   will close. The LATE-GHOST PASSES — a few close-only diff passes
 *   spaced across the restore tail — close BACKGROUND tabs the boot
 *   ledger does not list, sparing dirty tabs and the ACTIVE editor
 *   (seconds after a remount the only deliberate opens are user ones,
 *   and a user open becomes the active editor). No pass ever OPENS
 *   anything: reopening is the reconcile's job alone, and a late reopen
 *   could fight a restore that is still deciding its own set.
 */

const vscode = require('vscode')
const nodeFs = require('fs')
const nodePath = require('path')
const protocol = require('./protocol')
const { writeMarker, channelDirOf } = require('./fsutil')

/** Ledger document version (`editors.json`). */
const LEDGER_V = 1

/** Boot receipt version (`boot.json`). */
const BOOT_V = 1

/**
 * How long the boot reconcile waits for VS Code's own editor restore to
 * SETTLE before diffing against the ledger (ms of tab-set stability).
 */
const RECONCILE_SETTLE_MS = 500

/** Poll tick of the settle watch (ms). */
const RECONCILE_TICK_MS = 200

/** Hard budget for the settle watch (ms) — restore is done or lost by then. */
const RECONCILE_BUDGET_MS = 3000

/** Late-ghost pass spacing across the restore tail (ms). */
const GHOST_PASS_DELAYS_MS = [1500, 3500, 7000]

/**
 * Read the editor LEDGER (`editors.json`): the open-editor set the NEXT
 * workbench boot should restore, as of the moment the previous session's
 * last tab change. Written synchronously (atomic rename) on every tab
 * change, so the iframe teardown that skips VS Code's unload flush cannot
 * lose it. Returns null when absent/corrupt — "no opinion": a boot with
 * no ledger keeps VS Code's own restore (a first-ever boot has nothing
 * stale to fear; a degraded URL-payload open must not have its file
 * closed out from under it).
 */
function readLedger (dir) {
  try {
    const parsed = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, protocol.CHANNEL_FILES.editors), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (parsed.v !== LEDGER_V || !Array.isArray(parsed.editors)) return null
    const editors = []
    for (const entry of parsed.editors) {
      if (typeof entry === 'string' && entry.startsWith('/')) editors.push(entry)
    }
    const active = typeof parsed.active === 'string' && parsed.active.startsWith('/')
      ? parsed.active
      : null
    return { editors, active }
  } catch {
    return null
  }
}

/** Best-effort ledger write (atomic tmp+rename; failures are silent). */
function writeLedger (dir, editors, active) {
  try {
    nodeFs.mkdirSync(dir, { recursive: true })
    writeMarker(nodePath.join(dir, protocol.CHANNEL_FILES.editors), JSON.stringify({
      v: LEDGER_V, ts: Date.now(), editors, active,
    }))
  } catch { /* best effort */ }
}

/**
 * The boot nonce the sidebar's client parked in `bootreq.json` BEFORE the
 * workbench iframe loaded (an older host half without the route, or a
 * standalone window, has none — the boot receipt then echoes null and the
 * client's reveal falls back to its timeout).
 */
function readBootNonce (dir) {
  try {
    const parsed = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, protocol.CHANNEL_FILES.bootreq), 'utf8'))
    return typeof parsed.nonce === 'string' && parsed.nonce !== ''
      ? parsed.nonce.slice(0, protocol.NONCE_MAX_LENGTH)
      : null
  } catch {
    return null
  }
}

/**
 * Whether THIS host still owns the channel: the bootreq nonce on disk must
 * still be the one this host activated with. The sidebar's client parks a
 * fresh nonce whenever the workbench iframe mounts, ROTATES it when a
 * still-mounted frame reloads (the pane DOM is detached on a panel
 * collapse or a workspace switch and re-inserted later, which the browser
 * treats as a reload), and rotates again as the tab unmounts — so a host
 * left behind (serve-web keeps extension hosts alive for a while after
 * their renderer went away) sees the nonce change under it. Such a host
 * MUST stand down: its window is invisible, and letting it write the
 * shared ledger (or run the reconcile's reopen loop into its own window,
 * whose tab events then re-write the ledger) poisons editors.json with a
 * tab set the user cannot see — which every later boot faithfully
 * restores. An absent bootreq counts as current only for a host that
 * never had one (a standalone window); a host whose bootreq vanished was
 * parked by an embedded client and is fenced with it.
 */
function isCurrentBoot (dir, myBoot) {
  return readBootNonce(dir) === myBoot
}

/**
 * The boot's user-interaction stamp (`interact.json`, written by the
 * sidebar's client when the REVEALED workbench sees its first user
 * gesture). The reveal racer can reveal the frame before this host even
 * activated, and everything the user opens in that window postdates the
 * ledger the reconcile diffs against — closing it as a "ghost" would
 * close a file the user just opened. The stamp is nonce-scoped: it
 * disarms only the host whose own boot nonce it echoes, so a stale stamp
 * from a previous boot never disarms a later one.
 */
function hasUserInteracted (dir, myBoot) {
  try {
    const parsed = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, protocol.CHANNEL_FILES.interact), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    return parsed.nonce === myBoot
  } catch {
    return false
  }
}

/**
 * The window's file-backed editor tabs in group/tab order (the order the
 * ledger stores and the reconcile reopens in). Duck-typed over the
 * tabGroups API: a tab counts when its input carries a file-scheme uri —
 * settings/webview/untitled/notebook inputs are somebody else's business.
 */
function fileTabsOf () {
  const out = []
  const tabGroups = vscode.window.tabGroups
  const groups = tabGroups && Array.isArray(tabGroups.all) ? tabGroups.all : []
  for (const group of groups) {
    const tabs = group && Array.isArray(group.tabs) ? group.tabs : []
    for (const tab of tabs) {
      const uri = tab && tab.input && tab.input.uri
      if (uri && uri.scheme === 'file' && typeof uri.fsPath === 'string') out.push(tab)
    }
  }
  return out
}

/** Signature of the current tab set — the settle watch's stability probe. */
function tabSignature () {
  try {
    return JSON.stringify(fileTabsOf().map(tab => tab.input.uri.fsPath))
  } catch {
    return 'error'
  }
}

/**
 * Wait for VS Code's own editor restore to settle: poll the tab signature
 * until it holds still for RECONCILE_SETTLE_MS, bounded by
 * RECONCILE_BUDGET_MS. Diffing mid-restore would close tabs that are
 * about to be joined by their siblings.
 */
async function settleTabs () {
  const deadline = Date.now() + RECONCILE_BUDGET_MS
  let last = tabSignature()
  let lastAt = Date.now()
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, RECONCILE_TICK_MS))
    const signature = tabSignature()
    if (signature !== last) {
      last = signature
      lastAt = Date.now()
      continue
    }
    if (Date.now() - lastAt >= RECONCILE_SETTLE_MS) return
  }
}

/**
 * The boot reconcile: make the just-restored editor area match the ledger
 * (the open set at the previous session's end) — close restored tabs the
 * user had closed (dirty tabs survive: data wins), reopen ledger files
 * the restore lost, restore the active editor — then report completion in
 * `boot.json` echoing the boot nonce, which is what the sidebar's client
 * waits for before revealing the iframe (nothing ever visibly opens just
 * to be closed again). A null ledger (first boot / degraded payload open)
 * touches nothing — VS Code's own behavior stands — and still writes the
 * receipt so the client reveals promptly. A host whose boot nonce is no
 * longer current stands down ENTIRELY (no reconcile, no receipt): it is a
 * lingering host whose window the user cannot see, and the rightful host
 * writes the receipt. The fence is checked twice — before the settle
 * watch starts and again after it settles: a rotation that lands mid-
 * settle (the frame reloaded while the reconcile was waiting) retires
 * this host just as thoroughly.
 */
async function reconcileBoot (dir, desired, bootNonce) {
  const report = { applied: false, closed: 0, opened: 0, skippedDirty: 0, deferred: 0 }
  if (!isCurrentBoot(dir, bootNonce)) return report
  try {
    await settleTabs()
    if (!isCurrentBoot(dir, bootNonce)) return report
    if (desired !== null) {
      const keep = new Set(desired.editors)
      const tabs = fileTabsOf()
      const present = new Set(tabs.map(tab => tab.input.uri.fsPath))
      // Close restored tabs the ledger does not list (the closed-file
      // ghost) — dirty tabs are kept open, data wins over cleanliness.
      // The user-interaction fence runs PER TAB (re-read live): the racer
      // may have revealed the frame while this loop was settling, and the
      // moment the user gestures, every remaining close stands down — a
      // boot whose user is present must never lose a tab they opened.
      for (const tab of tabs) {
        if (keep.has(tab.input.uri.fsPath)) continue
        if (tab.isDirty === true) {
          report.skippedDirty += 1
          continue
        }
        if (hasUserInteracted(dir, bootNonce)) {
          report.deferred += 1
          continue
        }
        try {
          await vscode.window.tabGroups.close(tab, true)
          report.closed += 1
        } catch { /* best effort per tab */ }
      }
      // Reopen ledger files the restore lost (existence-checked; a file
      // deleted since the last session is skipped silently).
      for (const fsPath of desired.editors) {
        if (present.has(fsPath)) continue
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
        } catch {
          continue
        }
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath))
          await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true })
          report.opened += 1
        } catch { /* best effort per file */ }
      }
      // Restore the active editor (a no-op show of an already-open doc —
      // skipped when the restored window already got the focus right).
      if (desired.active !== null && keep.has(desired.active)) {
        const activeEditor = vscode.window.activeTextEditor
        const activeUri = activeEditor && activeEditor.document ? activeEditor.document.uri : null
        const activeIsCurrent = activeUri !== null && activeUri.scheme === 'file'
          && typeof activeUri.fsPath === 'string' && activeUri.fsPath === desired.active
        if (!activeIsCurrent) {
          try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(desired.active))
            await vscode.window.showTextDocument(document, { preview: false })
          } catch { /* best effort */ }
        }
      }
      report.applied = true
    }
  } catch (error) {
    console.error('[dsh.selection-reference] boot reconcile failed:', error)
  }
  try {
    nodeFs.mkdirSync(dir, { recursive: true })
    writeMarker(nodePath.join(dir, protocol.CHANNEL_FILES.boot), JSON.stringify({
      v: BOOT_V, ts: Date.now(), nonce: bootNonce, ...report,
    }))
  } catch { /* best effort — the client reveals on its timeout */ }
  return report
}

/** One close-only diff of the live tab set against the boot ledger's keep set. */
async function closeGhostTabs (dir, myBoot, keep) {
  let closedCount = 0
  if (!isCurrentBoot(dir, myBoot)) return closedCount
  // The user-interaction fence: a boot whose user has gestured (the racer
  // may reveal long before the late passes fire) keeps every background
  // tab too — the user's own opens need not still be the active editor,
  // and the boot ledger predates them all.
  if (hasUserInteracted(dir, myBoot)) return closedCount
  try {
    const tabs = fileTabsOf()
    const activeEditor = vscode.window.activeTextEditor
    const activeUri = activeEditor && activeEditor.document ? activeEditor.document.uri : null
    const activeFsPath = activeUri !== null && activeUri.scheme === 'file'
      && typeof activeUri.fsPath === 'string'
      ? activeUri.fsPath
      : null
    for (const tab of tabs) {
      const fsPath = tab.input.uri.fsPath
      if (keep.has(fsPath)) continue
      if (tab.isDirty === true) continue
      if (fsPath === activeFsPath) continue
      try {
        await vscode.window.tabGroups.close(tab, true)
        closedCount += 1
      } catch { /* best effort per tab */ }
    }
  } catch { /* best effort */ }
  return closedCount
}

/**
 * Schedule the late-ghost passes for a boot whose reconcile ran against a
 * real ledger (a null-ledger boot keeps stock behavior — no passes): each
 * pass is close-only and boot-fenced (see the module doc).
 */
function scheduleGhostPasses (dir, bootNonce, desired) {
  const keep = new Set(desired.editors)
  for (const delay of GHOST_PASS_DELAYS_MS) {
    setTimeout(() => { void closeGhostTabs(dir, bootNonce, keep) }, delay)
  }
}

/**
 * The ledger tracker: registers the tab-change listeners NOW (the
 * extension host may be torn down at any moment after this), DISARMED
 * until the reconcile settles — the restore's own tab burst must not
 * poison the ledger before the diff has run. {@link LedgerTracker.arm}
 * arms the synchronous write and takes the first snapshot; from then on,
 * every change (user or otherwise) is persisted synchronously, which is
 * what makes the next teardown race-proof however it tears the iframe
 * down. The FIRST workspace folder owns the window's ledger (the embedded
 * workbench is single-folder in practice). Every write re-checks the
 * boot-nonce fence: a host whose nonce was rotated away writes nothing —
 * its window is invisible and its tab set would poison the ledger.
 */
class LedgerTracker {
  /**
   * @param vscode - the injected VS Code API module.
   * @param context - the extension context (subscriptions).
   * @param bootDir - the first workspace folder's spool directory.
   * @param bootNonce - the nonce THIS host activated with.
   */
  constructor (vscode, context, bootDir, bootNonce) {
    this.bootDir = bootDir
    this.bootNonce = bootNonce
    this.armed = false
    const track = (register) => {
      try {
        const disposable = register(() => { this.writeCurrent() })
        context.subscriptions.push(disposable)
      } catch { /* older workbench without the event — the others cover it */ }
    }
    track(cb => vscode.window.tabGroups.onDidChangeTabs(cb))
    track(cb => vscode.window.tabGroups.onDidChangeTabGroups(cb))
    track(cb => vscode.window.onDidChangeActiveTextEditor(cb))
    track(cb => vscode.window.onDidChangeVisibleTextEditors(cb))
  }

  /** The fenced, synchronous ledger write of the current tab set. */
  writeCurrent () {
    if (!this.armed) return
    // The fence: a host whose boot nonce was rotated away writes nothing —
    // its window is invisible and its tab set would poison the ledger.
    if (!isCurrentBoot(this.bootDir, this.bootNonce)) return
    const tabs = fileTabsOf()
    const activeEditor = vscode.window.activeTextEditor
    const activeUri = activeEditor && activeEditor.document ? activeEditor.document.uri : null
    writeLedger(
      this.bootDir,
      tabs.map(tab => tab.input.uri.fsPath),
      activeUri !== null && activeUri.scheme === 'file' && typeof activeUri.fsPath === 'string'
        ? activeUri.fsPath
        : null,
    )
  }

  /** Arm the tracker and take the first snapshot (after the reconcile). */
  arm () {
    this.armed = true
    this.writeCurrent()
  }
}

module.exports = {
  readLedger,
  writeLedger,
  readBootNonce,
  isCurrentBoot,
  hasUserInteracted,
  fileTabsOf,
  tabSignature,
  settleTabs,
  reconcileBoot,
  closeGhostTabs,
  scheduleGhostPasses,
  LedgerTracker,
  GHOST_PASS_DELAYS_MS,
}
