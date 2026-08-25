/**
 * DSH Selection Reference — editor side.
 *
 * Two commands, one envelope:
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
 * No workspace-relative guessing here beyond asRelativePath: the payload
 * carries both the absolute path and the workspace-relative path; the DSH
 * side picks the display form and translates container paths back into the
 * DSH container's view using its own path-map settings.
 */
'use strict'

const vscode = require('vscode')

/** Envelope marker — must match dsh-sidebar-vscode's SELECTION_MARKER. */
const MARKER = '@@DSH_REF::'

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
}

module.exports = { activate, deactivate () {} }
