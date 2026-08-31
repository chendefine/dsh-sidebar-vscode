/**
 * Unit tests for the client-side reference plumbing: payload → chip building
 * (path resolution, truncation, hashing, flags), service-based chip insertion
 * with retry and plain-text fallback — at an addressed caret/selection or the
 * historical draft tail — and the reference-rail projections (grouping and
 * range removal).
 *
 * @module dsh-sidebar-vscode/tests/references.spec
 */

import { describe, expect, it } from 'vitest'
import {
  buildRefsFromPayload,
  buildResourceRefsFromPayload,
  clipboardOfDetect,
  detectLengthOf,
  detectOfClipboard,
  groupRailTags,
  hashSnapshot,
  insertVscodeReferences,
  isLexicalInput,
  parseRecoveredPaste,
  pasteRecoveredMentions,
  refsFromRecoveredMentions,
  removeRefRanges,
  removeVscodeReferences,
  resolveWorkspacePath,
  VSCODE_SOURCE,
  type ConversationServiceFace,
  type InputStateLike,
  type OccurrenceLike,
  type ReferenceInsertLike,
  type SessionsServiceFace,
  type SessionInputFace,
  type TokenSpanLike,
} from '../src/client/references.ts'
import {
  encodeVscodeRefUri,
  formatVscodeMention,
  formatVscodeResourceMention,
  parseVscodeMentions,
  scanRecoveredMentions,
  type VscodeRefPayload,
  type VscodeResourcePayload,
} from '../src/mentionCodec.ts'
import { decodeVscodeResourceUri } from '../src/mentionCodec.ts'
import type { ResourceListPayload, SelectionPayload } from '../src/client/selection.ts'
import { parsePathMap } from '../src/client/paths.ts'

/** Parsed identity reverse rules (VS Code side → DSH side). */
const RULES = parsePathMap('/data/workspace=/data/workspace;/opt=/opt')

function payload (overrides: Partial<SelectionPayload> = {}): SelectionPayload {
  return {
    path: '/data/workspace/code/app/src/main.ts',
    relative: 'code/app/src/main.ts',
    language: 'typescript',
    spans: [{ startLine: 10, endLine: 12, text: 'const a = 1\r\nconst b = 2\r\nconst c = 3\r\n' }],
    ...overrides,
  }
}

function resourceList (overrides: Partial<ResourceListPayload> = {}): ResourceListPayload {
  return {
    kind: 'resource',
    resources: [
      { path: '/data/workspace/code/app/src', type: 'folder' },
      { path: '/data/workspace/code/app/src/main.ts', relative: 'code/app/src/main.ts', type: 'file' },
    ],
    ...overrides,
  }
}

/** Extract the decoded selection payload back out of a built chip's canonical mention. */
function chipPayload (ref: string): VscodeRefPayload {
  const { references } = parseVscodeMentions(ref)
  expect(references).toHaveLength(1)
  const only = references[0]!
  if (!('start' in only)) throw new Error('expected a selection payload in the chip ref')
  return only
}

/** Extract the decoded resource payload back out of a built resource chip's mention. */
function chipResourcePayload (ref: string): { path: string, type: 'file' | 'folder' } {
  const match = /\(dsh-vscode-res:([A-Za-z0-9_-]+)\)/u.exec(ref)
  if (match === null) throw new Error(`not a resource mention: ${ref}`)
  return decodeVscodeResourceUri(`dsh-vscode-res:${match[1]}`)
}

describe('resolveWorkspacePath', () => {
  it('reverse-maps the container path and relativizes under the cwd', () => {
    const item = payload()
    expect(resolveWorkspacePath(item.path, item.relative, RULES, '/data/workspace/code/app')).toBe('src/main.ts')
  })

  it('keeps the absolute DSH path when it sits outside the cwd', () => {
    const item = payload()
    expect(resolveWorkspacePath(item.path, item.relative, RULES, '/data/workspace/other')).toBe('/data/workspace/code/app/src/main.ts')
  })

  it('passes an unmatched absolute path through, beating the relative fallback', () => {
    expect(resolveWorkspacePath('/elsewhere/x.ts', 'code/app/src.ts', RULES, undefined)).toBe('/elsewhere/x.ts')
  })

  it('falls back to the workspace-relative path when no rules are configured at all', () => {
    expect(resolveWorkspacePath('/elsewhere/x.ts', 'code/app/src.ts', undefined, undefined)).toBe('code/app/src.ts')
  })

  it('falls back to the raw container path as a last resort', () => {
    expect(resolveWorkspacePath('/elsewhere/x.ts', undefined, undefined, undefined)).toBe('/elsewhere/x.ts')
  })
})

