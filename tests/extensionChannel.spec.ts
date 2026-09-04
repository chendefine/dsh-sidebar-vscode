/**
 * Functional tests for the extension-side command channel (the replay bug
 * fix) and the boot reconcile (the closed-file-ghost fix): activating
 * extension/extension.js against a stubbed `vscode` module with a live
 * tab model, then asserting what the poll does to a planted cmd.json and
 * what the reconcile does to a restored editor set.
 *
 * The replay regression these pin: the sidebar tab's close/reopen tears
 * the workbench iframe down and boots a fresh extension host, and the
 * v0.1.1 channel re-read the never-deleted cmd.json on every boot —
 * reopening the file the user had just closed. Consumption must therefore
 * be one-shot BY FILESYSTEM STATE: delete on act, delete on skip, and a
 * persisted nonce watermark for the window in between.
 *
 * The reconcile regression these pin: the same teardown skips VS Code's
 * unload flush, so its own editor-state restore replays files the user
 * closed seconds before closing the tab. The extension keeps its own
 * `editors.json` ledger (written synchronously on every tab change) and
 * at activation makes the restored window match it — ghosts closed
 * (dirty survive), ledger files reopened, active restored — and reports
 * through `boot.json` echoing the `bootreq.json` nonce the client parked
 * before the iframe loaded.
 *
 * @module dsh-sidebar-vscode/tests/extensionChannel.spec
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import { slugOf } from '../src/openChannel.ts'

const nodeRequire = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const Module = nodeRequire('node:module') as typeof import('node:module') & {
  _load: (this: unknown, request: string, ...rest: unknown[]) => unknown
}

/** What the fake workbench recorded for one showTextDocument call. */
interface OpenRecord { uri: string, preserveFocus?: boolean }

/** Tab shape of the stub (the duck-typed face fileTabsOf reads). */
interface StubTab {
  label: string
  isActive: boolean
  isDirty: boolean
  isPinned: boolean
  isPreview: boolean
  input: { uri: { fsPath: string, scheme: 'file' } }
}

/** Planted tab description. */
export interface PlantedTab { fsPath: string, isDirty?: boolean }

/** One activated extension instance bound to one fake workbench. */
interface Activated {
  opens: OpenRecord[]
  warns: string[]
  errors: string[]
  /** fsPaths closed through tabGroups.close, in order. */
  closed: string[]
  /** The live tab list — planted at activation, mutated by the stub API. */
  tabs: StubTab[]
  /** Fire the tab-change events (what VS Code does on open/close). */
  fireTabChange(): void
  /** The active text editor document fsPath (or null). */
  setActive(fsPath: string | null): void
  dispose(): void
}

/**
 * Activate the extension with a stubbed `vscode` whose workspace holds
 * `folder` and whose window shows `planted` restored tabs (the state VS
 * Code's own editor restore would have produced). The Module._load
 * override is installed only for the duration of the require — and the
 * module cache entry is dropped first, so every call loads a pristine
 * copy binding THIS stub (the module-level `require('vscode')` would
 * otherwise pin the first caller's workbench — the same isolation a
 * real extension-host restart gets).
 */
