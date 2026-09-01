/**
 * Unit tests for the open-blocklist contract: the stored shape and its
 * unset-means-default / empty-means-empty discipline, the extension
 * normalization rules, and the base-name suffix matching the takeover
 * gates consult per call.
 *
 * @module dsh-sidebar-vscode/tests/openBlocklist.spec
 */

import { describe, expect, it } from 'vitest'
import {
  BLOCKLIST_SUGGESTIONS,
  DEFAULT_OPEN_BLOCKLIST,
  OPEN_BLOCKLIST_KEY,
  OPEN_BLOCKLIST_MAX_ENTRIES,
  blocklistSuggestions,
  isBlockedPath,
  normalizeExtension,
  parseOpenBlocklist,
  readOpenBlocklist,
} from '../src/client/openBlocklist.ts'

describe('constants', () => {
  it('declares the seven out-of-the-box extensions in display order', () => {
    expect(DEFAULT_OPEN_BLOCKLIST).toEqual(['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpeg', 'jpg'])
  })

  it('keys the store read under openBlocklist', () => {
    expect(OPEN_BLOCKLIST_KEY).toBe('openBlocklist')
  })

  it('includes every default among the suggestions, without duplicates', () => {
    for (const entry of DEFAULT_OPEN_BLOCKLIST) {
      expect(BLOCKLIST_SUGGESTIONS.includes(entry)).toBe(true)
    }
    expect(new Set(BLOCKLIST_SUGGESTIONS).size).toBe(BLOCKLIST_SUGGESTIONS.length)
  })
})

describe('normalizeExtension', () => {
  it('lowercases, trims, and drops leading dots', () => {
    expect(normalizeExtension('PDF')).toBe('pdf')
    expect(normalizeExtension('  Mp4 ')).toBe('mp4')
    expect(normalizeExtension('.zip')).toBe('zip')
    expect(normalizeExtension('..svg')).toBe('svg')
  })

  it('keeps multi-part extensions as one entry', () => {
    expect(normalizeExtension('tar.gz')).toBe('tar.gz')
    expect(normalizeExtension('.Tar.GZ')).toBe('tar.gz')
  })

  it('accepts letters, digits, and internal . and - only', () => {
    expect(normalizeExtension('7z')).toBe('7z')
    expect(normalizeExtension('tar-bz2')).toBe('tar-bz2')
    expect(normalizeExtension('a')).toBe('a')
  })

  it('rejects junk the row must refuse to add', () => {
    for (const junk of ['', '   ', '.', '..', 'a/b', 'a\\b', 'p df', 'pdf;', '*.pdf', 'pd,f', '-pdf', 'pdf-', '.']) {
      expect(normalizeExtension(junk)).toBeNull()
    }
  })

  it('rejects entries longer than 16 characters', () => {
    expect(normalizeExtension('a'.repeat(16))).toBe('a'.repeat(16))
    expect(normalizeExtension('a'.repeat(17))).toBeNull()
  })
})

describe('parseOpenBlocklist', () => {
  it('yields the code default for anything but an array', () => {
    for (const junk of [undefined, null, 'pdf', 'pdf,zip', 7, true, { 0: 'pdf' }]) {
      expect(parseOpenBlocklist(junk)).toEqual(DEFAULT_OPEN_BLOCKLIST)
    }
  })

  it('keeps an explicitly emptied list empty (a stored decision, not unset)', () => {
    expect(parseOpenBlocklist([])).toEqual([])
  })

  it('normalizes, filters junk, and dedupes array entries in first-seen order', () => {
    expect(parseOpenBlocklist(['PDF', '.zip', 'zip', 42, null, 'p df', 'gz'])).toEqual(['pdf', 'zip', 'gz'])
    expect(parseOpenBlocklist(['JPG', 'jpg'])).toEqual(['jpg'])
  })

  it('caps the stored list at the declared bound', () => {
    const many = Array.from({ length: OPEN_BLOCKLIST_MAX_ENTRIES + 10 }, (_, i) => `e${i}`)
    expect(parseOpenBlocklist(many)).toHaveLength(OPEN_BLOCKLIST_MAX_ENTRIES)
  })
})

describe('isBlockedPath', () => {
  const list = ['pdf', 'jpg', 'tar.gz']

  it('matches the base name case-insensitively through the declared dot', () => {
    expect(isBlockedPath('/w/report.pdf', list)).toBe(true)
    expect(isBlockedPath('/w/Photo.JPG', list)).toBe(true)
    expect(isBlockedPath('report.PDF', list)).toBe(true)
  })

  it('matches after both separators', () => {
    expect(isBlockedPath('D:\\w\\x.pdf', list)).toBe(true)
    expect(isBlockedPath('D:/w/x.pdf', list)).toBe(true)
  })

  it('matches multi-part extensions only through their own entry', () => {
    expect(isBlockedPath('/w/a.tar.gz', list)).toBe(true)
    expect(isBlockedPath('/w/a.TAR.GZ', list)).toBe(true)
    expect(isBlockedPath('/w/a.gz', ['tar.gz'])).toBe(false)
    expect(isBlockedPath('/w/a.tar', ['tar.gz'])).toBe(false)
  })

  it('never matches a near-miss name or an extension-less file', () => {
    expect(isBlockedPath('/w/a.notpdf', list)).toBe(false)
    expect(isBlockedPath('/w/pdf', list)).toBe(false)
    expect(isBlockedPath('/w/myjpgfile', list)).toBe(false)
    expect(isBlockedPath('/w/pdf.bak', list)).toBe(false)
  })

  it('never matches on an empty or degenerate entry or path', () => {
    expect(isBlockedPath('/w/a.pdf', [])).toBe(false)
    expect(isBlockedPath('/w/a.pdf', [''])).toBe(false)
    expect(isBlockedPath('', list)).toBe(false)
    expect(isBlockedPath('/', list)).toBe(false)
  })

  it('lets non-listed extensions through', () => {
    expect(isBlockedPath('/w/main.ts', list)).toBe(false)
    expect(isBlockedPath('/w/picture.webp', list)).toBe(false)
  })

  it('trims surrounding whitespace before matching', () => {
    expect(isBlockedPath('  /w/a.pdf  ', list)).toBe(true)
  })
})

describe('blocklistSuggestions', () => {
  it('offers every suggestion not already listed, in declared order', () => {
    const current = ['pdf', 'zip']
    expect(blocklistSuggestions(current)).toEqual(BLOCKLIST_SUGGESTIONS.filter(s => s !== 'pdf' && s !== 'zip'))
  })

  it('yields everything when nothing is listed', () => {
    expect(blocklistSuggestions([])).toEqual(BLOCKLIST_SUGGESTIONS)
  })
})

describe('readOpenBlocklist', () => {
  /** Minimal store face mirroring settings.ts's StoreLike. */
  function storeOf(value: unknown) {
    return {
      getSnapshot: () => ({ prefs: { pluginSettings: { 'dsh-sidebar-vscode:vscode': { openBlocklist: value } } } }),
    }
  }

  it('reads the stored array through the settings blob', () => {
    expect(readOpenBlocklist(storeOf(['zip']))).toEqual(['zip'])
  })

  it('falls back to the default for an unset key', () => {
    expect(readOpenBlocklist(storeOf(undefined))).toEqual(DEFAULT_OPEN_BLOCKLIST)
  })

  it('treats a missing store as unset (the code default)', () => {
    expect(readOpenBlocklist(undefined)).toEqual(DEFAULT_OPEN_BLOCKLIST)
  })
})
