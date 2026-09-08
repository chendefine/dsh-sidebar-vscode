/**
 * Unit tests for the host-half extension command channel (spool slug spec,
 * payload validation, atomic command write, capability freshness).
 *
 * @module dsh-sidebar-vscode/tests/openChannel.spec
 */

import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CAPABILITY_MAX_AGE_MS,
  SpoolStore,
  slugOf,
  parseOpenCommand,
  readBootStatus,
  readBootLedger,
  readCapability,
  readCapabilityMarker,
  writeBootRequest,
  writeUserInteract,
  writeOpenCommand,
} from '../src/openChannel.ts'
import { CHANNEL_FILES } from '../src/shared/protocol.ts'

let base: string

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'dsh-open-channel-'))
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('slugOf (the cross-process spec)', () => {
  it('collapses unsafe characters and caps the readable part at 64', () => {
    expect(slugOf('/data/workspace')).toBe(slugOf('/data/workspace'))
    // The leading '/' collapses too — the readable part starts with '_'.
    expect(slugOf('/data/workspace').startsWith('_data_workspace-')).toBe(true)
    expect(slugOf('/data/workspace')).toMatch(/^_data_workspace-[0-9a-f]+$/)
    const long = `/${'x'.repeat(200)}`
    expect(slugOf(long).length).toBeLessThanOrEqual(64 + 1 + 8)
  })

  it('distinct folders sharing a collapsed form get distinct slugs', () => {
    expect(slugOf('/a_b')).not.toBe(slugOf('/a/b'))
    expect(slugOf('/a/b')).not.toBe(slugOf('/a.b'))
  })

  it('trims before digesting (a trailing space does not fork the slug)', () => {
    expect(slugOf('/data/workspace ')).toBe(slugOf('/data/workspace'))
  })

  it('produces filesystem-safe output (no separators, no dots-only parts)', () => {
    for (const folder of ['/', '../../etc', '/o pt/x', '/ünïcode']) {
      expect(slugOf(folder)).toMatch(/^[A-Za-z0-9_-]+-[0-9a-f]+$/)
    }
  })

  it('stays in lockstep with the extension\'s plain-JS mirror', async () => {
    // Extract the extension's slugOf source and evaluate it in isolation
    // (its module requires vscode, so it cannot be imported directly).
    // Since the extension decomposed into lib/, the mirror lives in
    // extension/lib/protocol.js — the shared-protocol plane's CJS twin.
    const source = await readFile(
      fileURLToPath(new URL('../extension/lib/protocol.js', import.meta.url)),
      'utf8',
    )
    const match = source.match(/slugOf: function \(folder\) \{[\s\S]*?\n  \}/)
    expect(match).not.toBeNull()
    const extensionSlugOf = new Function(`return (${match![0].replace(/^slugOf: /, '')})`)() as (folder: string) => string
    for (const folder of [
      '/data/workspace',
      '/opt',
      '/a/b',
      '/a_b',
      `/${'x'.repeat(300)}`,
      '/ünïcode/päth',
      '  /trimmed  ',
    ]) {
      expect(extensionSlugOf(folder)).toBe(slugOf(folder))
    }
  })
})

describe('parseOpenCommand', () => {
  it('accepts a well-formed command and floors optional line/column', () => {
    expect(parseOpenCommand({ folder: '/w', path: '/w/a.ts', nonce: 5, line: 3.9, column: 2.1 }))
      .toEqual({ folder: '/w', path: '/w/a.ts', nonce: 5, line: 3, column: 2 })
  })

  it('carries the boot tag through and caps it at 128 chars', () => {
    expect(parseOpenCommand({ folder: '/w', path: '/w/a.ts', nonce: 5, boot: 'boot-A' }))
      .toEqual({ folder: '/w', path: '/w/a.ts', nonce: 5, boot: 'boot-A' })
    // A non-string or empty boot is dropped (untagged command), and an
    // oversized one is truncated to the extension's readBootNonce cap.
    expect(parseOpenCommand({ folder: '/w', path: '/w/a.ts', nonce: 5, boot: 7 }))
      .toEqual({ folder: '/w', path: '/w/a.ts', nonce: 5 })
    expect(parseOpenCommand({ folder: '/w', path: '/w/a.ts', nonce: 5, boot: '' }))
      .toEqual({ folder: '/w', path: '/w/a.ts', nonce: 5 })
    const long = 'x'.repeat(300)
    expect(parseOpenCommand({ folder: '/w', path: '/w/a.ts', nonce: 5, boot: long })?.boot)
      .toBe(long.slice(0, 128))
  })

  it('rejects non-absolute folders/paths, bad nonces, and foreign shapes', () => {
    expect(parseOpenCommand(null)).toBeNull()
    expect(parseOpenCommand('x')).toBeNull()
    expect(parseOpenCommand([1])).toBeNull()
    expect(parseOpenCommand({ folder: 'w', path: '/w/a.ts', nonce: 1 })).toBeNull()
    expect(parseOpenCommand({ folder: '/w', path: 'a.ts', nonce: 1 })).toBeNull()
    expect(parseOpenCommand({ folder: '/w', path: '/w/a.ts', nonce: '1' })).toBeNull()
    expect(parseOpenCommand({ folder: '/w', path: '/w/a.ts', nonce: Number.NaN })).toBeNull()
  })
})