function activateWithFolder(
  folder: string,
  planted: { tabs?: PlantedTab[], active?: string | null } = {},
): Activated {
  const opens: OpenRecord[] = []
  const warns: string[] = []
  const errors: string[] = []
  const closed: string[] = []
  const tabs: StubTab[] = (planted.tabs ?? []).map(item => ({
    label: item.fsPath,
    isActive: false,
    isDirty: item.isDirty === true,
    isPinned: false,
    isPreview: false,
    input: { uri: { fsPath: item.fsPath, scheme: 'file' } },
  }))
  const tabHandlers: Array<() => void> = []
  const fireTabChange = (): void => { for (const handler of tabHandlers) handler() }
  let activeFsPath: string | null = planted.active ?? null
  const activeTextEditor = () => (activeFsPath === null
    ? undefined
    : { document: { uri: { fsPath: activeFsPath, scheme: 'file' } } })

  const vscodeStub = {
    window: {
      get activeTextEditor () { return activeTextEditor() },
      setStatusBarMessage: () => {},
      showInformationMessage: () => {},
      showWarningMessage: (message: string) => { warns.push(message); return undefined },
      showErrorMessage: (message: string) => { errors.push(message); return undefined },
      // Both faces (uri | document) as the extension uses them: the channel
      // hands a Uri, the reconcile a TextDocument.
      showTextDocument: async (
        thing: { fsPath?: string, uri?: { fsPath: string } },
        options?: { preserveFocus?: boolean },
      ) => {
        const fsPath = thing.uri !== undefined ? thing.uri.fsPath : thing.fsPath!
        opens.push({ uri: fsPath, preserveFocus: options?.preserveFocus })
        if (!tabs.some(tab => tab.input.uri.fsPath === fsPath)) {
          tabs.push({
            label: fsPath, isActive: false, isDirty: false, isPinned: false, isPreview: false,
            input: { uri: { fsPath, scheme: 'file' } },
          })
        }
        if (options?.preserveFocus !== true) activeFsPath = fsPath
        fireTabChange()
      },
      tabGroups: {
        get all () {
          return [{ viewColumn: 1, isActive: true, tabs: tabs.slice() }]
        },
        close: async (tab: StubTab) => {
          const at = tabs.indexOf(tab)
          if (at >= 0) tabs.splice(at, 1)
          closed.push(tab.input.uri.fsPath)
          fireTabChange()
        },
        onDidChangeTabs: (cb: () => void) => { tabHandlers.push(cb); return { dispose () {} } },
        onDidChangeTabGroups: (cb: () => void) => { tabHandlers.push(cb); return { dispose () {} } },
      },
      onDidChangeActiveTextEditor: (cb: () => void) => { tabHandlers.push(cb); return { dispose () {} } },
      onDidChangeVisibleTextEditors: (cb: () => void) => { tabHandlers.push(cb); return { dispose () {} } },
    },
    workspace: {
      asRelativePath: (value: unknown) => String(value),
      workspaceFolders: [{ uri: { fsPath: folder }, name: 'spec', index: 0 }],
      fs: { stat: async () => ({ type: 1 }) },
      openTextDocument: async (uri: { fsPath: string }) => ({
        uri, isDirty: false, fileName: uri.fsPath,
      }),
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async () => {},
    },
    FileType: { File: 1, Directory: 2 },
    Range: class { constructor(public start: unknown, public end: unknown) {} },
    Uri: { file: (path: string) => ({ fsPath: path, scheme: 'file', toString: () => `file://${path}` }) },
    env: { clipboard: { writeText: async () => {} } },
  }
  const originalLoad = Module._load
  Module._load = function patched(request: string, ...rest: unknown[]) {
    if (request === 'vscode') return vscodeStub
    return (originalLoad as NonNullable<typeof Module._load>).apply(this, [request, ...rest])
  }
  let extension: { activate(context: unknown): void } | undefined
  try {
    const extPath = fileURLToPath(new URL('../extension/extension.js', import.meta.url))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (nodeRequire as any).cache[extPath]
    extension = nodeRequire(extPath) as { activate(context: unknown): void }
  } finally {
    Module._load = originalLoad
  }
  const subscriptions: Array<{ dispose(): void }> = []
  extension!.activate({ subscriptions })
  return {
    opens,
    warns,
    errors,
    closed,
    tabs,
    fireTabChange,
    setActive: (fsPath: string | null) => { activeFsPath = fsPath; fireTabChange() },
    dispose() {
      for (const disposable of subscriptions) {
        try { disposable.dispose() } catch { /* already gone */ }
      }
    },
  }
}

/** The spool dir the extension derives for one workspace folder. */
function channelDir(folder: string): string {
  return join(tmpdir(), 'dsh-sidebar-vscode', slugOf(folder))
}

