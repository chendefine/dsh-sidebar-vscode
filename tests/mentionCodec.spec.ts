/**
 * Unit tests for the shared vscode-selection mention codec: canonical URI
 * round-trips, label escaping, strict parsing (Markdown mentions and bare
 * URIs), payload validation, snapshot truncation, and hash normalization.
 *
 * @module dsh-sidebar-vscode/tests/mentionCodec.spec
 */

import { describe, expect, it } from 'vitest'
import {
  VSCODE_MENTION_SCHEME,
  VSCODE_RESOURCE_SCHEME,
  decodeBase64Url,
  decodeVscodeRefUri,
  decodeVscodeResourceUri,
  encodeBase64Url,
  encodeVscodeRefUri,
  encodeVscodeResourceUri,
  formatVscodeMention,
  formatVscodeResourceMention,
  isVscodeRefPayload,
  isVscodeResourcePayload,
  normalizeForHash,
  parseVscodeMentions,
  rangeLabel,
  referenceLabel,
  resourceLabel,
  scanRecoveredMentions,
  truncateSnapshot,
  type VscodeRefPayload,
  type VscodeResourcePayload,
} from '../src/mentionCodec.ts'

function payload (overrides: Partial<VscodeRefPayload> = {}): VscodeRefPayload {
  return {
    v: 1,
    path: 'example.json',
    start: 10,
    end: 12,
    text: '{\n  "example_key": "example_value"\n}',
    hash: 'a1b2c3d4e5f60718',
    ...overrides,
  }
}

function resource (overrides: Partial<VscodeResourcePayload> = {}): VscodeResourcePayload {
  return { v: 1, path: 'src/main.ts', type: 'file', ...overrides }
}

describe('base64url', () => {
  it('round-trips UTF-8 with multi-byte characters', () => {
    const text = 'const 汉字 = "🚀"; \n\ttab'
    expect(decodeBase64Url(encodeBase64Url(text))).toBe(text)
  })
})

describe('canonical URI codec', () => {
  it('round-trips a payload and stays canonical', () => {
    const uri = encodeVscodeRefUri(payload())
    expect(uri.startsWith(VSCODE_MENTION_SCHEME)).toBe(true)
    expect(decodeVscodeRefUri(uri)).toEqual(payload())
    expect(encodeVscodeRefUri(decodeVscodeRefUri(uri))).toBe(uri)
  })

  it('omits the optional flags when unset and preserves them when set', () => {
    const plain = encodeVscodeRefUri(payload())
    const flagged = encodeVscodeRefUri(payload({ truncated: false, dirty: false }))
    expect(flagged).toBe(plain)
    expect(encodeVscodeRefUri(payload({ truncated: true, dirty: true }))).not.toBe(plain)
    expect(decodeVscodeRefUri(encodeVscodeRefUri(payload({ truncated: true, dirty: true })))
      .truncated).toBe(true)
  })

  it('keeps an empty hash (unknown) representable', () => {
    const uri = encodeVscodeRefUri(payload({ hash: '' }))
    expect(decodeVscodeRefUri(uri).hash).toBe('')
  })

  it('rejects malformed payloads', () => {
    expect(isVscodeRefPayload({ v: 2, path: 'x', start: 1, end: 1, text: '', hash: '' })).toBe(false)
    expect(isVscodeRefPayload({ v: 1, path: '', start: 1, end: 1, text: '', hash: '' })).toBe(false)
    expect(isVscodeRefPayload({ v: 1, path: 'x', start: 0, end: 1, text: '', hash: '' })).toBe(false)
    expect(isVscodeRefPayload({ v: 1, path: 'x', start: 2, end: 1, text: '', hash: '' })).toBe(false)
    expect(isVscodeRefPayload({ v: 1, path: 'x', start: 1, end: 1, text: 't', hash: 'ZZZ' })).toBe(false)
    expect(() => decodeVscodeRefUri(`${VSCODE_MENTION_SCHEME}not-base64!`)).toThrow()
  })

  it('rejects a non-canonical reserialization of the same data', () => {
    // Valid base64url of a valid payload, but with the JSON keys reordered.
    const reordered = JSON.stringify({ path: 'example.json', v: 1, start: 10, end: 12, text: 'x', hash: '' })
    expect(() => decodeVscodeRefUri(`${VSCODE_MENTION_SCHEME}${encodeBase64Url(reordered)}`)).toThrow()
  })
})

