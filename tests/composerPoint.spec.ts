/**
 * Unit tests for the bridge path's insertion-point resolution
 * (composerPoint.ts): the keyboard face must be invoked as a METHOD of the
 * input resolver (its receiver is load-bearing — the Lexical-era hub reads
 * `this.sessions()` inside), the DOM fallback only serves a displayed
 * session the registry can attest to, and every failure degrades to
 * "no point" (the caller's draft-tail append) instead of throwing.
 *
 * @module dsh-sidebar-vscode/tests/composerPoint.spec
 */

import { describe, expect, it } from 'vitest'
import { composerDisplayedFor, readComposerPoint } from '../src/client/composerPoint.ts'
import type { ConversationServiceFace, SessionInputFace } from '../src/client/references.ts'

/** The keyboard face's caret answer (detect span). */
function span (start: number, end: number): { start: number, end: number } {
  return { start, end }
}

/**
 * Build one conversation service whose input resolver exposes a keyboard
 * face as a real method reading its receiver (the hub's shape: the id
 * lookup goes through `this`, so a detached call loses it and throws).
 */
function conversationWithKeyboard (
  shells: Record<string, { caretSpan(): { start: number, end: number } }>,
  throwFor?: (sessionId: string) => boolean,
): ConversationServiceFace {
  const input = {
    for (): SessionInputFace {
      throw new Error('not under test')
    },
    keyboard (this: { shells: typeof shells }, sessionId: string) {
      if (throwFor?.(sessionId) === true) throw new Error('resolved no binding')
      const shell = this.shells[sessionId]
      if (shell === undefined) throw new Error('resolved no binding')
      return shell
    },
    shells,
  }
  return { input } as unknown as ConversationServiceFace
}

describe('readComposerPoint', () => {
  it('invokes the keyboard face as a method of the input resolver (receiver preserved)', () => {
    // Regression: a detached `const keyboard = input.keyboard; keyboard(id)`
    // call makes `this` undefined inside the hub's method — the resolution
    // threw, the DOM gate never opened, and every bridge landing fell to
    // the draft-tail append.
    const conversation = conversationWithKeyboard({ s1: { caretSpan: () => span(5, 5) } })
    const resolved = readComposerPoint(undefined, conversation, 's1')
    expect(resolved).toEqual({ point: { start: 5, end: 5 }, fromDom: false })
  })

  it('answers undefined without a session id', () => {
    const conversation = conversationWithKeyboard({ s1: { caretSpan: () => span(0, 0) } })
    expect(readComposerPoint(undefined, conversation, undefined)).toBeUndefined()
  })

  it('degrades to undefined when the keyboard face throws (no shell for the id) and the registry cannot attest a displayed session', () => {
    // The Lexical-era list snapshot carries no `current` field, so the DOM
    // gate stays closed and the caller appends at the draft tail.
    const sessions = { list: { getSnapshot: () => ({ ids: [], byId: {} }) } }
    const conversation = conversationWithKeyboard({}, () => true)
    expect(readComposerPoint(sessions, conversation, 's1')).toBeUndefined()
  })

  it('degrades to undefined when the host exposes no keyboard face and no displayed-session attestation', () => {
    const sessions = { list: { getSnapshot: () => ({ current: 'other' }) } }
    const conversation = { input: { for (): SessionInputFace { throw new Error('not under test') } } }
    expect(readComposerPoint(sessions, conversation as unknown as ConversationServiceFace, 's1')).toBeUndefined()
  })

  it('falls back to the displayed composer\'s DOM selection when the registry attests the displayed session', () => {
    // The legacy-host path: no keyboard face, but the list snapshot's
    // `current` names the addressed session, so the displayed surface's
    // selection is meaningful. The node test environment has no document,
    // so both document faces (the composerDom module's injectable one and
    // the textarea query's global) answer empty: the gate opened, the
    // surface read found nothing, and the resolution degrades to undefined
    // — the draft-tail append — without throwing.
    const globalScope = globalThis as { document?: unknown, HTMLTextAreaElement?: unknown }
    const savedDocument = globalScope.document
    const savedTextarea = globalScope.HTMLTextAreaElement
    globalScope.document = { querySelector: (): null => null }
    globalScope.HTMLTextAreaElement = class FakeTextarea {}
    try {
      const sessions = { list: { getSnapshot: () => ({ current: 's1' }) } }
      const conversation = { input: { for (): SessionInputFace { throw new Error('not under test') } } }
      expect(readComposerPoint(sessions, conversation as unknown as ConversationServiceFace, 's1')).toBeUndefined()
    } finally {
      globalScope.document = savedDocument
      globalScope.HTMLTextAreaElement = savedTextarea
    }
  })
})

describe('composerDisplayedFor', () => {
  it('matches the legacy list snapshot current field', () => {
    const sessions = { list: { getSnapshot: () => ({ current: 's1' }) } }
    expect(composerDisplayedFor(sessions, 's1')).toBe(true)
    expect(composerDisplayedFor(sessions, 's2')).toBe(false)
  })

  it('fails closed without a session id or a list snapshot', () => {
    expect(composerDisplayedFor(undefined, 's1')).toBe(false)
    expect(composerDisplayedFor({ list: undefined }, 's1')).toBe(false)
    expect(composerDisplayedFor({ list: { getSnapshot: () => ({}) } }, undefined)).toBe(false)
    expect(composerDisplayedFor({ list: { getSnapshot: () => ({ ids: [], byId: {} }) } }, 's1')).toBe(false)
  })
})