describe('writeOpenCommand / readCapability', () => {
  it('writes cmd.json into the folder slug dir and reads it back', async () => {
    await writeOpenCommand(base, { folder: '/data/workspace', path: '/data/workspace/a.ts', nonce: 42 })
    const file = join(base, slugOf('/data/workspace'), 'cmd.json')
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      folder: string, path: string, nonce: number, ts: number
    }
    expect(parsed.folder).toBe('/data/workspace')
    expect(parsed.path).toBe('/data/workspace/a.ts')
    expect(parsed.nonce).toBe(42)
    expect(typeof parsed.ts).toBe('number')
    // No temp siblings survive the atomic rename.
    const info = await stat(join(base, slugOf('/data/workspace')))
    expect(info.isDirectory()).toBe(true)
  })

  it('re-writing overwrites the previous command (last wins, one file)', async () => {
    await writeOpenCommand(base, { folder: '/data/workspace', path: '/data/workspace/a.ts', nonce: 1 })
    await writeOpenCommand(base, { folder: '/data/workspace', path: '/data/workspace/b.ts', nonce: 2 })
    const parsed = JSON.parse(
      await readFile(join(base, slugOf('/data/workspace'), 'cmd.json'), 'utf8'),
    ) as { nonce: number, path: string }
    expect(parsed.nonce).toBe(2)
    expect(parsed.path).toBe('/data/workspace/b.ts')
  })

  it('capability is false without a marker and true while a v2 marker is fresh', async () => {
    const folder = '/no-marker'
    expect(await readCapability(base, folder)).toBe(false)
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'cap.json'), JSON.stringify({ v: 2, at: Date.now() }), 'utf8')
    expect(await readCapability(base, folder)).toBe(true)
  })

  it('capability refuses the pre-0.1.2 bare-timestamp marker even while fresh', async () => {
    // The v0.1.1 extension wrote String(Date.now()) and REPLAYED the last
    // command on every extension-host restart — the exact "closed file
    // reopens on next VS Code start" bug. Its marker must never count as
    // capable, so the client degrades to the URL-payload channel.
    const folder = '/old-marker'
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'cap.json'), String(Date.now()), 'utf8')
    expect(await readCapability(base, folder)).toBe(false)
    // Nor a versioned marker below the trusted floor, nor garbage.
    await writeFile(join(dir, 'cap.json'), JSON.stringify({ v: 1, at: Date.now() }), 'utf8')
    expect(await readCapability(base, folder)).toBe(false)
    await writeFile(join(dir, 'cap.json'), 'not json', 'utf8')
    expect(await readCapability(base, folder)).toBe(false)
    await writeFile(join(dir, 'cap.json'), JSON.stringify({ at: Date.now() }), 'utf8')
    expect(await readCapability(base, folder)).toBe(false)
    // A future build version stays trusted.
    await writeFile(join(dir, 'cap.json'), JSON.stringify({ v: 3, at: Date.now() }), 'utf8')
    expect(await readCapability(base, folder)).toBe(true)
  })

  it('capability goes stale past the age window', async () => {
    const folder = '/stale-marker'
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    const capFile = join(dir, 'cap.json')
    await writeFile(capFile, JSON.stringify({ v: 2, at: 0 }), 'utf8')
    // mtime is what counts: push it far into the past.
    const ancient = new Date(Date.now() - CAPABILITY_MAX_AGE_MS - 60_000)
    await utimes(capFile, ancient, ancient)
    expect(await readCapability(base, folder)).toBe(false)
    // A custom window (the route uses the default) is honored too.
    expect(await readCapability(base, folder, CAPABILITY_MAX_AGE_MS + 120_000)).toBe(true)
  })

  it('readCapabilityMarker exposes the build version (the boot-tag gate)', async () => {
    const folder = '/versioned-marker'
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    const capFile = join(dir, 'cap.json')
    // Absent → not present, no version.
    expect(await readCapabilityMarker(base, folder)).toEqual({ present: false, version: null })
    // The boot-tag-aware build (v4) reports its version; the client tags
    // open commands with the workbench's boot nonce only from 4 up.
    await writeFile(capFile, JSON.stringify({ v: 4, at: Date.now() }), 'utf8')
    expect(await readCapabilityMarker(base, folder)).toEqual({ present: true, version: 4 })
    // Older trusted builds report their own version (no tagging there).
    await writeFile(capFile, JSON.stringify({ v: 3, at: Date.now() }), 'utf8')
    expect(await readCapabilityMarker(base, folder)).toEqual({ present: true, version: 3 })
    // Stale/untrusted markers stay not-present with no version.
    const ancient = new Date(Date.now() - CAPABILITY_MAX_AGE_MS - 60_000)
    await utimes(capFile, ancient, ancient)
    expect(await readCapabilityMarker(base, folder)).toEqual({ present: false, version: null })
  })
})

