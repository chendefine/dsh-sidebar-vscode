/**
 * Unit tests for the capture-cap settings contract: the shared constants
 * (single source of truth for the settings panel, the store, and the
 * truncation pipeline) and the pure display / commit helpers the cap
 * fields use.
 *
 * The two behaviors the panel exists for are pinned here at the helper
 * level: an unset cap displays the code DEFAULT (never empty, never the
 * minimum), and a commit writes only a real in-range change (focus/blur
 * of an untouched field, empty, or unparsable input writes nothing).
 *
 * @module dsh-sidebar-vscode/tests/settings.spec
 */

import { describe, expect, it } from 'vitest'
import {
  CAP_SPECS,
  MAX_BYTES_DEFAULT,
  MAX_BYTES_MAX,
  MAX_BYTES_MIN,
  MAX_LINES_DEFAULT,
  MAX_LINES_MAX,
  MAX_LINES_MIN,
  clampCap,
  commitCap,
  displayCap,
} from '../src/client/settings.ts'

describe('cap constants', () => {
  it('declares exactly the two cap rows in popup order', () => {
    expect(CAP_SPECS.map(spec => spec.key)).toEqual(['maxLines', 'maxBytes'])
  })

  it('keeps every default inside its own bounds', () => {
    for (const spec of CAP_SPECS) {
      expect(spec.min).toBeLessThanOrEqual(spec.def)
      expect(spec.def).toBeLessThanOrEqual(spec.max)
    }
  })

  it('keeps the declared bounds matched to the code defaults', () => {
    expect([MAX_LINES_MIN, MAX_LINES_DEFAULT, MAX_LINES_MAX]).toEqual([1, 200, 2000])
    expect([MAX_BYTES_MIN, MAX_BYTES_DEFAULT, MAX_BYTES_MAX]).toEqual([1000, 20000, 200000])
  })
})

describe('clampCap', () => {
  it('rounds to the integer lattice inside the bounds', () => {
    expect(clampCap(150.6, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(151)
    expect(clampCap(150.4, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(150)
  })

  it('snaps out-of-range values to the nearest bound', () => {
    expect(clampCap(0, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(MAX_LINES_MIN)
    expect(clampCap(-50, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(MAX_LINES_MIN)
    expect(clampCap(99999, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(MAX_LINES_MAX)
    expect(clampCap(500, MAX_BYTES_MIN, MAX_BYTES_MAX)).toBe(MAX_BYTES_MIN)
    expect(clampCap(1e9, MAX_BYTES_MIN, MAX_BYTES_MAX)).toBe(MAX_BYTES_MAX)
  })

  it('keeps in-range integers unchanged', () => {
    expect(clampCap(200, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(200)
    expect(clampCap(20000, MAX_BYTES_MIN, MAX_BYTES_MAX)).toBe(20000)
  })
})

describe('displayCap', () => {
  it('shows the stored number, out-of-range store included', () => {
    expect(displayCap(42, MAX_LINES_DEFAULT)).toBe(42)
    expect(displayCap(99999, MAX_LINES_DEFAULT)).toBe(99999)
    expect(displayCap(12.5, MAX_LINES_DEFAULT)).toBe(12.5)
  })

  it('falls back to the code default when the key is unset', () => {
    expect(displayCap(undefined, MAX_LINES_DEFAULT)).toBe(MAX_LINES_DEFAULT)
    expect(displayCap(undefined, MAX_BYTES_DEFAULT)).toBe(MAX_BYTES_DEFAULT)
  })

  it('falls back to the code default for non-numeric junk', () => {
    for (const junk of [null, '', '200', Number.NaN, Number.POSITIVE_INFINITY, true]) {
      expect(displayCap(junk, MAX_LINES_DEFAULT)).toBe(MAX_LINES_DEFAULT)
    }
  })
})

describe('commitCap', () => {
  const effective = MAX_LINES_DEFAULT

  it('returns null for empty or whitespace input (no write, revert to shown)', () => {
    expect(commitCap('', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBeNull()
    expect(commitCap('   ', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBeNull()
  })

  it('returns null for unparsable input', () => {
    expect(commitCap('abc', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBeNull()
    expect(commitCap('12x', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBeNull()
  })

  it('returns null when the clamped edit equals the shown value (focus/blur writes nothing)', () => {
    expect(commitCap('200', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBeNull()
    expect(commitCap(String(effective), effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBeNull()
    // 200.4 rounds onto the unchanged effective value: still a no-op.
    expect(commitCap('200.4', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBeNull()
  })

  it('clamps out-of-range edits to the nearest bound (the saved value matches the field)', () => {
    expect(commitCap('0', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(MAX_LINES_MIN)
    expect(commitCap('-5', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(MAX_LINES_MIN)
    expect(commitCap('999999', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(MAX_LINES_MAX)
  })

  it('commits a real in-range change, rounded', () => {
    expect(commitCap('80', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(80)
    expect(commitCap('80.9', effective, MAX_LINES_MIN, MAX_LINES_MAX)).toBe(81)
  })
})