describe('buildRefsFromPayload', () => {
  it('builds one chip per span with label, canonical mention, and hash', async () => {
    const refs = await buildRefsFromPayload(payload(), {
      reverseRules: RULES,
      cwd: '/data/workspace/code/app',
    })
    expect(refs).toHaveLength(1)
    const [ref] = refs
    expect(ref!.source).toBe(VSCODE_SOURCE)
    expect(ref!.appearance).toBe('file')
    expect(ref!.clipboardText).toBe(ref!.ref)
    expect(ref!.label).toBe('src/main.ts L10-L12')
    const decoded = chipPayload(ref!.ref)
    expect(decoded.text).toBe('const a = 1\nconst b = 2\nconst c = 3')
    expect(decoded.lang).toBe('typescript')
    expect(decoded.hash).toBe(await hashSnapshot('const a = 1\nconst b = 2\nconst c = 3'))
    expect(decoded.truncated).toBeUndefined()
    expect(decoded.dirty).toBeUndefined()
  })

  it('marks truncation and dirty state', async () => {
    const long = `${'line\n'.repeat(10)}`
    const refs = await buildRefsFromPayload(payload({ dirty: true, spans: [{ startLine: 1, endLine: 1000, text: long }] }), {
      maxLines: 4,
      maxBytes: 100000,
    })
    const decoded = chipPayload(refs[0]!.ref)
    expect(decoded.truncated).toBe(true)
    expect(decoded.text.split('\n')).toHaveLength(4)
    expect(decoded.headLen).toBe(9)
    expect(decoded.omitLines).toBe(6)
    expect(decoded.omitBytes).toBe(0)
    expect(decoded.end).toBe(1000)
    expect(decoded.dirty).toBe(true)
  })

  it('defaults the caps when unset (200 lines)', async () => {
    const text201 = Array.from({ length: 201 }, (_, i) => `l${i}`).join('\n')
    const refs = await buildRefsFromPayload(payload({ spans: [{ startLine: 1, endLine: 201, text: text201 }] }), {})
    const decoded = chipPayload(refs[0]!.ref)
    expect(decoded.truncated).toBe(true)
    expect(decoded.omitLines).toBe(1)
    expect(decoded.text.split('\n')).toHaveLength(200)
  })

  it('clamps caps below the declared minimum up to it', async () => {
    // maxLines 0 → 1: three lines keep exactly one.
    const three = await buildRefsFromPayload(payload({ spans: [{ startLine: 1, endLine: 3, text: 'a\nb\nc' }] }), {
      maxLines: 0,
      maxBytes: 100000,
    })
    const lines = chipPayload(three[0]!.ref)
    expect(lines.truncated).toBe(true)
    expect(lines.text.split('\n')).toHaveLength(1)
    expect(lines.omitLines).toBe(2)

    // maxBytes 500 → 1000: 900 bytes fit under the clamped cap.
    const wide = await buildRefsFromPayload(payload({ spans: [{ startLine: 1, endLine: 1, text: 'x'.repeat(900) }] }), {
      maxLines: 10,
      maxBytes: 500,
    })
    expect(chipPayload(wide[0]!.ref).truncated).toBeUndefined()
  })

  it('clamps caps above the declared maximum down to it', async () => {
    // maxBytes 1e9 → 200000: one byte over the cap still omits the middle.
    const refs = await buildRefsFromPayload(payload({ spans: [{ startLine: 1, endLine: 1, text: 'y'.repeat(200_001) }] }), {
      maxLines: 10,
      maxBytes: 1e9,
    })
    const decoded = chipPayload(refs[0]!.ref)
    expect(decoded.truncated).toBe(true)
    expect(decoded.headLen).toBe(100_000)
    expect(decoded.omitBytes).toBe(1)
  })

  it('rounds fractional caps (not floors them)', async () => {
    // maxLines 2.6 → 3: three lines fit untruncated.
    const refs = await buildRefsFromPayload(payload({ spans: [{ startLine: 1, endLine: 3, text: 'a\nb\nc' }] }), {
      maxLines: 2.6,
      maxBytes: 100000,
    })
    expect(chipPayload(refs[0]!.ref).truncated).toBeUndefined()
  })

  it('drops the language flag when absent', async () => {
    const refs = await buildRefsFromPayload(payload({ language: undefined }), {})
    expect(chipPayload(refs[0]!.ref).lang).toBeUndefined()
  })

  it('builds one chip per multi-cursor span in order', async () => {
    const refs = await buildRefsFromPayload(payload({
      spans: [
        { startLine: 1, endLine: 1, text: 'a' },
        { startLine: 5, endLine: 6, text: 'b\nc' },
      ],
    }), {})
    expect(refs.map(ref => ref.label)).toEqual(['code/app/src/main.ts L1', 'code/app/src/main.ts L5-L6'])
  })
})

describe('buildResourceRefsFromPayload', () => {
  it('builds one chip per resource with path-only labels and matching appearance', () => {
    const refs = buildResourceRefsFromPayload(resourceList(), {
      reverseRules: RULES,
      cwd: '/data/workspace/code/app',
    })
    expect(refs).toHaveLength(2)
    const [folder, file] = refs
    expect(folder!.source).toBe(VSCODE_SOURCE)
    expect(folder!.appearance).toBe('folder')
    expect(folder!.label).toBe('src')
    expect(folder!.clipboardText).toBe(folder!.ref)
    expect(chipResourcePayload(folder!.ref)).toEqual({ v: 1, path: 'src', type: 'folder' })
    expect(file!.appearance).toBe('file')
    expect(file!.label).toBe('src/main.ts')
    expect(chipResourcePayload(file!.ref)).toEqual({ v: 1, path: 'src/main.ts', type: 'file' })
  })

  it('keeps the absolute DSH path when it sits outside the cwd', () => {
    const refs = buildResourceRefsFromPayload(resourceList(), {
      reverseRules: RULES,
      cwd: '/data/workspace/other',
    })
    expect(refs.map(ref => ref.label)).toEqual([
      '/data/workspace/code/app/src',
      '/data/workspace/code/app/src/main.ts',
    ])
  })

  it('passes unmatched absolute paths through unchanged (raw container paths)', () => {
    const elsewhere = buildResourceRefsFromPayload(resourceList({
      resources: [
        { path: '/elsewhere/x', relative: 'x', type: 'file' },
        { path: '/elsewhere/y', type: 'folder' },
      ],
    }), { reverseRules: RULES })
    expect(elsewhere.map(ref => ref.label)).toEqual(['/elsewhere/x', '/elsewhere/y'])
  })

  it('emits content-less mentions only — no snapshot, hash, or truncation fields', () => {
    const refs = buildResourceRefsFromPayload(resourceList(), {})
    for (const ref of refs) {
      expect(ref.ref).not.toContain('text')
      const decoded = chipResourcePayload(ref.ref)
      expect(Object.keys(decoded).sort()).toEqual(['path', 'type', 'v'])
    }
  })
})

/** A fake SessionInput for insertion tests. */
class FakeInput implements SessionInputFace {
  draft = ''
  draftRev = 0
  phase = 'plain'
  inserted: { ref: string, span: { start: number, end: number, draftRev: number } }[] = []
  drafts: string[] = []
  failInsert = false

  readonly state = {
    getSnapshot: (): InputStateLike => ({
      draft: this.draft,
      draftRev: this.draftRev,
      phase: this.phase,
      occurrences: [],
    }),
  }

  insertReference(ref: ReferenceInsertLike, span: TokenSpanLike): boolean {
    if (this.failInsert) return false
    if (span.draftRev !== this.draftRev) return false
    this.inserted.push({ ref: ref.ref, span })
    this.draft = `${this.draft}${ref.ref} `
    this.draftRev++
    return true
  }

  setDraft(text: string): void {
    this.draft = text
    this.draftRev++
    this.drafts.push(text)
  }
}

function servicesFor<T extends SessionInputFace> (input: T, opts: { scope?: boolean, throwFor?: boolean } = {}) {
  const bailOf = input as unknown as { bail?: unknown }
  const scope: unknown = typeof bailOf.bail === 'function' ? { bail: bailOf.bail } : {}
  const sessions: SessionsServiceFace = {
    scope: () => (opts.scope === false ? undefined : scope),
  }
  const conversation: ConversationServiceFace = {
    input: {
      for: () => {
        if (opts.throwFor === true) throw new Error('no binding')
        return input
      },
    },
  }
  return { sessions, conversation }
}