describe('resource URI codec', () => {
  it('round-trips a resource payload and stays canonical', () => {
    const uri = encodeVscodeResourceUri(resource())
    expect(uri.startsWith(VSCODE_RESOURCE_SCHEME)).toBe(true)
    expect(decodeVscodeResourceUri(uri)).toEqual(resource())
    expect(encodeVscodeResourceUri(decodeVscodeResourceUri(uri))).toBe(uri)
  })

  it('round-trips the folder kind and absolute paths', () => {
    const folder = resource({ path: '/data/workspace/pkg/src', type: 'folder' })
    expect(decodeVscodeResourceUri(encodeVscodeResourceUri(folder))).toEqual(folder)
  })

  it('rejects malformed resource payloads', () => {
    expect(isVscodeResourcePayload({ v: 2, path: 'x', type: 'file' })).toBe(false)
    expect(isVscodeResourcePayload({ v: 1, path: '', type: 'file' })).toBe(false)
    expect(isVscodeResourcePayload({ v: 1, path: 'x', type: 'symlink' })).toBe(false)
    expect(isVscodeResourcePayload({ v: 1, path: 'x' })).toBe(false)
    expect(() => decodeVscodeResourceUri(`${VSCODE_RESOURCE_SCHEME}not-base64!`)).toThrow()
  })

  it('rejects a non-canonical reserialization of the same data', () => {
    const reordered = JSON.stringify({ type: 'file', path: 'src/main.ts', v: 1 })
    expect(() => decodeVscodeResourceUri(`${VSCODE_RESOURCE_SCHEME}${encodeBase64Url(reordered)}`)).toThrow()
  })
})

