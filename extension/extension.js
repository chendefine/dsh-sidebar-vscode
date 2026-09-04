/**
 * DSH Selection Reference — editor side.
 *
 * Three commands, one envelope, one command channel:
 *
 * - "DSH: 发送选中代码到会话 / Send Selection to Session" (editor context
 *   menu, command palette, Ctrl/Cmd+Alt+C): packs the active selection(s) —
 *   file path, 1-based line range(s), language id, the exact text — into a
 *   selection payload.
 * - "DSH: 发送文件到会话 / Send File to Session" and "DSH: 发送文件夹到会话 /
 *   Send Folder to Session" (explorer context menu, shown per the kind of
 *   the right-clicked item): pack the selected file(s)/folder(s) — absolute
 *   path, workspace-relative path, and the kind (file|folder, via
 *   workspace.fs.stat) — into a resource payload
 *   `{ kind: 'resource', resources: [...] }`. No content is captured: the
 *   DSH side annotates the path and kind only. Command titles resolve from
 *   package.nls.json / package.nls.zh-cn.json per the display language.
 *
 * Both hand their JSON payload to `vscode.env.clipboard.writeText` inside an
 * envelope:
 *
 *   @@DSH_REF::<base64url(payload json)>::
 *   <human-readable fallback>
 *
 * Inside the DSH sidebar, the workbench window is same-origin with the DSH
 * page and dsh-sidebar-vscode patches navigator.clipboard.writeText, so the
 * write becomes a structured message: the payload is decoded and injected
 * into the conversation composer; on success nothing touches the real
 * clipboard (the readable part is written only when injection fails).
 * Standalone (no bridge), the envelope just lands on the
 * clipboard — paste it into the DSH composer and the paste-side fallback
 * recognizes the marker.
 *
 * The command channel (v0.1.1+): DSH's chat-side file opens (produced-file
 * chips, tool-row path links) are rerouted into this workbench. The plugin's
 * host half writes `<tmpdir>/dsh-sidebar-vscode/<slug(workspace)>/cmd.json`;
 * this extension polls that spool (500ms) and opens the addressed file with
 * `vscode.window.showTextDocument` — no workbench reload. A consumed command
 * is DELETED right after the open (v0.1.2: an untracked cmd.json is what
 * re-opened the last file on every workbench reboot — the sidebar tab's
 * iframe teardown/recreate restarts the extension host, and a fresh host
 * reading a stale cmd.json replays it), and commands older than
 * CHANNEL_CMD_TTL_MS are skipped and deleted on sight (a machine rebooted
 * across the write, or a spool restored from a snapshot, must never fire a
 * yesterday request). The consumed nonce watermark also persists in
 * `last.json` beside the spool, so a delete that failed (read-only mount)
 * still cannot replay across extension-host restarts. A `cap.json` marker
 * refreshed on every tick advertises liveness — AND build version — back:
 * it carries `{v:2,at}` (v0.1.2+), while the replaying v0.1.1 wrote a bare
 * timestamp; the client probes it through the plugin's fenced route and
 * only trusts the channel on v2+, falling back to a URL-payload reload
 * otherwise. The spool only works when DSH and the editor share the
 * filesystem (the default same-container topology).
 *
 * Embedded boots RECONCILE instead of trusting VS Code's editor-state
 * restore (v0.1.2+): the sidebar tab's iframe teardown skips VS Code's
 * unload lifecycle, so its periodic editor-state flush never lands for
 * edits made seconds before the close — and the next boot RESTORES a
 * stale editor set (a file the user closed reopens "by itself", flashes
 * open, …). The extension therefore keeps its own ledger (`editors.json`,
 * written synchronously on every tab change — immune to the teardown
 * race) and, at activation, reconciles the restored window against it:
 * restored tabs the ledger does not list are closed, ledger files the
 * restore lost are reopened, and the active editor is restored. The
 * sidebar's client hides the iframe (opacity 0) until the extension
 * reports completion through `boot.json` — echoing the boot nonce the
 * client parked in `bootreq.json` before the iframe ever loaded — so the
 * very first VISIBLE frame already shows the reconciled editor area:
 * nothing ever visibly opens just to be closed again. Dirty tabs are
 * never closed (data wins), and a boot with NO ledger (first ever boot
 * in a workspace, or a degraded URL-payload open) keeps VS Code's own
 * behavior untouched.
 *
 * No workspace-relative guessing here beyond asRelativePath: the payload
 * carries both the absolute path and the workspace-relative path; the DSH
 * side picks the display form and translates container paths back into the
 * DSH container's view using its own path-map settings.
 */