describe('insertVscodeReferences', () => {
  it('lands chips at end-of-draft zero-width spans', async () => {
    const input = new FakeInput()
    input.draft = 'look at'
    input.draftRev = 3
    const refs = await buildRefsFromPayload(payload(), {})
    const outcome = await insertVscodeReferences(servicesFor(input).sessions, servicesFor(input).conversation, 's1', refs)
    expect(outcome).toEqual({ inserted: 1, textFallback: 0, failed: false, caret: input.draft.length })
    expect(input.inserted).toHaveLength(1)
    expect(input.inserted[0]!.span).toEqual({ start: 'look at'.length, end: 'look at'.length, draftRev: 3 })
  })

  it('retries once when the machine is briefly busy and then succeeds', async () => {
    const input = new FakeInput()
    input.phase = 'submitting'
    const refs = await buildRefsFromPayload(payload(), {})
    const { sessions, conversation } = servicesFor(input)
    // The phase clears on the machine's next publication (after our 150ms retry).
    setTimeout(() => { input.phase = 'plain' }, 30)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs)
    expect(outcome.inserted).toBe(1)
  }, 10_000)

  it('falls back to appending the canonical mention as plain text', async () => {
    const input = new FakeInput()
    input.failInsert = true
    input.draft = 'ctx'
    const refs = await buildRefsFromPayload(payload(), {})
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs)
    expect(outcome).toEqual({ inserted: 0, textFallback: 1, failed: false, caret: input.drafts[0]!.length })
    expect(input.drafts[0]).toBe(`ctx ${refs[0]!.ref} `)
  }, 10_000)

  it('reports failure when no session scope resolves', async () => {
    const input = new FakeInput()
    const refs = await buildRefsFromPayload(payload(), {})
    const outcome = await insertVscodeReferences(
      servicesFor(input, { scope: false }).sessions,
      servicesFor(input).conversation,
      's1',
      refs,
    )
    expect(outcome.failed).toBe(true)
  })

  it('reports failure when the input resolver throws', async () => {
    const input = new FakeInput()
    const refs = await buildRefsFromPayload(payload(), {})
    const outcome = await insertVscodeReferences(
      servicesFor(input).sessions,
      servicesFor(input, { throwFor: true }).conversation,
      's1',
      refs,
    )
    expect(outcome.failed).toBe(true)
  })
})

describe('insertVscodeReferences at the caret (textarea-era machine)', () => {
  it('lands one chip at the caret mid-draft, keeping both sides', async () => {
    const input = new MachineLikeInput()
    input.draft = 'hello world'
    const refs = await buildRefsFromPayload(payload(), {})
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs, { start: 'hello'.length, end: 'hello'.length })
    const display = `@${refs[0]!.label}`
    expect(outcome.inserted).toBe(1)
    // The machine's trailing-gap rule adds nothing before the surviving ' world'.
    expect(input.draft).toBe(`hello${display} world`)
    expect(outcome.caret).toBe('hello'.length + display.length)
    expect(input.occurrences).toEqual([
      { occurrenceId: 1, source: VSCODE_SOURCE, ref: refs[0]!.ref, offset: 'hello'.length, length: display.length, label: refs[0]!.label },
    ])
  })

  it('lands each chip of a batch in order at the caret', async () => {
    const input = new MachineLikeInput()
    input.draft = 'ab'
    const refs = await buildRefsFromPayload(payload({
      spans: [
        { startLine: 1, endLine: 1, text: 'a' },
        { startLine: 5, endLine: 6, text: 'b\nc' },
      ],
    }), {})
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs, { start: 'a'.length, end: 'a'.length })
    const first = `@${refs[0]!.label}`
    const second = `@${refs[1]!.label}`
    expect(outcome.inserted).toBe(2)
    // Both chips splice before 'b', each followed by one machine gap.
    expect(input.draft).toBe(`a${first} ${second} b`)
    expect(outcome.caret).toBe(`a${first} ${second} `.length)
    expect(input.occurrences.map(entry => entry.offset)).toEqual(['a'.length, `a${first} `.length])
  })

  it('replaces the selected range rather than inserting beside it', async () => {
    const input = new MachineLikeInput()
    input.draft = 'keep [junk] tail'
    const refs = await buildRefsFromPayload(payload(), {})
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(
      sessions, conversation, 's1', refs,
      { start: 'keep '.length, end: 'keep [junk]'.length },
    )
    const display = `@${refs[0]!.label}`
    expect(input.draft).toBe(`keep ${display} tail`)
    expect(outcome.caret).toBe('keep '.length + display.length)
    expect(input.occurrences[0]!.offset).toBe('keep '.length)
  })

  it('clamps an out-of-range caret into the draft', async () => {
    const input = new MachineLikeInput()
    input.draft = 'ctx'
    const refs = await buildRefsFromPayload(payload(), {})
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs, { start: 99, end: 99 })
    const display = `@${refs[0]!.label}`
    // Clamped to the tail: chip, one machine gap, nothing after.
    expect(input.draft).toBe(`ctx${display} `)
    expect(outcome.caret).toBe(input.draft.length)
    // A negative point clamps to the head.
    const input2 = new MachineLikeInput()
    input2.draft = 'ctx'
    const outcome2 = await insertVscodeReferences(servicesFor(input2).sessions, servicesFor(input2).conversation, 's1', refs, { start: -3, end: -3 })
    expect(input2.draft).toBe(`${display} ctx`)
    expect(outcome2.caret).toBe(display.length + 1)
  })

  it('degrades a refused chip to the canonical mention at the caret (paste geometry)', async () => {
    const input = new MachineLikeInput()
    input.failInsert = true
    input.draft = 'hello world'
    const refs = await buildRefsFromPayload(payload(), {})
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs, { start: 'hello'.length, end: 'hello'.length })
    expect(outcome).toEqual({ inserted: 0, textFallback: 1, failed: false, caret: 'hello'.length + refs[0]!.ref.length })
    // Paste geometry: the mention plus the trailing-gap rule (' world'
    // already starts with a space, so no gap), no leading separator.
    expect(input.draft).toBe(`hello${refs[0]!.ref} world`)
    expect(input.editRanges).toEqual([{ start: 'hello'.length, end: 'hello'.length, insertedLength: refs[0]!.ref.length }])
  })

  it('keeps the historical tail landing when no point is addressed', async () => {
    const input = new MachineLikeInput()
    input.draft = 'ctx'
    const refs = await buildRefsFromPayload(payload(), {})
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs)
    const display = `@${refs[0]!.label}`
    // The chip splices at the draft tail with one machine gap — identical to
    // the pre-caret behavior.
    expect(input.draft).toBe(`ctx${display} `)
    expect(outcome.caret).toBe(input.draft.length)
    expect(input.occurrences[0]!.offset).toBe('ctx'.length)
  })
})

// ---- paste recovery: mention copies land back as chips ----

/** A fake that mirrors the machine's replaceSpanWithChip transaction shape. */
class MachineLikeInput implements SessionInputFace {
  draft = ''
  draftRev = 0
  phase = 'plain'
  failInsert = false
  private seq = 0
  readonly occurrences: OccurrenceLike[] = []