describe('mention formatting and parsing', () => {
  it('formats and parses a markdown mention, replacing it with the @-prefixed label', () => {
    const mention = formatVscodeMention(payload())
    const { text, references } = parseVscodeMentions(`review ${mention} please`)
    expect(text).toBe('review @example.json L10-L12 please')
    expect(references).toEqual([payload()])
  })

  it('escapes labels containing ] and backslashes', () => {
    const tricky = payload({ path: 'we]ird\\path.ts' })
    const mention = formatVscodeMention(tricky)
    const { text, references } = parseVscodeMentions(mention)
    expect(text).toBe('@we]ird\\path.ts L10-L12')
    expect(references).toEqual([tricky])
  })

  it('recognizes bare canonical URIs as references', () => {
    const uri = encodeVscodeRefUri(payload())
    const { text, references } = parseVscodeMentions(`see ${uri} ok`)
    expect(text).toBe('see @example.json L10-L12 ok')
    expect(references).toEqual([payload()])
  })

  it('parses resource mentions (markdown and bare) rewriting to the bare path', () => {
    const mention = formatVscodeResourceMention(resource())
    expect(parseVscodeMentions(`look at ${mention} now`)).toEqual({
      text: 'look at @src/main.ts now',
      references: [resource()],
    })
    const bare = encodeVscodeResourceUri(resource({ type: 'folder' }))
    const parsed = parseVscodeMentions(`see ${bare} ok`)
    expect(parsed.text).toBe('see @src/main.ts ok')
    expect(parsed.references).toEqual([resource({ type: 'folder' })])
  })

  it('parses selections and resources mixed in one text, in order', () => {
    const sel = formatVscodeMention(payload())
    const fileRef = formatVscodeResourceMention(resource())
    const folderRef = formatVscodeResourceMention(resource({ path: 'src', type: 'folder' }))
    const { text, references } = parseVscodeMentions(`${sel} ${folderRef} ${fileRef}`)
    expect(text).toBe('@example.json L10-L12 @src @src/main.ts')
    expect(references).toEqual([payload(), resource({ path: 'src', type: 'folder' }), resource()])
  })

  it('fails on a malformed explicit resource mention', () => {
    expect(() => parseVscodeMentions('@[label](dsh-vscode-res:%%%)')).toThrow()
  })

  it('fails on a bare base64url-shaped but non-canonical resource URI', () => {
    const junk = encodeBase64Url('{"v":1,"nope":true}')
    expect(() => parseVscodeMentions(`x dsh-vscode-res:${junk} y`)).toThrow()
  })

  it('does not confuse the two scheme prefixes', () => {
    // A selection URI does not parse as a resource URI and vice versa.
    const sel = encodeVscodeRefUri(payload())
    const res = encodeVscodeResourceUri(resource())
    expect(() => decodeVscodeResourceUri(sel)).toThrow()
    expect(() => decodeVscodeRefUri(res)).toThrow()
    // Neither scheme's bare form matches the other's text.
    const only = parseVscodeMentions(`a ${res} b`)
    expect(only.references).toEqual([resource()])
  })

  it('preserves duplicates and first-appearance order', () => {
    const a = payload()
    const b = payload({ path: 'other.ts', start: 1, end: 2 })
    const { references } = parseVscodeMentions(
      `${formatVscodeMention(a)} ${formatVscodeMention(b)} ${formatVscodeMention(a)}`,
    )
    expect(references).toEqual([a, b, a])
  })

  it('fails on a malformed explicit markdown mention', () => {
    expect(() => parseVscodeMentions('@[label](dsh-vscode:%%%)')).toThrow()
  })

  it('fails on a bare base64url-shaped but non-canonical URI', () => {
    const junk = encodeBase64Url('{"v":1,"nope":true}')
    expect(() => parseVscodeMentions(`x dsh-vscode:${junk} y`)).toThrow()
  })

  it('leaves ordinary text untouched', () => {
    const { text, references } = parseVscodeMentions('email me at a@b.com and dsh-session:x stays')
    expect(text).toBe('email me at a@b.com and dsh-session:x stays')
    expect(references).toEqual([])
  })

  it('recovers a whitespace-mangled mention copy and rewrites it readable', () => {
    // The exact shape a rendered chip yields on copy: sigils drifted apart.
    const mangled = `@ [ README.md L1 ]( dsh-vscode: ${encodeVscodeRefUri(payload()).slice('dsh-vscode:'.length)} )`
    const { text, references } = parseVscodeMentions(`look at ${mangled} please`)
    expect(text).toBe('look at @example.json L10-L12 please')
    expect(references).toEqual([payload()])
  })

  it('recovers a padded bare URI and ignores an invalid one beside it', () => {
    const encoded = encodeVscodeRefUri(payload()).slice('dsh-vscode:'.length)
    const junk = encodeBase64Url('{"v":1,"nope":true}')
    const source = `a dsh-vscode: ${encoded} b dsh-vscode: ${junk} c`
    const { text, references } = parseVscodeMentions(source)
    expect(text).toBe(`a @example.json L10-L12 b dsh-vscode: ${junk} c`)
    expect(references).toEqual([payload()])
  })

  it('never throws on loose-only shapes that fail canonical validation', () => {
    // Regression guard: recovery is fail-soft, and the strict scan never
    // matched these (the space after the colon breaks its bare alternative).
    const junk = encodeBase64Url('{"v":1,"nope":true}')
    expect(() => parseVscodeMentions(`@ [ x ]( dsh-vscode: ${junk} )`)).not.toThrow()
    expect(() => parseVscodeMentions(`@ [x]( dsh-vscode: ${junk} )`)).not.toThrow()
    const kept = parseVscodeMentions(`@ [ x ]( dsh-vscode: ${junk} )`)
    expect(kept.references).toEqual([])
    expect(kept.text).toBe(`@ [ x ]( dsh-vscode: ${junk} )`)
  })

  it('keeps the strict throw for malformed explicit canonical mentions', () => {
    expect(() => parseVscodeMentions('@[label](dsh-vscode:%%%)')).toThrow()
    expect(() => parseVscodeMentions(`x dsh-vscode:${encodeBase64Url('{"v":1,"nope":true}')} y`)).toThrow()
  })
})