async function plantCommand(folder: string, body: Record<string, unknown>): Promise<void> {
  const dir = channelDir(folder)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'cmd.json'), JSON.stringify(body), 'utf8')
}

async function plantLedger(folder: string, editors: string[], active: string | null): Promise<void> {
  const dir = channelDir(folder)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'editors.json'), JSON.stringify({ v: 1, ts: Date.now(), editors, active }), 'utf8')
}

async function plantBootRequest(folder: string, nonce: string): Promise<void> {
  const dir = channelDir(folder)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'bootreq.json'), JSON.stringify({ nonce }), 'utf8')
}

/** Poll until `probe` truthy or the budget (ms) is spent. */
async function waitFor(probe: () => boolean, budgetMs = 8000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (probe()) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return probe()
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
}

let cleanupDirs: string[] = []

afterAll(async () => {
  for (const dir of cleanupDirs) await rm(dir, { recursive: true, force: true })
})

describe('extension command channel (the replay fix)', () => {
  it('consumes a fresh command once: opens the file, DELETES cmd.json, persists the watermark', async () => {
    const folder = `/dsh-ext-spec-fresh-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    await plantCommand(folder, {
      folder, path: `${folder}/a.ts`, nonce: 4242, ts: Date.now(), line: 3, column: 2,
    })
    const workbench = activateWithFolder(folder)
    try {
      const opened = await waitFor(() => workbench.opens.length > 0)
      expect(opened).toBe(true)
      expect(workbench.opens[0]!.uri).toBe(`${folder}/a.ts`)
      await waitFor(() => !existsSync(join(dir, 'cmd.json')))
      expect(existsSync(join(dir, 'cmd.json'))).toBe(false)
      const last = await readJson(join(dir, 'last.json'))
      expect(last.nonce).toBe(4242)
      expect(workbench.warns).toEqual([])
      expect(workbench.errors).toEqual([])
    } finally {
      workbench.dispose()
    }
  })

  it('a fresh extension host (tab reopen) replays NOTHING from cmd.json: no delivery, no leftover', async () => {
    const folder = `/dsh-ext-spec-restart-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    // First workbench consumes the command (its tab set then holds the file).
    await plantCommand(folder, { folder, path: `${folder}/a.ts`, nonce: 5, ts: Date.now() })
    const first = activateWithFolder(folder)
    await waitFor(() => first.opens.length > 0)
    first.dispose()
    // The sidebar tab closes and reopens: a brand-new extension host with
    // an empty in-memory watermark boots over the same spool — and VS
    // Code's own restore shows the same tab the ledger recorded (focused,
    // as a restore always leaves it), so the reconcile has nothing to do
    // either.
    const second = activateWithFolder(folder, {
      tabs: [{ fsPath: `${folder}/a.ts` }],
      active: `${folder}/a.ts`,
    })
    try {
      await new Promise(resolve => setTimeout(resolve, 1600))
      // No REPLAY of the channel command (the watermark holds it), no
      // reconcile reopen (the restored tab IS the ledger file), and the
      // spool stays clean for later boots.
      expect(second.opens).toEqual([])
      expect(second.warns).toEqual([])
      expect(existsSync(join(dir, 'cmd.json'))).toBe(false)
    } finally {
      second.dispose()
    }
  })

  it('a leftover command older than the TTL is skipped and deleted, never opened', async () => {
    const folder = `/dsh-ext-spec-ttl-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    await plantCommand(folder, {
      folder, path: `${folder}/stale.md`, nonce: 7, ts: Date.now() - 3_600_000,
    })
    const workbench = activateWithFolder(folder)
    try {
      const gone = await waitFor(() => !existsSync(join(dir, 'cmd.json')))
      expect(gone).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 1200))
      expect(workbench.opens).toEqual([])
      expect(workbench.warns).toEqual([])
    } finally {
      workbench.dispose()
    }
  })

  it('a consumed-but-not-deleted command (read-only spool) is held back by the last.json watermark', async () => {
    const folder = `/dsh-ext-spec-watermark-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    await plantCommand(folder, { folder, path: `${folder}/a.ts`, nonce: 9, ts: Date.now() })
    const first = activateWithFolder(folder)
    await waitFor(() => first.opens.length > 0)
    first.dispose()
    await plantCommand(folder, { folder, path: `${folder}/a.ts`, nonce: 9, ts: Date.now() })
    const second = activateWithFolder(folder, {
      tabs: [{ fsPath: `${folder}/a.ts` }],
      active: `${folder}/a.ts`,
    })
    try {
      await new Promise(resolve => setTimeout(resolve, 1600))
      // No channel replay (watermark) and no reconcile reopen (the
      // restored tab matches the ledger file).
      expect(second.opens).toEqual([])
      await waitFor(() => !existsSync(join(dir, 'cmd.json')))
    } finally {
      second.dispose()
    }
  })

  it('garbage in cmd.json is dropped, not retried every tick', async () => {
    const folder = `/dsh-ext-spec-garbage-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    await plantCommand(folder, { folder, path: 'relative-not-absolute', nonce: 11, ts: Date.now() })
    const workbench = activateWithFolder(folder)
    try {
      await waitFor(() => !existsSync(join(dir, 'cmd.json')))
      await new Promise(resolve => setTimeout(resolve, 1200))
      expect(workbench.opens).toEqual([])
      expect(workbench.warns).toEqual([])
    } finally {
      workbench.dispose()
    }
  })

  it('writes the versioned capability marker the host half requires', async () => {
    const folder = `/dsh-ext-spec-cap-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    const workbench = activateWithFolder(folder)
    try {
      const written = await waitFor(() => existsSync(join(dir, 'cap.json')))
      expect(written).toBe(true)
      const marker = await readJson(join(dir, 'cap.json'))
      expect(marker.v).toBe(3)
    } finally {
      workbench.dispose()
    }
  })
})

