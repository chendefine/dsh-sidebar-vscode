/**
 * Unit tests for the clipboard envelope codec and payload validation — both
 * the editor-selection and the explorer-resource payload kinds — plus the
 * reverse path mapping the reference builder consumes.
 *
 * @module dsh-sidebar-vscode/tests/selection.spec
 */

import { describe, expect, it } from 'vitest'
import {
  SELECTION_MARKER,
  encodeEnvelopePayload,
  envelopeReadablePart,
  parseClipboardEnvelope,
  type ResourceListPayload,
  type SelectionPayload,
} from '../src/client/selection.ts'
import { parsePathMap, reverseMapPath } from '../src/client/paths.ts'

function payload (overrides: Partial<SelectionPayload> = {}): SelectionPayload {
  return {
    path: '/data/workspace/code/app/src/main.ts',
    relative: 'code/app/src/main.ts',
    language: 'typescript',
    spans: [{ startLine: 10, endLine: 12, text: 'const a = 1\r\nconst b = 2\r\nconst c = 3\r\n' }],
    ...overrides,
  }
}

function resourcePayload (overrides: Partial<ResourceListPayload> = {}): ResourceListPayload {
  return {
    kind: 'resource',
    resources: [
      { path: '/data/workspace/code/app/src', type: 'folder' },
      { path: '/data/workspace/code/app/src/main.ts', relative: 'code/app/src/main.ts', type: 'file' },
    ],
    ...overrides,
  }
}

describe('envelope codec', () => {
  it('round-trips a selection payload through the envelope', () => {
    const envelope = `${SELECTION_MARKER}${encodeEnvelopePayload(payload())}::\nreadable part`
    expect(parseClipboardEnvelope(envelope)).toEqual(payload())
  })

  it('round-trips the dirty flag from unsaved buffers', () => {
    const envelope = `${SELECTION_MARKER}${encodeEnvelopePayload(payload({ dirty: true }))}::`
    expect(parseClipboardEnvelope(envelope)).toEqual(payload({ dirty: true }))
  })

  it('round-trips a resource payload (files and folders, mixed)', () => {
    const envelope = `${SELECTION_MARKER}${encodeEnvelopePayload(resourcePayload())}::\nreadable`
    expect(parseClipboardEnvelope(envelope)).toEqual(resourcePayload())
  })

  it('round-trips a resource payload with optional relative paths dropped', () => {
    const minimal: ResourceListPayload = { kind: 'resource', resources: [{ path: '/opt/x', type: 'file' }] }
    expect(parseClipboardEnvelope(`${SELECTION_MARKER}${encodeEnvelopePayload(minimal)}::`)).toEqual(minimal)
  })

  it('rejects non-envelope text', () => {
    expect(parseClipboardEnvelope('just some copied code')).toBeNull()
    expect(parseClipboardEnvelope('')).toBeNull()
    expect(parseClipboardEnvelope(`${SELECTION_MARKER}not-base64!!::x`)).toBeNull()
  })

  it('rejects structurally invalid selection payloads', () => {
    const bad = Buffer.from(JSON.stringify({ path: '/x', spans: [{ startLine: 0, endLine: 2, text: 'y' }] }), 'utf8').toString('base64url')
    expect(parseClipboardEnvelope(`${SELECTION_MARKER}${bad}::`)).toBeNull()
    const badDirty = Buffer.from(JSON.stringify({ ...payload(), dirty: 'yes' }), 'utf8').toString('base64url')
    expect(parseClipboardEnvelope(`${SELECTION_MARKER}${badDirty}::`)).toBeNull()
  })

  it('rejects structurally invalid resource payloads', () => {
    const badType = Buffer.from(JSON.stringify({ kind: 'resource', resources: [{ path: '/x', type: 'symlink' }] }), 'utf8').toString('base64url')
    expect(parseClipboardEnvelope(`${SELECTION_MARKER}${badType}::`)).toBeNull()
    const emptyList = Buffer.from(JSON.stringify({ kind: 'resource', resources: [] }), 'utf8').toString('base64url')
    expect(parseClipboardEnvelope(`${SELECTION_MARKER}${emptyList}::`)).toBeNull()
    const noPath = Buffer.from(JSON.stringify({ kind: 'resource', resources: [{ type: 'file' }] }), 'utf8').toString('base64url')
    expect(parseClipboardEnvelope(`${SELECTION_MARKER}${noPath}::`)).toBeNull()
  })

  it('rejects an unknown payload kind', () => {
    const unknown = Buffer.from(JSON.stringify({ kind: 'mystery', path: '/x', spans: [] }), 'utf8').toString('base64url')
    expect(parseClipboardEnvelope(`${SELECTION_MARKER}${unknown}::`)).toBeNull()
  })

  it('extracts the readable part after the terminator', () => {
    const envelope = `${SELECTION_MARKER}${encodeEnvelopePayload(payload())}::\n@code/app.ts L1:\nhello`
    expect(envelopeReadablePart(envelope)).toBe('@code/app.ts L1:\nhello')
    expect(envelopeReadablePart('plain text')).toBe('plain text')
  })
})

describe('reverseMapPath', () => {
  const rules = parsePathMap('/data/workspace=/data/workspace;/opt=/opt')

  it('passes the default (identity) rules through unchanged', () => {
    expect(reverseMapPath('/data/workspace', rules)).toBe('/data/workspace')
    expect(reverseMapPath('/data/workspace/code/app/src.ts', rules)).toBe('/data/workspace/code/app/src.ts')
  })

  it('passes /opt-side prefixes through unchanged', () => {
    expect(reverseMapPath('/data/workspace/x', rules)).toBe('/data/workspace/x')
    expect(reverseMapPath('/opt/dsh', rules)).toBe('/opt/dsh')
  })

  it('maps a custom destination prefix back to the DSH workspace prefix', () => {
    const custom = parsePathMap('/data/workspace=/mnt/vscode')
    expect(reverseMapPath('/mnt/vscode', custom)).toBe('/data/workspace')
    expect(reverseMapPath('/mnt/vscode/code/app/src.ts', custom)).toBe('/data/workspace/code/app/src.ts')
  })

  it('honors the longest destination prefix', () => {
    const custom = parsePathMap('/data/workspace=/mnt/vscode;/data/workspace/code=/x')
    expect(reverseMapPath('/x/a.ts', custom)).toBe('/data/workspace/code/a.ts')
  })

  it('returns null only for non-absolute or relative paths', () => {
    expect(reverseMapPath('relative/x', rules)).toBeNull()
    expect(reverseMapPath('', rules)).toBeNull()
  })

  it('passes unmatched absolute paths through unchanged (pass-through mode)', () => {
    expect(reverseMapPath('/srv/other', rules)).toBe('/srv/other')
    expect(reverseMapPath('/anything/here', parsePathMap(undefined))).toBe('/anything/here')
  })
})