describe('scanRecoveredMentions', () => {
  it('recovers the canonical mention text itself (a copy-button copy)', () => {
    const found = scanRecoveredMentions(formatVscodeMention(payload()))
    expect(found).toHaveLength(1)
    expect(found[0]!.payload).toEqual(payload())
    expect(found[0]!.mention).toBe(formatVscodeMention(payload()))
    expect(found[0]!.label).toBe('example.json L10-L12')
    expect(found[0]!.start).toBe(0)
    expect(found[0]!.end).toBe(formatVscodeMention(payload()).length)
  })

  it('recovers whitespace-mangled copies, both schemes, and re-derives the label', () => {
    const selTail = encodeVscodeRefUri(payload()).slice('dsh-vscode:'.length)
    const resTail = encodeVscodeResourceUri(resource()).slice('dsh-vscode-res:'.length)
    const text = `@ [ README.md L1 ]( dsh-vscode: ${selTail} ) and @ [ src ]( dsh-vscode-res: ${resTail} )`
    const found = scanRecoveredMentions(text)
    expect(found.map(entry => entry.payload)).toEqual([payload(), resource()])
    // The copied labels (README.md L1 / src) are decoration; the payload wins.
    expect(found.map(entry => entry.label)).toEqual(['example.json L10-L12', 'src/main.ts'])
    expect(found[1]!.mention).toBe(formatVscodeResourceMention(resource()))
  })

  it('recovers a bare padded URI, including inside a wrapper that lost its closer', () => {
    const tail = encodeVscodeRefUri(payload()).slice('dsh-vscode:'.length)
    const truncatedCopy = `@ [ x ]( dsh-vscode: ${tail}`
    const found = scanRecoveredMentions(truncatedCopy)
    expect(found).toHaveLength(1)
    expect(found[0]!.payload).toEqual(payload())
    expect(found[0]!.end).toBe(truncatedCopy.length)
  })

  it('claims a bare URI nested inside a markdown-shaped match for the wrapper', () => {
    const tail = encodeVscodeRefUri(payload()).slice('dsh-vscode:'.length)
    // The md shape matches and decodes: exactly one recovery, spanning the whole shape.
    const found = scanRecoveredMentions(`@ [ x ]( dsh-vscode: ${tail} )`)
    expect(found).toHaveLength(1)
    expect(found[0]!.start).toBe(0)
  })

  it('skips candidates that do not decode canonically, silently', () => {
    const junk = encodeBase64Url('{"v":1,"nope":true}')
    expect(scanRecoveredMentions(`@ [ x ]( dsh-vscode: ${junk} )`)).toEqual([])
    expect(scanRecoveredMentions(`dsh-vscode: ${junk}`)).toEqual([])
    expect(scanRecoveredMentions('nothing to see here')).toEqual([])
  })

  it('returns multiple mentions in text order with exact ranges', () => {
    const a = payload()
    const b = resource()
    const ma = formatVscodeMention(a)
    const mb = formatVscodeResourceMention(b)
    const text = `pre ${ma} mid ${mb} post`
    const found = scanRecoveredMentions(text)
    expect(found.map(entry => entry.payload)).toEqual([a, b])
    expect(text.slice(found[0]!.start, found[0]!.end)).toBe(ma)
    expect(text.slice(found[1]!.start, found[1]!.end)).toBe(mb)
  })
})

