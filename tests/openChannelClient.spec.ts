/**
 * Unit tests for the client half of the extension command channel (the two
 * fenced fetches the VSCode tab makes) plus the URL-payload builder it falls
 * back to.
 *
 * @module dsh-sidebar-vscode/tests/openChannelClient.spec
 */

import { describe, expect, it } from 'vitest'
import {
  OPEN_CHANNEL_API,
  fetchSettingsDocumentPath,
  probeCapability,
  resetCapabilityCache,
  sendOpenCommand,
  type FetchLike,
} from '../src/client/openChannelApi.ts'
import { buildVscodeUrl } from '../src/client/paths.ts'

/** A programmable fetch double recording calls. */
function makeFetch(answers: Array<{ status: number, body: unknown } | Error>): FetchLike & {
  calls: Array<{ url: string, body: unknown }>
} {
  const calls: Array<{ url: string, body: unknown }>[] = []
  const recorded: Array<{ url: string, body: unknown }> = []
  calls.push(recorded)
  const fetchLike = (url: string, init: { body: string }) => {
    recorded.push({ url, body: JSON.parse(init.body) })
    const answer = answers.shift()
    if (answer instanceof Error) return Promise.reject(answer)
    return Promise.resolve({
      ok: answer!.status >= 200 && answer!.status < 300,
      json: () => Promise.resolve(answer!.body),
    })
  }
  return Object.assign(fetchLike as unknown as FetchLike & { calls: Array<{ url: string, body: unknown }> }, { calls: recorded })
}

describe('probeCapability', () => {
  it('POSTs the folder and maps {ok, value:{present:true}} to true', async () => {
    resetCapabilityCache()
    const fetchLike = makeFetch([{ status: 200, body: { ok: true, value: { present: true } } }])
    await expect(probeCapability('/data/workspace', fetchLike)).resolves.toBe(true)
    expect(fetchLike.calls).toEqual([
      { url: `${OPEN_CHANNEL_API}/open.capability`, body: { folder: '/data/workspace' } },
    ])
  })

  it('a present:false answer, an error shape, and a rejection all map to false', async () => {
    for (const answer of [
      { status: 200, body: { ok: true, value: { present: false } } },
      { status: 200, body: { ok: false, error: { code: 'x' } } },
      { status: 500, body: { ok: false } },
      new Error('network down'),
    ]) {
      resetCapabilityCache()
      const fetchLike = makeFetch([answer])
      await expect(probeCapability('/w', fetchLike)).resolves.toBe(false)
    }
  })

  it('caches per folder within the TTL and re-probes after it', async () => {
    resetCapabilityCache()
    let clock = 1_000_000
    const now = () => clock
    const fetchLike = makeFetch([
      { status: 200, body: { ok: true, value: { present: true } } },
      { status: 200, body: { ok: true, value: { present: false } } },
    ])
    await expect(probeCapability('/w', fetchLike, now)).resolves.toBe(true)
    clock += 1000 // inside the TTL: cached, no second call
    await expect(probeCapability('/w', fetchLike, now)).resolves.toBe(true)
    expect(fetchLike.calls).toHaveLength(1)
    clock += 10_000 // past the TTL: re-probed (and cached anew)
    await expect(probeCapability('/w', fetchLike, now)).resolves.toBe(false)
    expect(fetchLike.calls).toHaveLength(2)
    // A different folder is probed independently.
    const other = makeFetch([{ status: 200, body: { ok: true, value: { present: true } } }])
    await expect(probeCapability('/other', other, now)).resolves.toBe(true)
    expect(other.calls).toHaveLength(1)
  })
})

