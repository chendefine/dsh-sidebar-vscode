'use strict'
/**
 * Manual harness for the dsh.selection-reference extension: stubs the
 * injected `vscode` module, activates the extension, invokes the commands
 * (editor selection + explorer resource), and prints the envelope + decoded
 * payload of each. Run with plain node:
 * `node harness.js /path/to/extension.js`
 */
const path = process.argv[2]
const Module = require('module')
const origLoad = Module._load

const wrote = { text: '', }
const state = { status: '', commands: {}, info: '', warn: '' }

Module._load = function (request, ...rest) {
  if (request !== 'vscode') return origLoad.apply(this, [request, ...rest])
  return {
    window: {
      activeTextEditor: {
        document: {
          languageId: 'python',
          uri: { fsPath: '/opt/dsh/plugins/p/x.py' },
          getText: () => 'a=1\nb=2\nc=3',
        },
        selections: [{ isEmpty: false, start: { line: 9 }, end: { line: 11 } }],
      },
      setStatusBarMessage: (message) => { state.status = message },
      showInformationMessage: (m) => { state.info = m },
      showWarningMessage: (m) => { state.warn = m },
    },
    workspace: {
      asRelativePath: (uri) => (typeof uri === 'string' ? uri : uri.fsPath),
      workspaceFolders: [],
      fs: {
        // FileType.File=1 | FileType.Directory=2 — pick per test URI.
        stat: async (uri) => ({ type: uri.fsPath.endsWith('/sub') ? 2 : 1 }),
      },
    },
    commands: {
      registerCommand: (id, handler) => { state.commands[id] = handler; return { dispose() {} } },
    },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    Range: class {
      constructor(start, end) { this.start = start; this.end = end }
    },
    env: {
      clipboard: {
        writeText: async (text) => { wrote.text = text },
      },
    },
  }
}

const dump = (label) => {
  const match = wrote.text.match(/^@@DSH_REF::([A-Za-z0-9_-]+)::/)
  if (match === null) throw new Error(`no envelope in: ${wrote.text.slice(0, 60)}`)
  const json = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
  console.log(`--- ${label}`)
  console.log('payload :', JSON.stringify(json))
  console.log('fallback:', wrote.text.split('::\n')[1])
  console.log('status  :', state.status)
}

const ext = require(path)
const context = { subscriptions: [] }
ext.activate(context)
state.commands['dsh.selectionReference.send']().then(() => {
  dump('selection')
  return state.commands['dsh.selectionReference.sendFile'](undefined, [
    { fsPath: '/opt/dsh/plugins/p/x.py', toString: () => 'file:///opt/dsh/plugins/p/x.py' },
    { fsPath: '/opt/dsh/plugins/p/sub', toString: () => 'file:///opt/dsh/plugins/p/sub' },
  ])
}).then(() => {
  dump('resource (sendFile)')
  // sendFolder shares the same handler; a single probe proves registration.
  return state.commands['dsh.selectionReference.sendFolder'](undefined, [
    { fsPath: '/opt/dsh/plugins/p/sub', toString: () => 'file:///opt/dsh/plugins/p/sub' },
  ])
}).then(() => {
  dump('resource (sendFolder)')
  // Dispose what activate() registered (the channel poll timer above all)
  // so a plain `node harness.js …` run exits instead of hanging on the
  // self-re-arming poll.
  for (const disposable of context.subscriptions) {
    try { disposable.dispose() } catch { /* already gone */ }
  }
}, (error) => {
  console.error('command failed:', error)
  process.exitCode = 1
})