describe('boot reconcile (the closed-file-ghost fix)', () => {
  it('reconciles a restored window against the ledger: ghosts closed (dirty kept), missing reopened, active restored, receipt echoed', async () => {
    const folder = `/dsh-ext-spec-reconcile-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    // The previous session ended with a.ts + b.ts open, b.ts active; the
    // user then closed a ghost and a dirty buffer stayed open at teardown.
    await plantLedger(folder, [`${folder}/a.ts`, `${folder}/b.ts`], `${folder}/b.ts`)
    await plantBootRequest(folder, 'boot-nonce-1')
    const workbench = activateWithFolder(folder, {
      tabs: [
        { fsPath: `${folder}/a.ts` },
        { fsPath: `${folder}/ghost.ts` },
        { fsPath: `${folder}/dirty.ts`, isDirty: true },
      ],
    })
    try {
      await waitFor(() => existsSync(join(dir, 'boot.json')))
      // The ghost is closed; the dirty tab survives; b.ts is (re)opened.
      expect(workbench.closed).toEqual([`${folder}/ghost.ts`])
      const openedPaths = workbench.opens.map(record => record.uri)
      expect(openedPaths).toContain(`${folder}/b.ts`)
      // The active editor is b.ts (the focused open of the reconcile).
      const focused = workbench.opens.filter(record => record.preserveFocus !== true)
      expect(focused.at(-1)!.uri).toBe(`${folder}/b.ts`)
      // The receipt echoes the parked boot nonce and reports the diff.
      const receipt = await readJson(join(dir, 'boot.json'))
      expect(receipt.nonce).toBe('boot-nonce-1')
      expect(receipt.applied).toBe(true)
      expect(receipt.closed).toBe(1)
      expect(receipt.opened).toBe(1)
      expect(receipt.skippedDirty).toBe(1)
      // And the ledger converged to the reconciled window as it stands:
      // a.ts, the dirty straggler the reconcile kept open (data wins, so
      // it is part of reality), then b.ts — and b.ts active.
      const ledger = await readJson(join(dir, 'editors.json'))
      expect(ledger.editors).toEqual([`${folder}/a.ts`, `${folder}/dirty.ts`, `${folder}/b.ts`])
      expect(ledger.active).toBe(`${folder}/b.ts`)
    } finally {
      workbench.dispose()
    }
  })

  it('an empty ledger closes every restored file tab (everything was closed before the teardown)', async () => {
    const folder = `/dsh-ext-spec-empty-ledger-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    await plantLedger(folder, [], null)
    await plantBootRequest(folder, 'boot-nonce-2')
    const workbench = activateWithFolder(folder, {
      tabs: [{ fsPath: `${folder}/leftover.ts` }, { fsPath: `${folder}/another.ts` }],
    })
    try {
      await waitFor(() => existsSync(join(dir, 'boot.json')))
      expect(workbench.closed.sort()).toEqual([`${folder}/another.ts`, `${folder}/leftover.ts`].sort())
      const receipt = await readJson(join(dir, 'boot.json'))
      expect(receipt.applied).toBe(true)
      expect(receipt.closed).toBe(2)
      expect(receipt.opened).toBe(0)
    } finally {
      workbench.dispose()
    }
  })

  it('a boot with NO ledger keeps VS Code\'s own restore (first boot / degraded payload open)', async () => {
    const folder = `/dsh-ext-spec-noledger-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    await plantBootRequest(folder, 'boot-nonce-3')
    const workbench = activateWithFolder(folder, { tabs: [{ fsPath: `${folder}/payload.ts` }] })
    try {
      await waitFor(() => existsSync(join(dir, 'boot.json')))
      expect(workbench.closed).toEqual([])
      expect(workbench.opens).toEqual([])
      const receipt = await readJson(join(dir, 'boot.json'))
      expect(receipt.applied).toBe(false)
      // The receipt still echoes the nonce — the client reveals promptly.
      expect(receipt.nonce).toBe('boot-nonce-3')
    } finally {
      workbench.dispose()
    }
  })

  it('tracks the live editor set into the ledger after the reconcile (armed on tab changes)', async () => {
    const folder = `/dsh-ext-spec-ledger-live-${process.pid}`
    const dir = channelDir(folder)
    cleanupDirs.push(dir)
    await rm(dir, { recursive: true, force: true })
    const workbench = activateWithFolder(folder)
    try {
      await waitFor(() => existsSync(join(dir, 'boot.json')))
      // The user opens two files and closes one: the ledger follows.
      workbench.tabs.push(
        { label: 'a', isActive: false, isDirty: false, isPinned: false, isPreview: false,
          input: { uri: { fsPath: `${folder}/a.ts`, scheme: 'file' } } },
        { label: 'b', isActive: false, isDirty: false, isPinned: false, isPreview: false,
          input: { uri: { fsPath: `${folder}/b.ts`, scheme: 'file' } } },
      )
      workbench.setActive(`${folder}/b.ts`)
      await waitFor(() => existsSync(join(dir, 'editors.json')))
      const first = await readJson(join(dir, 'editors.json'))
      expect(first.editors).toEqual([`${folder}/a.ts`, `${folder}/b.ts`])
      expect(first.active).toBe(`${folder}/b.ts`)
      workbench.tabs.shift()
      workbench.fireTabChange()
      await waitFor(() => {
        try {
          const parsed = JSON.parse(readFileSync(join(dir, 'editors.json'), 'utf8')) as { editors?: string[] }
          return parsed.editors?.length === 1
        } catch {
          return false
        }
      })
      const second = await readJson(join(dir, 'editors.json'))
      expect(second.editors).toEqual([`${folder}/b.ts`])
    } finally {
      workbench.dispose()
    }
  })
})
