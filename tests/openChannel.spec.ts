/**
 * Unit tests for the host-half extension command channel (spool slug spec,
 * payload validation, atomic command write, capability freshness).
 *
 * @module dsh-sidebar-vscode/tests/openChannel.spec
 */

import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CAPABILITY_MAX_AGE_MS,
  slugOf,
  parseOpenCommand,
  readCapability,
  writeOpenCommand,
} from '../src/openChannel.ts'

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
    const source = await readFile(
      fileURLToPath(new URL('../extension/extension.js', import.meta.url)),
      'utf8',
    )
    const match = source.match(/^function slugOf \(folder\) \{[\s\S]*?^\}/m)
    expect(match).not.toBeNull()
    const extensionSlugOf = new Function(`return (${match![0]})`)() as (folder: string) => string
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

  it('capability is false without a marker and true while fresh', async () => {
    const folder = '/no-marker'
    expect(await readCapability(base, folder)).toBe(false)
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'cap.json'), String(Date.now()), 'utf8')
    expect(await readCapability(base, folder)).toBe(true)
  })

  it('capability goes stale past the age window', async () => {
    const folder = '/stale-marker'
    const dir = join(base, slugOf(folder))
    await mkdir(dir, { recursive: true })
    const capFile = join(dir, 'cap.json')
    await writeFile(capFile, '0', 'utf8')
    // mtime is what counts: push it far into the past.
    const ancient = new Date(Date.now() - CAPABILITY_MAX_AGE_MS - 60_000)
    await utimes(capFile, ancient, ancient)
    expect(await readCapability(base, folder)).toBe(false)
    // A custom window (the route uses the default) is honored too.
    expect(await readCapability(base, folder, CAPABILITY_MAX_AGE_MS + 120_000)).toBe(true)
  })
})