  readonly state = {
    getSnapshot: (): InputStateLike => ({
      draft: this.draft,
      draftRev: this.draftRev,
      phase: this.phase,
      occurrences: this.occurrences,
    }),
  }

  insertReference(ref: ReferenceInsertLike, span: TokenSpanLike): boolean {
    if (this.failInsert) return false
    if (this.phase !== 'plain' && this.phase !== 'claimed') return false
    if (span.draftRev !== this.draftRev) return false
    const tail = this.draft.slice(span.end)
    const gap = tail.length === 0 || tail[0] !== ' ' ? ' ' : ''
    const display = `@${ref.label}`
    this.draft = `${this.draft.slice(0, span.start)}${display}${gap}${tail}`
    this.seq += 1
    this.occurrences.push({ occurrenceId: this.seq, source: ref.source, ref: ref.ref, offset: span.start, length: display.length, label: ref.label })
    // The machine's withMinted keeps the occurrence table offset-sorted.
    this.occurrences.sort((a, b) => a.offset - b.offset)
    this.draftRev++
    return true
  }

  setDraft(text: string, editRange?: { start: number, end: number, insertedLength: number }): void {
    this.draft = text
    this.draftRev++
    if (editRange !== undefined) this.editRanges.push(editRange)
  }

  /** Every editRange a setDraft call passed (the fallback-splice assertions). */
  readonly editRanges: { start: number, end: number, insertedLength: number }[] = []
}

/** A ready selection payload for recovery tests (path already resolved). */
function ref (overrides: Partial<VscodeRefPayload> = {}): VscodeRefPayload {
  return { v: 1, path: 'src/main.ts', start: 10, end: 12, text: 'const a = 1', hash: '', ...overrides }
}

/** The exact whitespace-mangled copy shape a rendered chip yields on copy. */
function mangledCopy (source: VscodeRefPayload): string {
  const tail = encodeVscodeRefUri(source).slice('dsh-vscode:'.length)
  return `@ [ README.md L1 ]( dsh-vscode: ${tail} )`
}

describe('refsFromRecoveredMentions', () => {
  it('rebuilds selection and resource chips from recovered payloads', () => {
    const selection = ref()
    const folder: VscodeResourcePayload = { v: 1, path: 'src', type: 'folder' }
    const mentions = scanRecoveredMentions(
      `${mangledCopy(selection)} and ${formatVscodeResourceMention(folder)}`,
    )
    expect(mentions).toHaveLength(2)
    const [selChip, folderChip] = refsFromRecoveredMentions(mentions)
    expect(selChip).toMatchObject({
      source: VSCODE_SOURCE,
      ref: formatVscodeMention(selection),
      label: 'src/main.ts L10-L12',
      appearance: 'file',
      clipboardText: formatVscodeMention(selection),
    })
    expect(folderChip).toMatchObject({
      source: VSCODE_SOURCE,
      ref: formatVscodeResourceMention(folder),
      label: 'src',
      appearance: 'folder',
      clipboardText: formatVscodeResourceMention(folder),
    })
  })
})

describe('parseRecoveredPaste', () => {
  it('splits prose and mentions, trimming only the paste edges', () => {
    const parsed = parseRecoveredPaste(`\n\nsee ${mangledCopy(ref())} now\n\n`)!
    expect(parsed.parts).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'ref', ref: parsed.refs[0] },
      { kind: 'text', text: ' now' },
    ])
    expect(parsed.refs).toHaveLength(1)
  })

  it('returns null for pastes without recoverable mentions', () => {
    expect(parseRecoveredPaste('plain text only')).toBeNull()
    expect(parseRecoveredPaste('   \n ')).toBeNull()
    expect(parseRecoveredPaste('@ [ x ]( dsh-vscode: eyJub3Bl )')).toBeNull()
  })
})

describe('pasteRecoveredMentions (textarea-era machine)', () => {
  it('lands prose plus one chip at the caret, mid-draft', async () => {
    const input = new MachineLikeInput()
    input.draft = 'hello world'
    const parsed = parseRecoveredPaste(`see ${mangledCopy(ref())} now`)!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 5, end: 5 })
    expect(outcome).toEqual({ inserted: 1, textFallback: 0, failed: false, caret: 5 + 'see @src/main.ts L10-L12 now'.length })
    expect(input.draft).toBe('hellosee @src/main.ts L10-L12 now world')
    expect(input.occurrences).toEqual([
      { occurrenceId: 1, source: VSCODE_SOURCE, ref: parsed.refs[0]!.ref, offset: 'hellosee '.length, length: '@src/main.ts L10-L12'.length, label: 'src/main.ts L10-L12' },
    ])
  })

  it('lands two chips with prose between, in order, with the caret at the region end', async () => {
    const input = new MachineLikeInput()
    const parsed = parseRecoveredPaste(`${mangledCopy(ref({ start: 1, end: 1 }))} vs ${mangledCopy(ref({ path: 'other.ts', start: 3, end: 4 }))}`)!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 0, end: 0 })
    expect(outcome.inserted).toBe(2)
    // ' vs ' separates both chips; the machine adds no gap around a space.
    expect(input.draft).toBe('@src/main.ts L1 vs @other.ts L3-L4 ')
    expect(input.occurrences.map(entry => entry.label)).toEqual(['src/main.ts L1', 'other.ts L3-L4'])
    expect(outcome.caret).toBe(input.draft.length)
  })

  it('replaces the selected range rather than inserting beside it', async () => {
    const input = new MachineLikeInput()
    input.draft = 'keep [junk] tail'
    const parsed = parseRecoveredPaste(mangledCopy(ref()))!
    const { sessions, conversation } = servicesFor(input)
    await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 'keep '.length, end: 'keep [junk]'.length })
    expect(input.draft).toBe('keep @src/main.ts L10-L12 tail')
  })

  it('degrades a refused chip to the canonical mention over the same range', async () => {
    const input = new MachineLikeInput()
    input.failInsert = true
    input.draft = 'ctx'
    const parsed = parseRecoveredPaste(mangledCopy(ref()))!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 'ctx'.length, end: 'ctx'.length })
    expect(outcome).toEqual({ inserted: 0, textFallback: 1, failed: false, caret: 'ctx'.length + parsed.refs[0]!.ref.length + 1 })
    // Paste geometry: no leading separator appears where the paste landed,
    // and the machine's trailing-gap rule adds exactly one space.
    expect(input.draft).toBe(`ctx${parsed.refs[0]!.ref} `)
    expect(input.occurrences).toEqual([])
  })

  it('lands canonical mention text when the machine phase is frozen', async () => {
    const input = new MachineLikeInput()
    input.phase = 'submitting'
    input.draft = 'ctx'
    const parsed = parseRecoveredPaste(`see ${mangledCopy(ref())}`)!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 'ctx'.length, end: 'ctx'.length })
    expect(outcome.inserted).toBe(0)
    expect(outcome.textFallback).toBe(1)
    expect(input.draft).toBe(`ctxsee ${parsed.refs[0]!.ref} `)
    expect(input.occurrences).toEqual([])
  })

  it('reports failure when no session scope resolves', async () => {
    const input = new MachineLikeInput()
    const parsed = parseRecoveredPaste(mangledCopy(ref()))!
    const outcome = await pasteRecoveredMentions(
      servicesFor(input, { scope: false }).sessions,
      servicesFor(input).conversation,
      's1',
      parsed.parts,
      { start: 0, end: 0 },
    )
    expect(outcome.failed).toBe(true)
  })
})

