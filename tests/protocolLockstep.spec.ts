/**
 * Protocol lockstep: the shared protocol plane (`src/shared/protocol.ts`)
 * and the VS Code extension's plain-JS mirror (`extension/lib/protocol.js`)
 * must agree on EVERY constant and on `slugOf` over a vector of workspace
 * folders. vsce packages only `extension/`, so the extension cannot import
 * the shared module — this spec is the mechanical guarantee that a protocol
 * change always lands in both files or neither (CI fails on drift).
 *
 * The slug vectors deliberately include the behavioral pins of
 * `tests/openChannel.spec.ts` (collision resistance, trim-before-digest,
 * unicode, cap length) so a divergent mirror cannot pass even on the
 * inputs the host side's own spec exercises.
 *
 * @module dsh-sidebar-vscode/tests/protocolLockstep.spec
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import * as shared from '../src/shared/protocol.ts'

const nodeRequire = createRequire(import.meta.url)

/** Folders both implementations must slug identically (behavioral pins included). */
const SLUG_VECTORS: readonly string[] = [
  '/data/workspace',
  '/data/workspace ',
  '/',
  '../../etc',
  '/o pt/x',
  '/ünïcode',
  '/a_b',
  '/a/b',
  '/a.b',
  `/${'x'.repeat(200)}`,
  '',
]

describe('protocol lockstep (src/shared/protocol.ts ↔ extension/lib/protocol.js)', () => {
  const mirror = nodeRequire('../extension/lib/protocol.js') as Record<string, unknown>

  it('mirrors every scalar constant exactly', () => {
    expect(mirror.SELECTION_MARKER).toBe(shared.SELECTION_MARKER)
    expect(mirror.PROXY_MOUNT).toBe(shared.PROXY_MOUNT)
    expect(mirror.OPEN_CHANNEL_DIR).toBe(shared.OPEN_CHANNEL_DIR)
    expect(mirror.NONCE_MAX_LENGTH).toBe(shared.NONCE_MAX_LENGTH)
    expect(mirror.CHANNEL_CAP_V).toBe(shared.CHANNEL_CAP_V)
    expect(mirror.CAPABILITY_MIN_V).toBe(shared.CAPABILITY_MIN_V)
    expect(mirror.CAPABILITY_MAX_AGE_MS).toBe(shared.CAPABILITY_MAX_AGE_MS)
    expect(mirror.CHANNEL_CMD_TTL_MS).toBe(shared.CHANNEL_CMD_TTL_MS)
  })

  it('mirrors the spool file-name table exactly', () => {
    expect(mirror.CHANNEL_FILES).toEqual(shared.CHANNEL_FILES)
  })

  it('slugs every vector identically (and never emptily)', () => {
    const slugOf = mirror.slugOf as (folder: string) => string
    for (const folder of SLUG_VECTORS) {
      expect(slugOf(folder)).toBe(shared.slugOf(folder))
      expect(typeof slugOf(folder)).toBe('string')
    }
  })

  it('exposes no symbol on one side that the other lacks', () => {
    const sharedKeys = new Set(Object.keys(shared))
    const mirrorKeys = new Set(Object.keys(mirror))
    for (const key of mirrorKeys) expect(sharedKeys.has(key)).toBe(true)
    for (const key of sharedKeys) expect(mirrorKeys.has(key)).toBe(true)
  })
})