'use strict'

const vscode = require('vscode')
const nodeFs = require('fs')
const nodeOs = require('os')
const nodePath = require('path')

/** Envelope marker — must match dsh-sidebar-vscode's SELECTION_MARKER. */
const MARKER = '@@DSH_REF::'

/** Command-channel poll interval (ms). */
const CHANNEL_POLL_MS = 500

/** How old the capability marker may get before it is refreshed (ms). */
const CHANNEL_CAP_REFRESH_MS = 60000

/**
 * Channel build marker carried in cap.json. The replaying v0.1.1 wrote a
 * bare `String(Date.now())`; the client's capability probe only trusts the
 * channel from this version up (see capMarkerOf). v3 = the reconcile build
 * (ledger + boot receipt).
 */
const CHANNEL_CAP_V = 3

/** Ledger document version (`editors.json`). */
const LEDGER_V = 1

/** Boot receipt version (`boot.json`). */
const BOOT_V = 1

/**
 * How old a command may be when consumed (ms). Delivery is a 500ms poll —
 * anything older was never meant for THIS workbench boot: a stale spool
 * entry (machine slept across the write, snapshot restore) is skipped and
 * deleted instead of opened. Ten minutes is far above any healthy
 * write→poll latency while staying well inside a workbench reboot gap.
 */
const CHANNEL_CMD_TTL_MS = 600000

/**
 * How long the boot reconcile waits for VS Code's own editor restore to
 * SETTLE before diffing against the ledger (ms of tab-set stability).
 */
const RECONCILE_SETTLE_MS = 500

/** Poll tick of the settle watch (ms). */
const RECONCILE_TICK_MS = 200

/** Hard budget for the settle watch (ms) — restore is done or lost by then. */
const RECONCILE_BUDGET_MS = 3000


/**
 * The persisted last-consumed nonce (`last.json` in the channel dir):
 * seeding the in-memory watermark from it on first sight makes a consumed
 * command STAY consumed across extension-host restarts (Reload Window, a
 * serve-web restart) — the spool's cmd.json is never deleted, so without
 * the marker every restart would replay the last-addressed file once.
 */
function readLastNonce (dir) {
  try {
    const parsed = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, 'last.json'), 'utf8'))
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
    writeMarker(nodePath.join(dir, 'last.json'), JSON.stringify({ nonce }))
  } catch { /* best effort */ }
}

/**
 * Filesystem-safe slug of one workspace folder — MUST stay in lockstep with
 * src/openChannel.ts `slugOf` (spec pinned by tests/openChannel.spec.ts —
 * the authoritative value list lives there).
 */
function slugOf (folder) {
  const clean = String(folder).trim()
  const safe = clean.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  let digest = 5381
  for (let i = 0; i < clean.length; i++) {
    digest = ((digest * 33) ^ clean.charCodeAt(i)) >>> 0
  }
  return safe + '-' + digest.toString(16)
}