describe('groupRailTags', () => {
  function occurrence (ref: string, label: string, offset: number, extra: Partial<OccurrenceLike> = {}): OccurrenceLike {
    return { occurrenceId: offset, source: VSCODE_SOURCE, ref, offset, length: label.length, label, ...extra }
  }

  it('groups chips by canonical mention with counts and first-seen order', async () => {
    const refs = await buildRefsFromPayload(payload(), {})
    const other = await buildRefsFromPayload(payload({ spans: [{ startLine: 1, endLine: 1, text: 'x' }] }), {})
    const a = refs[0]!.ref
    const b = other[0]!.ref
    const tags = groupRailTags([
      occurrence(a, 'src/main.ts L10-L12', 0),
      occurrence(b, 'src/main.ts L1', 10),
      occurrence(a, 'src/main.ts L10-L12', 20),
    ])
    expect(tags).toHaveLength(2)
    expect(tags[0]).toMatchObject({ ref: a, label: 'src/main.ts L10-L12', count: 2 })
    expect(tags[0]!.ranges).toEqual([{ offset: 0, length: 19 }, { offset: 20, length: 19 }])
    expect(tags[1]).toMatchObject({ ref: b, count: 1 })
    expect(tags[0]!.truncated).toBe(false)
  })

  it('marks truncated references through the payload badge', async () => {
    const refs = await buildRefsFromPayload(
      payload({ spans: [{ startLine: 1, endLine: 500, text: `${'line\n'.repeat(500)}` }] }),
      { maxLines: 10 },
    )
    const tags = groupRailTags([occurrence(refs[0]!.ref, 'whatever', 0)])
    expect(tags[0]!.truncated).toBe(true)
  })

  it('flags folder chips through the resource payload, files stay false', () => {
    const refs = buildResourceRefsFromPayload(resourceList(), {})
    const tags = groupRailTags([
      occurrence(refs[0]!.ref, 'src', 0),
      occurrence(refs[1]!.ref, 'src/main.ts', 10),
    ])
    expect(tags[0]).toMatchObject({ label: 'src', folder: true, truncated: false })
    expect(tags[1]).toMatchObject({ label: 'src/main.ts', folder: false, truncated: false })
  })

  it('groups selection and resource chips independently side by side', async () => {
    const sel = await buildRefsFromPayload(payload(), {})
    const res = buildResourceRefsFromPayload(resourceList(), {})
    const tags = groupRailTags([
      occurrence(sel[0]!.ref, 'src/main.ts L10-L12', 0),
      occurrence(res[1]!.ref, 'src/main.ts', 30),
    ])
    expect(tags).toHaveLength(2)
    expect(tags[0]!.folder).toBe(false)
    expect(tags[1]!.folder).toBe(false)
  })

  it('ignores other sources and survives a mangled ref', () => {
    const tags = groupRailTags([
      { occurrenceId: 1, source: 'reference', ref: 'x', offset: 0, length: 1, label: 'x' },
      occurrence('@[x](dsh-vscode:%%)', 'x', 5),
    ])
    expect(tags).toHaveLength(1)
    expect(tags[0]!.truncated).toBe(false)
  })

  it('treats a reference as invalid only when every chip is invalid', () => {
    const ref = encodeVscodeRefUri({
      v: 1, path: 'a.ts', start: 1, end: 1, text: 'x', hash: 'a1b2c3d4e5f60718',
    })
    const tags = groupRailTags([
      occurrence(ref, 'a.ts L1', 0, { invalid: true }),
      occurrence(ref, 'a.ts L1', 9, { invalid: true }),
    ])
    expect(tags[0]!.invalid).toBe(true)
    const partial = groupRailTags([
      occurrence(ref, 'a.ts L1', 0, { invalid: true }),
      occurrence(ref, 'a.ts L1', 9),
    ])
    expect(partial[0]!.invalid).toBe(false)
  })
})

describe('removeRefRanges', () => {
  it('removes every chip of one reference, collapsing seam spaces', async () => {
    const refs = await buildRefsFromPayload(payload(), {})
    const ref = refs[0]!.ref
    const label = refs[0]!.label
    const draft = `before @${label} mid @${label} after`
    // Chip display text is `@${label}` (referenceDraftText).
    const first = draft.indexOf(`@${label}`)
    const second = draft.indexOf(`@${label}`, first + 1)
    const occurrences: OccurrenceLike[] = [
      { occurrenceId: 1, source: VSCODE_SOURCE, ref, offset: first, length: label.length + 1, label },
      { occurrenceId: 2, source: VSCODE_SOURCE, ref, offset: second, length: label.length + 1, label },
    ]
    expect(removeRefRanges(draft, occurrences, ref)).toBe('before mid after')
  })

  it('keeps other references and plain text intact', async () => {
    const a = (await buildRefsFromPayload(payload(), {}))[0]!
    const b = (await buildRefsFromPayload(payload({ spans: [{ startLine: 1, endLine: 1, text: 'x' }] }), {}))[0]!
    const draft = `@${a.label} and @${b.label}`
    const occurrences: OccurrenceLike[] = [
      { occurrenceId: 1, source: VSCODE_SOURCE, ref: a.ref, offset: 0, length: a.label.length + 1, label: a.label },
      { occurrenceId: 2, source: VSCODE_SOURCE, ref: b.ref, offset: draft.indexOf(`@${b.label}`), length: b.label.length + 1, label: b.label },
    ]
    const next = removeRefRanges(draft, occurrences, a.ref)
    expect(next).toBe(`and @${b.label}`)
    // Removing the other reference then leaves only prose, trimmed.
    const occurrencesB: OccurrenceLike[] = [{
      occurrenceId: 2, source: VSCODE_SOURCE, ref: b.ref, offset: next.indexOf(`@${b.label}`), length: b.label.length + 1, label: b.label,
    }]
    expect(removeRefRanges(next, occurrencesB, b.ref)).toBe('and')
  })

  it('clears a whitespace-only remainder to the empty draft', async () => {
    const ref = (await buildRefsFromPayload(payload(), {}))[0]!
    const draft = `  @${ref.label}  `
    const occurrences: OccurrenceLike[] = [{
      occurrenceId: 1, source: VSCODE_SOURCE, ref: ref.ref, offset: 2, length: ref.label.length + 1, label: ref.label,
    }]
    expect(removeRefRanges(draft, occurrences, ref.ref)).toBe('')
  })
})