describe('writeBootRequest / readBootStatus (the boot-reveal handshake)', () => {
  it('parks the nonce in bootreq.json inside the folder slug dir', async () => {
    await writeBootRequest(base, '/data/workspace', 'boot-42')
    const raw = JSON.parse(
      await readFile(join(base, slugOf('/data/workspace'), 'bootreq.json'), 'utf8'),
    ) as { nonce?: unknown }
    expect(raw.nonce).toBe('boot-42')
    // No temp siblings survive the atomic rename.
    expect(await readBootStatus(base, '/data/workspace', 'boot-42')).toBe(false)
  })

  it('matched only when boot.json echoes exactly this nonce', async () => {
    const folder = '/boot-echo'
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    // Nothing yet → not matched.
    expect(await readBootStatus(base, folder, 'n1')).toBe(false)
    // A receipt for a DIFFERENT boot (the previous iframe load) → no.
    await writeFile(join(dir, 'boot.json'), JSON.stringify({ v: 1, ts: 1, nonce: 'other' }), 'utf8')
    expect(await readBootStatus(base, folder, 'n1')).toBe(false)
    // The extension's receipt echoing our nonce → matched.
    await writeFile(join(dir, 'boot.json'), JSON.stringify({ v: 1, ts: 2, nonce: 'n1' }), 'utf8')
    expect(await readBootStatus(base, folder, 'n1')).toBe(true)
  })

  it('writeUserInteract stamps {nonce, ts} for the boot (the deference signal)', async () => {
    const folder = '/boot-interact'
    await writeUserInteract(base, folder, 'boot-9')
    const raw = JSON.parse(
      await readFile(join(base, slugOf(folder), 'interact.json'), 'utf8'),
    ) as { nonce?: unknown, ts?: unknown }
    expect(raw.nonce).toBe('boot-9')
    expect(typeof raw.ts).toBe('number')
  })

  it('a corrupt boot.json never counts as matched', async () => {
    const folder = '/boot-corrupt'
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'boot.json'), 'not json', 'utf8')
    expect(await readBootStatus(base, folder, 'n1')).toBe(false)
  })

  it('readBootLedger answers the editors array of a well-formed ledger', async () => {
    const folder = '/boot-ledger'
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    // Absent → null (a first-ever boot has no ledger).
    expect(await readBootLedger(base, folder)).toBeNull()
    // The extension's shape (v:1, editors of absolute paths, active) → the set.
    await writeFile(join(dir, CHANNEL_FILES.editors), JSON.stringify({
      v: 1, ts: 5, editors: ['/w/a.ts', '/w/sub/b.ts'], active: '/w/a.ts',
    }), 'utf8')
    expect(await readBootLedger(base, folder)).toEqual(['/w/a.ts', '/w/sub/b.ts'])
    // The empty ledger the "everything closed" boot parks → [] (not null):
    // the reconcile's keep-set is empty, so ANY open tab is a ghost.
    await writeFile(join(dir, CHANNEL_FILES.editors), JSON.stringify({ v: 1, ts: 6, editors: [], active: null }), 'utf8')
    expect(await readBootLedger(base, folder)).toEqual([])
    // Wrong version, non-array, or relative entries never gate → null.
    for (const bad of [
      { v: 2, editors: ['/a.ts'] },
      { v: 1, editors: 'nope' },
      { v: 1, editors: ['/ok.ts', 'relative.ts'] },
      'not json at all',
    ]) {
      await writeFile(join(dir, CHANNEL_FILES.editors), typeof bad === 'string' ? bad : JSON.stringify(bad), 'utf8')
      expect(await readBootLedger(base, folder)).toBeNull()
    }
  })
})

describe('SpoolStore (the one atomic-write / fail-soft-read home)', () => {
  it('writes readable JSON atomically and leaves no tmp files behind', async () => {
    const store = new SpoolStore(base)
    await store.write('/spool', CHANNEL_FILES.cmd, { a: 1 })
    const dir = join(base, slugOf('/spool'))
    const files = await readdir(dir)
    expect(files).toEqual(['cmd.json'])
    expect(await store.readJson('/spool', 'cmd.json')).toEqual({ a: 1 })
  })

  it('reads null for a missing or corrupt file, stats null for a missing file', async () => {
    const store = new SpoolStore(base)
    expect(await store.readJson('/spool-missing', 'cmd.json')).toBeNull()
    expect(await store.statFile('/spool-missing', 'cmd.json')).toBeNull()
    const dir = join(base, slugOf('/spool-corrupt'))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'cmd.json'), 'not json', 'utf8')
    expect(await store.readJson('/spool-corrupt', 'cmd.json')).toBeNull()
    expect((await store.statFile('/spool-corrupt', 'cmd.json'))).toBeInstanceOf(Object)
  })
})