/** The spool directory one workspace folder's channel lives in. */
function channelDirOf (folderPath) {
  return nodePath.join(nodeOs.tmpdir(), 'dsh-sidebar-vscode', slugOf(folderPath))
}

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
    const parsed = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, 'editors.json'), 'utf8'))
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
    writeMarker(nodePath.join(dir, 'editors.json'), JSON.stringify({
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
    const parsed = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, 'bootreq.json'), 'utf8'))
    return typeof parsed.nonce === 'string' && parsed.nonce !== ''
      ? parsed.nonce.slice(0, 128)
      : null
  } catch {
    return null
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
 * receipt so the client reveals promptly.
 */
async function reconcileBoot (dir, desired, bootNonce) {
  const report = { applied: false, closed: 0, opened: 0, skippedDirty: 0 }
  try {
    await settleTabs()
    if (desired !== null) {
      const keep = new Set(desired.editors)
      const tabs = fileTabsOf()
      const present = new Set(tabs.map(tab => tab.input.uri.fsPath))
      // Close restored tabs the ledger does not list (the closed-file
      // ghost) — dirty tabs are kept open, data wins over cleanliness.
      for (const tab of tabs) {
        if (keep.has(tab.input.uri.fsPath)) continue
        if (tab.isDirty === true) {
          report.skippedDirty += 1
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
    writeMarker(nodePath.join(dir, 'boot.json'), JSON.stringify({
      v: BOOT_V, ts: Date.now(), nonce: bootNonce, ...report,
    }))
  } catch { /* best effort — the client reveals on its timeout */ }
  return report
}

/** Best-effort atomic marker write (tmp + rename); failures are silent. */
function writeMarker (file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  nodeFs.writeFileSync(tmp, value)
  nodeFs.renameSync(tmp, file)
}

/** The versioned capability marker: `{v:2,at}` (the v0.1.1 wrote a bare timestamp). */
function capMarkerOf (at) {
  return JSON.stringify({ v: CHANNEL_CAP_V, at })
}

/** Best-effort command-file removal; a failed delete is only a hygiene miss. */
function deleteCommand (dir) {
  try {
    nodeFs.unlinkSync(nodePath.join(dir, 'cmd.json'))
  } catch { /* absent / read-only — the watermark still guards replays */ }
}

/**
 * One poll tick over every workspace folder: refresh the capability marker
 * when stale, then consume any fresh command (monotonic nonce per folder —
 * a command is consumed at most once even across overlapping ticks).
 */
async function channelTick (lastNonceByDir) {
  const folders = vscode.workspace.workspaceFolders || []
  for (const folder of folders) {
    const dir = channelDirOf(folder.uri.fsPath)

    // Capability refresh: the client's probe (through the plugin's fenced
    // route) only sees us while this marker is fresh AND versioned — the
    // bare-timestamp marker of the replaying v0.1.1 fails its parse.
    try {
      const capFile = nodePath.join(dir, 'cap.json')
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
      command = JSON.parse(nodeFs.readFileSync(nodePath.join(dir, 'cmd.json'), 'utf8'))
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
    // A command too old to be a live delivery is dropped, never opened —
    // this is the replay firewall for a spool entry that predates the
    // current workbench boot (tab closed before the poll consumed it,
    // machine slept, snapshot restore).
    if (typeof command.ts === 'number' && Number.isFinite(command.ts)
      && Date.now() - command.ts > CHANNEL_CMD_TTL_MS) {
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

/** Rendered code-line cap for the human-readable fallback part. */
const FALLBACK_MAX_LINES = 200

/** base64url of a UTF-8 string (node ext host). */
function toBase64Url (text) {
  return Buffer.from(text, 'utf8').toString('base64url')
}

/** Whether a path string is absolute (posix; the editor server runs on Linux). */
function isAbsolute (p) {
  return p.startsWith('/')
}

/** Build the selection payload from the active editor. */
function buildPayload (editor) {
  const document = editor.document
  const spans = []
  for (const selection of editor.selections) {
    if (selection.isEmpty) continue
    spans.push({
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
      text: document.getText(new vscode.Range(selection.start, selection.end))
    })
  }
  if (spans.length === 0) return null

  let relative
  try {
    const rel = vscode.workspace.asRelativePath(document.uri, false)
    // Outside any workspace folder asRelativePath echoes the absolute path.
    if (typeof rel === 'string' && rel !== '' && !isAbsolute(rel)) relative = rel
  } catch { /* no workspace — leave relative unset */ }

  return {
    path: document.uri.fsPath,
    relative,
    language: document.languageId,
    dirty: document.isDirty,
    spans
  }
}

/** Human-readable fallback: fenced snippet(s) with line labels. */
function readableFallback (payload) {
  const name = payload.relative || payload.path
  let budget = FALLBACK_MAX_LINES
  const parts = []
  for (const span of payload.spans) {
    if (budget <= 0) break
    const lines = span.text.replace(/\r\n/g, '\n').split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    const keep = Math.min(lines.length, budget)
    budget -= keep
    const label = span.startLine === span.endLine
      ? `L${span.startLine}`
      : `L${span.startLine}-L${span.endLine}`
    parts.push(`@${name} ${label}:\n\`\`\`${payload.language || ''}\n${lines.slice(0, keep).join('\n')}\n\`\`\``)
  }
  return parts.join('\n\n')
}

/**
 * Build the resource payload from explorer-selected URIs. The kind comes
 * from workspace.fs.stat (symlinks resolve to their target's kind); items
 * that vanish between the click and the command are skipped.
 */
async function buildResourcePayload (uris) {
  const resources = []
  const seen = new Set()
  for (const uri of uris) {
    const key = uri.toString()
    if (seen.has(key)) continue
    seen.add(key)
    let type
    try {
      const info = await vscode.workspace.fs.stat(uri)
      type = (info.type & vscode.FileType.Directory) !== 0 ? 'folder' : 'file'
    } catch {
      continue
    }
    let relative
    try {
      const rel = vscode.workspace.asRelativePath(uri, false)
      // Outside any workspace folder asRelativePath echoes the absolute path.
      if (typeof rel === 'string' && rel !== '' && !isAbsolute(rel)) relative = rel
    } catch { /* no workspace — leave relative unset */ }
    const item = { path: uri.fsPath, type }
    if (relative !== undefined) item.relative = relative
    resources.push(item)
  }
  if (resources.length === 0) return null
  return { kind: 'resource', resources }
}

/** Human-readable fallback for a resource payload: one line per item. */
function readableResourceFallback (payload) {
  return payload.resources
    .map(item => `@${item.relative || item.path} (${item.type})`)
    .join('\n')
}

function activate (context) {
  const disposable = vscode.commands.registerCommand('dsh.selectionReference.send', async () => {
    const editor = vscode.window.activeTextEditor
    if (editor === undefined) {
      void vscode.window.showWarningMessage('DSH: 没有活动的编辑器 (no active editor)')
      return
    }
    const payload = buildPayload(editor)
    if (payload === null) {
      void vscode.window.showInformationMessage('DSH: 请先选中一段代码 (select something first)')
      return
    }
    const envelope = `${MARKER}${toBase64Url(JSON.stringify(payload))}::\n${readableFallback(payload)}`
    try {
      await vscode.env.clipboard.writeText(envelope)
    } catch (error) {
      void vscode.window.showErrorMessage(`DSH: 写入剪贴板失败 — ${String(error)}`)
      return
    }
    const label = payload.relative || payload.path
    void vscode.window.setStatusBarMessage(`DSH: 已发送 ${label} 的选中内容`, 4000)
  })

  // Explorer selections: files and/or folders (multi-select aware). Two
  // commands share one body — the explorer menu shows the file entry when the
  // right-clicked item is a file and the folder entry when it is a folder
  // (`when: explorerResourceIsFolder`); either handles the whole selection
  // list, and each item's chip is typed by its own stat result. When a
  // command comes from the palette (no URI arguments) there is nothing to
  // send — point at the explorer context menu instead.
  const sendResource = async (uri, uris) => {
    const list = Array.isArray(uris) && uris.length > 0 ? uris : uri !== undefined ? [uri] : []
    if (list.length === 0) {
      void vscode.window.showInformationMessage('DSH: 请在资源管理器中右键选中文件或文件夹 (right-click files/folders in the Explorer)')
      return
    }
    const payload = await buildResourcePayload(list)
    if (payload === null) {
      void vscode.window.showWarningMessage('DSH: 无法读取选中项 (could not read the selection)')
      return
    }
    const envelope = `${MARKER}${toBase64Url(JSON.stringify(payload))}::\n${readableResourceFallback(payload)}`
    try {
      await vscode.env.clipboard.writeText(envelope)
    } catch (error) {
      void vscode.window.showErrorMessage(`DSH: 写入剪贴板失败 — ${String(error)}`)
      return
    }
    void vscode.window.setStatusBarMessage(`DSH: 已发送 ${payload.resources.length} 个选中项`, 4000)
  }
  const fileDisposable = vscode.commands.registerCommand('dsh.selectionReference.sendFile', sendResource)
  const folderDisposable = vscode.commands.registerCommand('dsh.selectionReference.sendFolder', sendResource)
  context.subscriptions.push(disposable, fileDisposable, folderDisposable)

  // The command channel: poll the spool from the first tick (a command may
  // already be waiting — the DSH chat click that opened this workbench can
  // race ahead of activation). A slow tick never overlaps the next (the
  // timer re-arms only after the tick settles); a throwing tick is logged
  // and skipped, never fatal.
  const lastNonceByDir = new Map()

  // ── Editor ledger + boot reconcile ────────────────────────────────────
  // The FIRST workspace folder owns the window's ledger (the embedded
  // workbench is single-folder in practice). The ledger snapshot is read
  // BEFORE any tab-change handler registers: what is on disk right now is
  // the previous session's final state — the exact open set a restore
  // should converge back to. The handlers below stay DISARMED until the
  // reconcile settles, so the restore's own tab burst cannot poison the
  // ledger before the diff has run; from arm on, every change (user or
  // otherwise) is persisted synchronously, which is what makes the next
  // teardown race-proof however it tears the iframe down.
  const folders = vscode.workspace.workspaceFolders || []
  const bootDir = folders.length > 0 ? channelDirOf(folders[0].uri.fsPath) : null
  const desired = bootDir !== null ? readLedger(bootDir) : null
  const bootNonce = bootDir !== null ? readBootNonce(bootDir) : null
  let ledgerArmed = false
  const writeCurrentLedger = () => {
    if (!ledgerArmed || bootDir === null) return
    const tabs = fileTabsOf()
    const activeEditor = vscode.window.activeTextEditor
    const activeUri = activeEditor && activeEditor.document ? activeEditor.document.uri : null
    writeLedger(
      bootDir,
      tabs.map(tab => tab.input.uri.fsPath),
      activeUri !== null && activeUri.scheme === 'file' && typeof activeUri.fsPath === 'string'
        ? activeUri.fsPath
        : null,
    )
  }
  if (bootDir !== null) {
    const track = (register) => {
      try {
        const disposable = register(writeCurrentLedger)
        context.subscriptions.push(disposable)
      } catch { /* older workbench without the event — the others cover it */ }
    }
    track(cb => vscode.window.tabGroups.onDidChangeTabs(cb))
    track(cb => vscode.window.tabGroups.onDidChangeTabGroups(cb))
    track(cb => vscode.window.onDidChangeActiveTextEditor(cb))
    track(cb => vscode.window.onDidChangeVisibleTextEditors(cb))
  }

  let pollHandle = null
  const schedulePoll = () => {
    pollHandle = setTimeout(async () => {
      try {
        await channelTick(lastNonceByDir)
      } catch (error) {
        console.error('[dsh.selection-reference] channel tick failed:', error)
      }
      schedulePoll()
    }, CHANNEL_POLL_MS)
  }
  context.subscriptions.push({ dispose () { if (pollHandle !== null) clearTimeout(pollHandle) } })

  // Reconcile first, poll after: the reconcile closes tabs the ledger does
  // not list, and a command-channel open arriving mid-reconcile would be
  // such a tab — its file must not bounce open→closed. The poll delay is
  // bounded by the settle budget plus the diff itself (a couple of
  // seconds); commands simply wait that out in the spool.
  void (async () => {
    if (bootDir !== null) await reconcileBoot(bootDir, desired, bootNonce)
    ledgerArmed = true
    writeCurrentLedger()
    schedulePoll()
  })()
}

module.exports = {
  activate,
  deactivate () {},
  // Test seams (not part of the extension contract).
  slugOf,
  channelDirOf,
}