// ---- the Lexical-era machine (DSH >= 0.1.2-alpha.2) ----

/** One document part of the modern single-paragraph composer model. */
type ModernPart = { kind: 'text', text: string } | { kind: 'chip', ref: ReferenceInsertLike }

/**
 * A faithful mini-model of the Lexical-era SessionInputShell: the draft is
 * the CLIPBOARD projection (chips expand to clipboardText), spans are
 * DETECT-projection offsets (chips are one ￼ char), insertReference refuses
 * out-of-bounds spans (span-map null), setDraft REPLACES the whole document
 * as plain text, and the scoped bail events apply span-addressed writes the
 * way the input hub's listeners do.
 */
class ModernInput implements SessionInputFace {
  /** The Lexical marker the host probe looks for. */
  readonly editor: unknown = Object.freeze({})
  parts: ModernPart[] = []
  draftRev = 0
  phase = 'plain'
  failInsert = false
  failInsertText = false
  /** Every whole-draft write (the destructive path — asserted empty). */
  readonly drafts: string[] = []
  /** Every insert-text transaction the hub applied. */
  readonly insertTexts: { text: string, span: { start: number, end: number } }[] = []
  /** Every consume-token transaction the hub applied. */
  readonly consumed: { start: number, end: number }[] = []

  get detectText (): string {
    return this.parts.map(part => part.kind === 'text' ? part.text : '￼').join('')
  }

  get clipboardText (): string {
    return this.parts.map(part => part.kind === 'text' ? part.text : part.ref.clipboardText).join('')
  }

  get occurrences (): OccurrenceLike[] {
    const rows: OccurrenceLike[] = []
    let clipboard = 0
    let seq = 0
    for (const part of this.parts) {
      if (part.kind === 'text') {
        clipboard += part.text.length
        continue
      }
      seq += 1
      rows.push({
        occurrenceId: seq,
        source: part.ref.source,
        ref: part.ref.ref,
        offset: clipboard,
        length: part.ref.clipboardText.length,
        label: part.ref.label,
        clipboardText: part.ref.clipboardText,
      })
      clipboard += part.ref.clipboardText.length
    }
    return rows
  }

  readonly state = {
    getSnapshot: (): InputStateLike => ({
      draft: this.clipboardText,
      draftRev: this.draftRev,
      phase: this.phase,
      occurrences: this.occurrences,
    }),
  }

  /** Split the document at one detect offset → [before, after]. */
  private splitAt (detectOffset: number): [ModernPart[], ModernPart[]] {
    const before: ModernPart[] = []
    const after: ModernPart[] = []
    let base = 0
    for (const part of this.parts) {
      if (part.kind === 'chip') {
        // Chips are atomic: wholly before once the split passes their edge.
        if (detectOffset >= base + 1) before.push(part)
        else after.push(part)
        base += 1
        continue
      }
      const within = Math.max(0, Math.min(part.text.length, detectOffset - base))
      if (within > 0) before.push({ kind: 'text', text: part.text.slice(0, within) })
      if (within < part.text.length) after.push({ kind: 'text', text: part.text.slice(within) })
      base += part.text.length
    }
    return [before, after]
  }

  private replaceDetectSpan (span: { start: number, end: number }, nodes: ModernPart[]): void {
    const [head] = this.splitAt(span.start)
    const [, tail] = this.splitAt(span.end)
    this.parts = [...head, ...nodes, ...tail]
    this.draftRev += 1
  }

  insertReference (ref: ReferenceInsertLike, span: TokenSpanLike): boolean {
    if (this.failInsert) return false
    if (this.phase !== 'plain' && this.phase !== 'claimed') return false
    if (span.draftRev !== this.draftRev) return false
    const detect = this.detectText
    // The span-map contract: out-of-bounds spans never resolve.
    if (span.start < 0 || span.end < span.start || span.end > detect.length) return false
    const gap = detect[span.end] === ' ' ? '' : ' '
    this.replaceDetectSpan(span, gap === '' ? [{ kind: 'chip', ref }] : [{ kind: 'chip', ref }, { kind: 'text', text: ' ' }])
    return true
  }

  setDraft (text: string): void {
    this.parts = text === '' ? [] : [{ kind: 'text', text }]
    this.draftRev += 1
    this.drafts.push(text)
  }

  /** The hub's 'slash/input-insert-text' listener body. */
  private applyInsertText (request: { text: string, span: TokenSpanLike }): boolean {
    if (this.failInsertText) return false
    if (request.span.draftRev !== this.draftRev) return false
    const detect = this.detectText
    const span = request.span
    if (span.start < 0 || span.end < span.start || span.end > detect.length) return false
    this.replaceDetectSpan(span, request.text === '' ? [] : [{ kind: 'text', text: request.text }])
    this.insertTexts.push({ text: request.text, span: { start: span.start, end: span.end } })
    return true
  }

  /** The hub's 'slash/input-consume-token' listener body. */
  private applyConsumeToken (request: { guard: { kind: 'span', span: TokenSpanLike } }): boolean {
    const span = request.guard.span
    if (span.draftRev !== this.draftRev) return false
    if (span.start === span.end) return false
    const detect = this.detectText
    if (span.start < 0 || span.end > detect.length) return false
    this.replaceDetectSpan(span, [])
    this.consumed.push({ start: span.start, end: span.end })
    return true
  }

  /** The session scope's bail face (bound arrow — handed to servicesFor). */
  readonly bail = (thisArg: unknown, event: string, request: unknown): boolean | undefined => {
    if (event === 'slash/input-insert-text') return this.applyInsertText(request as { text: string, span: TokenSpanLike })
    if (event === 'slash/input-consume-token') {
      return this.applyConsumeToken(request as { guard: { kind: 'span', span: TokenSpanLike } })
    }
    return undefined
  }
}