describe('sendOpenCommand', () => {
  it('POSTs the command verbatim and maps a 200 {ok:true} to true', async () => {
    const fetchLike = makeFetch([{ status: 200, body: { ok: true } }])
    await expect(sendOpenCommand(
      { folder: '/data/workspace', path: '/data/workspace/a.ts', nonce: 9, line: 3, column: 4 },
      fetchLike,
    )).resolves.toBe(true)
    expect(fetchLike.calls).toEqual([
      {
        url: `${OPEN_CHANNEL_API}/open.request`,
        body: { folder: '/data/workspace', path: '/data/workspace/a.ts', nonce: 9, line: 3, column: 4 },
      },
    ])
  })

  it('failures map to false (fail-soft for the fallback channel)', async () => {
    for (const answer of [
      { status: 400, body: { ok: false } },
      { status: 500, body: null },
      new Error('abort'),
    ]) {
      const fetchLike = makeFetch([answer])
      await expect(sendOpenCommand(
        { folder: '/w', path: '/w/a.ts', nonce: 1 },
        fetchLike,
      )).resolves.toBe(false)
    }
  })
})

describe('fetchSettingsDocumentPath', () => {
  it('POSTs an empty body and maps {ok, value:{path}} to the path', async () => {
    const fetchLike = makeFetch([{ status: 200, body: { ok: true, value: { path: '/data/dsh-home/settings.yaml' } } }])
    await expect(fetchSettingsDocumentPath(fetchLike)).resolves.toBe('/data/dsh-home/settings.yaml')
    expect(fetchLike.calls).toEqual([
      { url: `${OPEN_CHANNEL_API}/settings.document`, body: {} },
    ])
  })

  it('failures and malformed answers map to null (fail-soft for the stock button)', async () => {
    for (const answer of [
      { status: 500, body: { ok: false, error: { code: 'settings-absent' } } },
      { status: 500, body: { ok: false, error: { code: 'no-document' } } },
      { status: 404, body: { ok: false, error: { code: 'not-found' } } },
      { status: 200, body: { ok: true, value: { path: 42 } } },
      { status: 200, body: { ok: true, value: { path: '' } } },
      { status: 200, body: { ok: true, value: {} } },
      { status: 200, body: null },
      new Error('network down'),
    ]) {
      const fetchLike = makeFetch([answer])
      await expect(fetchSettingsDocumentPath(fetchLike)).resolves.toBeNull()
    }
  })
})

describe('buildVscodeUrl payload (the degraded channel)', () => {
  it('without an open it keeps the plain folder form', () => {
    expect(buildVscodeUrl('/vscode', '/data/workspace')).toBe('/vscode/?folder=%2Fdata%2Fworkspace')
    expect(buildVscodeUrl('/vscode', null)).toBe('/vscode/')
  })

  it('encodes the payload as URL-encoded [key,value] pairs with the openFile URI', () => {
    const url = new URL(buildVscodeUrl('/vscode', '/data/workspace', {
      file: '/data/workspace/a.ts',
      authority: 'dsh.example:3080',
    }), 'http://dsh.internal')
    const payload = JSON.parse(url.searchParams.get('payload')!) as unknown[]
    expect(url.searchParams.get('folder')).toBe('/data/workspace')
    expect(payload).toEqual([
      ['gotoLineMode', 'true'],
      ['openFile', 'vscode-remote://dsh.example:3080/data/workspace/a.ts'],
    ])
  })

  it('a line and column ride as a trailing :line:column suffix', () => {
    const url = new URL(buildVscodeUrl('/vscode', null, {
      file: '/opt/x/app.py',
      authority: '127.0.0.1:3080',
      line: 10,
      column: 5,
    }), 'http://dsh.internal')
    const payload = JSON.parse(url.searchParams.get('payload')!) as [string, string][]
    expect(payload.find(([key]) => key === 'openFile')![1])
      .toBe('vscode-remote://127.0.0.1:3080/opt/x/app.py:10:5')
    expect(url.searchParams.has('folder')).toBe(false)
  })

  it('odd characters in the path survive the round trip', () => {
    const file = '/data/workspace/спец file (1).ts'
    const url = new URL(buildVscodeUrl('/vscode', '/data/workspace', {
      file,
      authority: 'h',
    }), 'http://dsh.internal')
    const payload = JSON.parse(url.searchParams.get('payload')!) as [string, string][]
    expect(payload.find(([key]) => key === 'openFile')![1]).toBe(`vscode-remote://h${file}`)
  })
})
