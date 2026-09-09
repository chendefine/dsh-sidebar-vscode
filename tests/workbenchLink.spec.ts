/**
 * Unit tests for the workbench open orchestrator
 * (src/client/workbenchLink.ts): the two-channel discipline — the
 * extension command spool first (with the boot tag from capability
 * version 4 up), the URL-payload reload degraded — plus the pending-basis
 * invalidation and the unmapped-path notice.
 *
 * @module dsh-sidebar-vscode/tests/workbenchLink.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchOpener, type WorkbenchOpenerDeps } from '../src/client/workbenchLink.ts'
import type { OpenRequest } from '../src/client/openRequests.ts'

/** One opener over fakes. */
function makeOpener(options: {
  capable?: false | number
  sendOk?: boolean
  taggable?: string
  cwd?: string
} = {}) {
  const notices: string[] = []
  const pending: Array<{ basis: string, url: string } | null> = []
  const probeCapability = vi.fn(async () => options.capable ?? 5)
  const sendOpenCommand = vi.fn(async () => options.sendOk ?? true)
  const deps: WorkbenchOpenerDeps = {
    inputs: () => ({ serverUrl: '/sidebar/vscode', pathMap: [], cwd: 'cwd' in options ? options.cwd : '/w' }),
    taggableNonce: () => options.taggable,
    onNotice: message => { notices.push(message) },
    onPendingChange: next => { pending.push(next) },
    probeCapability,
    sendOpenCommand,
    pageHref: () => 'http://dsh.local:3080/',
    pageHost: () => 'dsh.local:3080',
  }
  return {
    opener: createWorkbenchOpener(deps),
    notices,
    pending,
    probeCapability,
    sendOpenCommand,
  }
}

/** Flush the open promise chain. */
const flush = async (): Promise<void> => { await new Promise(r => { setTimeout(r, 0) }) }

describe('createWorkbenchOpener', () => {
  it('rides the extension channel when the probe answers (no pending payload)', async () => {
    const h = makeOpener({ capable: 5, sendOk: true, taggable: 'boot-1' })
    await h.opener.open({ nonce: 7, path: '/w/src/a.ts', line: 3 } as OpenRequest)
    expect(h.sendOpenCommand).toHaveBeenCalledTimes(1)
    expect(h.sendOpenCommand).toHaveBeenCalledWith({
      folder: '/w',
      path: '/w/src/a.ts',
      nonce: 7,
      line: 3,
      boot: 'boot-1',
    })
    expect(h.pending).toEqual([])
  })

  it('omits the boot tag below capability version 4 (the build ignores it)', async () => {
    const h = makeOpener({ capable: 3, sendOk: true, taggable: 'boot-1' })
    await h.opener.open({ nonce: 7, path: '/w/a.ts' })
    expect(h.sendOpenCommand).toHaveBeenCalledWith({ folder: '/w', path: '/w/a.ts', nonce: 7 })
  })

  it('omits the boot tag when the gate holds no live nonce', async () => {
    const h = makeOpener({ capable: 5, sendOk: true, taggable: undefined })
    await h.opener.open({ nonce: 7, path: '/w/a.ts' })
    expect(h.sendOpenCommand).toHaveBeenCalledWith({ folder: '/w', path: '/w/a.ts', nonce: 7 })
  })

  it('degrades to the URL payload when the send fails', async () => {
    const h = makeOpener({ capable: 5, sendOk: false })
    await h.opener.open({ nonce: 7, path: '/w/a.ts', line: 9 })
    expect(h.pending).toHaveLength(1)
    const next = h.pending[0]!
    expect(next.basis).toBe('/sidebar/vscode#/w')
    expect(next.url).toContain('payload=')
    expect(next.url).toContain(encodeURIComponent('vscode-remote://dsh.local:3080/w/a.ts:9'))
  })

  it('degrades to the URL payload when the extension is absent', async () => {
    const h = makeOpener({ capable: false })
    await h.opener.open({ nonce: 7, path: '/w/a.ts' })
    expect(h.sendOpenCommand).not.toHaveBeenCalled()
    expect(h.pending).toHaveLength(1)
  })

  it('notices and skips a non-absolute path (both channels untouched)', async () => {
    const h = makeOpener({ capable: 5 })
    await h.opener.open({ nonce: 7, path: 'relative/x.ts' })
    expect(h.notices).toHaveLength(1)
    expect(h.notices[0]).toContain('relative/x.ts')
    expect(h.sendOpenCommand).not.toHaveBeenCalled()
    expect(h.pending).toEqual([])
  })

  it('clearPending reports the payload dropped', async () => {
    const h = makeOpener({ capable: false })
    await h.opener.open({ nonce: 7, path: '/w/a.ts' })
    expect(h.pending).toHaveLength(1)
    h.opener.clearPending()
    expect(h.pending[1]).toBeNull()
  })

  it('an unknown cwd skips the extension channel (no folder to address)', async () => {
    const h = makeOpener({ capable: 5, cwd: undefined })
    await h.opener.open({ nonce: 7, path: '/w/a.ts' })
    expect(h.probeCapability).not.toHaveBeenCalled()
    expect(h.pending).toHaveLength(1)
    expect(h.pending[0]!.basis).toBe('/sidebar/vscode#')
  })
})