describe('labels', () => {
  it('renders single-line and multi-line ranges', () => {
    expect(rangeLabel(7, 7)).toBe('L7')
    expect(rangeLabel(10, 12)).toBe('L10-L12')
    expect(referenceLabel(payload())).toBe('example.json L10-L12')
  })

  it('renders the bare path for resources (no line suffix)', () => {
    expect(resourceLabel(resource())).toBe('src/main.ts')
  })
})

describe('snapshot normalization and truncation', () => {
  it('normalizes line endings and trailing newlines for hashing', () => {
    expect(normalizeForHash('a\r\nb\n\n')).toBe('a\nb')
    expect(normalizeForHash('a\rb')).toBe('a\nb')
  })

  it('keeps snapshots under both limits untouched', () => {
    const text = 'one\ntwo\nthree'
    expect(truncateSnapshot(`${text}\n`, { maxLines: 10, maxBytes: 1000 })).toEqual({
      text,
      truncated: false,
    })
  })

  it('omits the middle by line count, keeping head and tail halves', () => {
    const result = truncateSnapshot('1\n2\n3\n4\n5', { maxLines: 3, maxBytes: 1000 })
    expect(result).toEqual({ text: '1\n2\n5', truncated: true, headLen: 3, omitLines: 2, omitBytes: 0 })
  })

  it('keeps one whole line when the cap is a single line', () => {
    const result = truncateSnapshot('a\nb\nc', { maxLines: 1, maxBytes: 1000 })
    expect(result).toEqual({ text: 'a', truncated: true, headLen: 1, omitLines: 2, omitBytes: 0 })
  })

  it('omits the middle by UTF-8 bytes without splitting a multi-byte character', () => {
    // 汉字x汉字 = 13 bytes; a 7-byte budget keeps 汉 (3B) + 字 (3B) and omits 7 bytes.
    const result = truncateSnapshot('汉字x汉字', { maxLines: 10, maxBytes: 7 })
    expect(result).toEqual({ text: '汉\n字', truncated: true, headLen: 1, omitLines: 0, omitBytes: 7 })
  })

  it('carves the tail half out of a single over-budget line', () => {
    // One 300-byte line under a 100-byte cap: 50 bytes kept at each end.
    const result = truncateSnapshot('a'.repeat(300), { maxLines: 10, maxBytes: 100 })
    expect(result).toEqual({ text: `${'a'.repeat(50)}\n${'a'.repeat(50)}`, truncated: true, headLen: 50, omitLines: 0, omitBytes: 200 })
  })

  it('extends the omitted gap at both seams when both limits hit', () => {
    // Ten 100-char ASCII lines; the 4-line cap keeps 2+2 lines (402 bytes),
    // then a 300-byte budget shrinks each kept half to 150 bytes (102 more).
    const line = (n: number): string => String(n).padStart(100, 'x')
    const text = Array.from({ length: 10 }, (_, i) => line(i + 1)).join('\n')
    const result = truncateSnapshot(text, { maxLines: 4, maxBytes: 300 })
    expect(result.truncated).toBe(true)
    expect(result.omitLines).toBe(6)
    expect(result.omitBytes).toBe(102)
    expect(result.headLen).toBe(150)
    expect(result.text.slice(0, 100)).toBe(line(1))
    expect(result.text.slice(-100)).toBe(line(10))
    expect(new TextEncoder().encode(result.text).length).toBe(301)
  })

  it('round-trips the truncation counters through the canonical URI', () => {
    const flagged = payload({
      truncated: true,
      headLen: 12,
      omitLines: 40,
      omitBytes: 0,
    })
    const decoded = decodeVscodeRefUri(encodeVscodeRefUri(flagged))
    expect(decoded).toEqual(flagged)
    expect(decoded.headLen).toBe(12)
    expect(decoded.omitLines).toBe(40)
  })
})