describe('projection-plane helpers', () => {
  const occurrences: OccurrenceLike[] = [
    // "see " + chip(10) + " and " + chip(4) + "!"  (clipboard offsets)
    { occurrenceId: 1, source: VSCODE_SOURCE, ref: 'a', offset: 4, length: 10, label: 'a' },
    { occurrenceId: 2, source: VSCODE_SOURCE, ref: 'b', offset: 19, length: 4, label: 'b' },
  ]
  const draft = `see ${'x'.repeat(10)} and ${'y'.repeat(4)}!`

  it('computes the detect length (one char per chip)', () => {
    expect(detectLengthOf({ draft, occurrences })).toBe('see ￼ and ￼!'.length)
  })

  it('maps clipboard offsets to detect offsets (inside/at a chip → trailing edge)', () => {
    expect(detectOfClipboard(0, occurrences)).toBe(0)
    expect(detectOfClipboard(4, occurrences)).toBe(4) // chip leading edge
    expect(detectOfClipboard(9, occurrences)).toBe(5) // inside → trailing edge
    expect(detectOfClipboard(14, occurrences)).toBe(5) // chip end → trailing edge
    expect(detectOfClipboard(15, occurrences)).toBe(6) // ' and ' tail
    expect(detectOfClipboard(draft.length, occurrences)).toBe('see ￼ and ￼!'.length)
  })

  it('maps detect offsets back to clipboard offsets', () => {
    expect(clipboardOfDetect(4, occurrences)).toBe(4)   // the first chip's leading edge
    expect(clipboardOfDetect(5, occurrences)).toBe(14)  // past the first chip
    expect(clipboardOfDetect(10, occurrences)).toBe(19) // the second chip's leading edge
    expect(clipboardOfDetect(11, occurrences)).toBe(23) // past the second chip
    expect(clipboardOfDetect(12, occurrences)).toBe(24) // the trailing '!'
  })

  it('detects the Lexical host by the editor marker', () => {
    expect(isLexicalInput(new ModernInput())).toBe(true)
    expect(isLexicalInput(new FakeInput())).toBe(false)
  })
})

describe('insertVscodeReferences (Lexical machine)', () => {
  it('lands one chip at the caret mid-draft (detect plane)', async () => {
    const input = new ModernInput()
    input.parts = [{ kind: 'text', text: 'hello world' }]
    const refs = await buildRefsFromPayload(payload(), {})
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs, { start: 'hello'.length, end: 'hello'.length })
    expect(outcome.inserted).toBe(1)
    // The machine adds no gap of its own: the existing space after the caret
    // already separates the chip from ' world'.
    expect(outcome.caret).toBe('hello￼'.length)
    expect(input.detectText).toBe('hello￼ world')
    expect(input.clipboardText).toBe(`hello${refs[0]!.clipboardText} world`)
    expect(input.occurrences).toMatchObject([{ offset: 'hello'.length, length: refs[0]!.clipboardText.length }])
    expect(input.drafts).toEqual([])
  })

  it('lands a second chip after a first one without flattening it (the reported regression)', async () => {
    const input = new ModernInput()
    const first = (await buildRefsFromPayload(payload(), {}))[0]!
    input.parts = [{ kind: 'chip', ref: first }, { kind: 'text', text: ' ' }]
    input.draftRev = 1
    const second = (await buildRefsFromPayload(payload({ spans: [{ startLine: 5, endLine: 6, text: 'b\nc' }] }), {}))[0]!
    const { sessions, conversation } = servicesFor(input)
    // No addressed point: the historical tail landing, now in detect coords.
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', [second])
    expect(outcome.inserted).toBe(1)
    expect(outcome.textFallback).toBe(0)
    expect(input.drafts).toEqual([]) // the old code fell to setDraft here, wiping chip #1
    expect(input.detectText).toBe('￼ ￼ ')
    expect(input.occurrences).toHaveLength(2)
    expect(input.occurrences.map(row => row.ref)).toEqual([first.ref, second.ref])
    expect(input.clipboardText).toBe(`${first.clipboardText} ${second.clipboardText} `)
  })

  it('lands at the caret between two existing chips', async () => {
    const input = new ModernInput()
    const a = (await buildRefsFromPayload(payload(), {}))[0]!
    const b = (await buildRefsFromPayload(payload({ spans: [{ startLine: 5, endLine: 6, text: 'b\nc' }] }), {}))[0]!
    input.parts = [{ kind: 'chip', ref: a }, { kind: 'text', text: ' mid ' }, { kind: 'chip', ref: b }]
    input.draftRev = 1
    const c = (await buildRefsFromPayload(payload({ spans: [{ startLine: 9, endLine: 9, text: 'z' }] }), {}))[0]!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', [c], { start: '￼ '.length, end: '￼ '.length })
    expect(outcome.inserted).toBe(1)
    // 'm' follows the caret, so the machine appends its own separating space.
    expect(input.detectText).toBe('￼ ￼ mid ￼')
    expect(input.drafts).toEqual([])
    expect(input.occurrences).toHaveLength(3)
  })

  it('clamps an out-of-range caret into the detect length, not the clipboard length', async () => {
    const input = new ModernInput()
    const a = (await buildRefsFromPayload(payload(), {}))[0]!
    input.parts = [{ kind: 'chip', ref: a }, { kind: 'text', text: ' tail' }]
    input.draftRev = 1
    const b = (await buildRefsFromPayload(payload(), {}))[0]!
    const { sessions, conversation } = servicesFor(input)
    // 99 is beyond even the clipboard length — the clamp must still land a chip.
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', [b], { start: 99, end: 99 })
    expect(outcome.inserted).toBe(1)
    expect(input.detectText).toBe('￼ tail￼ ')
    expect(input.drafts).toEqual([])
  })

  it('degrades a refused chip to mention text through the insert-text event, keeping chips intact', async () => {
    const input = new ModernInput()
    const a = (await buildRefsFromPayload(payload(), {}))[0]!
    input.parts = [{ kind: 'chip', ref: a }, { kind: 'text', text: ' ctx' }]
    input.draftRev = 1
    input.failInsert = true
    const b = (await buildRefsFromPayload(payload({ spans: [{ startLine: 5, endLine: 6, text: 'b\nc' }] }), {}))[0]!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', [b], { start: '￼ '.length, end: '￼ '.length })
    expect(outcome).toMatchObject({ inserted: 0, textFallback: 1 })
    expect(outcome.caret).toBe('￼ '.length + b.ref.length + 1)
    expect(input.drafts).toEqual([]) // no whole-draft write: chip #1 survives
    expect(input.occurrences).toHaveLength(1)
    expect(input.insertTexts).toEqual([{ text: `${b.ref} `, span: { start: '￼ '.length, end: '￼ '.length } }])
    expect(input.detectText).toBe(`￼ ${b.ref} ctx`)
  })

  it('appends as mention text at the tail through the event when no point is addressed', async () => {
    const input = new ModernInput()
    const a = (await buildRefsFromPayload(payload(), {}))[0]!
    input.parts = [{ kind: 'chip', ref: a }, { kind: 'text', text: 'ctx' }]
    input.draftRev = 1
    input.failInsert = true
    const { sessions, conversation } = servicesFor(input)
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', [a])
    expect(outcome.textFallback).toBe(1)
    expect(input.drafts).toEqual([])
    expect(input.detectText).toBe(`￼ctx ${a.ref} `)
  })

  it('falls back to the whole-draft write only when the host has no event seam', async () => {
    const input = new ModernInput()
    input.failInsert = true
    input.parts = [{ kind: 'text', text: 'ctx' }]
    const refs = await buildRefsFromPayload(payload(), {})
    const sessions: SessionsServiceFace = { scope: () => ({}) } // a scope without bail
    const conversation: ConversationServiceFace = { input: { for: () => input } }
    const outcome = await insertVscodeReferences(sessions, conversation, 's1', refs)
    expect(outcome.textFallback).toBe(1)
    expect(input.drafts).toEqual([`ctx ${refs[0]!.ref} `])
  })
})

describe('pasteRecoveredMentions (Lexical machine)', () => {
  it('lands prose plus chips at the paste selection without whole-draft writes', async () => {
    const input = new ModernInput()
    input.parts = [{ kind: 'text', text: 'hello world' }]
    const parsed = parseRecoveredPaste(`see ${mangledCopy(ref())} now`)!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 5, end: 5 })
    expect(outcome.inserted).toBe(1)
    expect(input.drafts).toEqual([])
    // The machine adds no gap of its own: the surviving ' world' already
    // starts with its separating space.
    expect(input.detectText).toBe('hellosee ￼ now world')
    expect(input.occurrences).toHaveLength(1)
    expect(outcome.caret).toBe('hellosee ￼ now'.length)
  })

  it('keeps existing chips when landing a paste among them', async () => {
    const input = new ModernInput()
    const a = (await buildRefsFromPayload(payload(), {}))[0]!
    input.parts = [{ kind: 'chip', ref: a }, { kind: 'text', text: ' tail' }]
    input.draftRev = 1
    const parsed = parseRecoveredPaste(mangledCopy(ref()))!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 2, end: 2 })
    expect(outcome.inserted).toBe(1)
    expect(input.drafts).toEqual([])
    expect(input.occurrences).toHaveLength(2)
  })

  it('lands canonical mention text through the event when the phase is frozen', async () => {
    const input = new ModernInput()
    input.parts = [{ kind: 'text', text: 'ctx' }]
    input.phase = 'submitting'
    const parsed = parseRecoveredPaste(`see ${mangledCopy(ref())}`)!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 3, end: 3 })
    expect(outcome.inserted).toBe(0)
    expect(outcome.textFallback).toBe(1)
    expect(input.drafts).toEqual([])
    expect(input.detectText).toBe(`ctxsee ${parsed.refs[0]!.ref} `)
  })

  it('degrades one refused chip to mention text, keeping prose and other chips', async () => {
    const input = new ModernInput()
    input.failInsert = true
    input.parts = [{ kind: 'text', text: 'ctx' }]
    const parsed = parseRecoveredPaste(`see ${mangledCopy(ref())} now`)!
    const { sessions, conversation } = servicesFor(input)
    const outcome = await pasteRecoveredMentions(sessions, conversation, 's1', parsed.parts, { start: 3, end: 3 })
    expect(outcome).toMatchObject({ inserted: 0, textFallback: 1 })
    expect(input.drafts).toEqual([])
    expect(input.detectText).toBe(`ctxsee ${parsed.refs[0]!.ref}  now`)
  })
})

describe('removeVscodeReferences', () => {
  it('removes every chip of one reference through consume-token, keeping the others', async () => {
    const input = new ModernInput()
    const a1 = (await buildRefsFromPayload(payload(), {}))[0]!
    const a2 = a1
    const b = (await buildRefsFromPayload(payload({ spans: [{ startLine: 5, endLine: 6, text: 'b\nc' }] }), {}))[0]!
    input.parts = [
      { kind: 'chip', ref: a1 },
      { kind: 'text', text: ' and ' },
      { kind: 'chip', ref: a2 },
      { kind: 'text', text: ' plus ' },
      { kind: 'chip', ref: b },
    ]
    input.draftRev = 1
    const { sessions, conversation } = servicesFor(input)
    const outcome = await removeVscodeReferences(sessions, conversation, 's1', a1.ref)
    expect(outcome).toEqual({ removed: 2, degraded: false })
    expect(input.drafts).toEqual([]) // the old rail flattened every chip here
    expect(input.occurrences).toHaveLength(1)
    expect(input.occurrences[0]!.ref).toBe(b.ref)
    // Seam rule: each removed chip took one doubled space with it; the
    // interstitial words and the other chip survive untouched.
    expect(input.detectText).toBe('and plus ￼')
  })

  it('clears a whitespace-only remainder to the empty draft', async () => {
    const input = new ModernInput()
    const a = (await buildRefsFromPayload(payload(), {}))[0]!
    input.parts = [{ kind: 'text', text: '  ' }, { kind: 'chip', ref: a }, { kind: 'text', text: ' ' }]
    input.draftRev = 1
    const { sessions, conversation } = servicesFor(input)
    const outcome = await removeVscodeReferences(sessions, conversation, 's1', a.ref)
    expect(outcome.degraded).toBe(false)
    expect(input.detectText).toBe('')
    expect(input.drafts).toEqual([])
  })

  it('degrades to the whole-draft splice when the machine refuses', async () => {
    const input = new ModernInput()
    const a = (await buildRefsFromPayload(payload(), {}))[0]!
    input.parts = [{ kind: 'chip', ref: a }, { kind: 'text', text: ' tail' }]
    input.draftRev = 1
    const sessions: SessionsServiceFace = { scope: () => ({}) } // no bail seam
    const conversation: ConversationServiceFace = { input: { for: () => input } }
    const outcome = await removeVscodeReferences(sessions, conversation, 's1', a.ref)
    expect(outcome).toEqual({ removed: 1, degraded: true })
    expect(input.drafts).toEqual(['tail'])
  })

  it('uses the legacy whole-draft splice on textarea-era machines', async () => {
    const input = new MachineLikeInput()
    const refs = await buildRefsFromPayload(payload(), {})
    input.draft = `@${refs[0]!.label} tail`
    input.occurrences.push({
      occurrenceId: 1, source: VSCODE_SOURCE, ref: refs[0]!.ref, offset: 0,
      length: refs[0]!.label.length + 1, label: refs[0]!.label,
    })
    const { sessions, conversation } = servicesFor(input)
    const outcome = await removeVscodeReferences(sessions, conversation, 's1', refs[0]!.ref)
    expect(outcome).toEqual({ removed: 1, degraded: false })
    expect(input.draft).toBe('tail')
  })
})
