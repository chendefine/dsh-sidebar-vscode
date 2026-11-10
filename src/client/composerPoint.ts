/**
 * The bridge path's insertion-point resolution: where a VS Code selection
 * that carries no explicit range of its own should land in the DSH composer
 * — the addressed session's live caret.
 *
 * Two host faces answer, in order:
 *
 * 1. The Lexical-era keyboard face — `conversation.input.keyboard(id)`
 *    answered by the input resolver — whose `caretSpan()` projects the
 *    editor's own (retained) selection into detect coordinates. Per-session
 *    correct, and the only face that can address a composer that is not the
 *    displayed one. CRITICAL: the face is a METHOD on the resolver, not a
 *    detached callback — the hub's `keyboard(id)` reads `this.sessions()`
 *    off its receiver — so it must be invoked with the resolver as `this`.
 *    A bare detached call throws in the bundle's strict mode ("Cannot read
 *    properties of undefined (reading 'shell')"), which is exactly the
 *    historical bug: every bridge landing silently degraded to the
 *    draft-tail append because BOTH the keyboard path threw and the DOM
 *    fallback's gate (a legacy-host list shape) never opened.
 *
 * 2. The displayed composer's DOM selection (the contenteditable mapping or
 *    the old textarea's selectionStart/End), gated on the sessions registry
 *    advertising that the addressed session IS the displayed one — the
 *    legacy textarea-era hosts whose list snapshot carried `current`. Only
 *    the displayed conversation's surface is meaningful there; hosts whose
 *    list shape carries no `current` (the Lexical era removed it — the
 *    keyboard face is their only per-session answer) fail the gate closed
 *    and the landing falls back to the draft tail.
 *
 * @module dsh-sidebar-vscode/client/composerPoint
 */

import type { ConversationServiceFace } from './references.ts'
import { readActiveComposerSelection } from './composer.tsx'

/**
 * The sessions-service face the displayed-composer gate reads: the legacy
 * list snapshot's `current` field (the displayed session id), absent on
 * Lexical-era hosts (whose snapshots carry only the catalog fields).
 */
export interface SessionsListFace {
  readonly list?: {
    getSnapshot(): {
      /** Legacy textarea-era hosts: the displayed session id. */
      current?: string
      /** Lexical-era catalog fields (present but irrelevant to the gate). */
      ids?: readonly string[]
      byId?: Readonly<Record<string, unknown>>
      phase?: string
    }
  }
}

/** One resolved composer point plus where it came from. */
export interface ComposerPoint {
  readonly point: { readonly start: number, readonly end: number }
  /**
   * True when the point was read off the displayed DOM surface (its caret
   * restore must therefore write that surface back; a machine-resolved
   * point leaves the editor's own post-insert selection alone).
   */
  readonly fromDom: boolean
}

/**
 * Whether the currently displayed conversation is the addressed session —
 * the gate for reading (and restoring) the displayed composer's caret on
 * its behalf: a composer showing another session holds another draft, so
 * its selection offsets would be meaningless for this landing. Legacy
 * textarea-era hosts answer through the list snapshot's `current` field;
 * hosts without it (the Lexical era) fail closed, their per-session answer
 * being the keyboard face instead.
 */
export function composerDisplayedFor(
  sessions: SessionsListFace | undefined,
  sessionId: string | undefined,
): boolean {
  if (sessionId === undefined) return false
  return sessions?.list?.getSnapshot().current === sessionId
}

/**
 * The addressed session's live composer caret, in the plane the machine
 * addresses edits in — the bridge path's insertion point.
 *
 * Lexical hosts answer through the input resolver's keyboard face
 * (`conversation.input.keyboard(id).caretSpan()`): the editor's own
 * selection projection — per-session correct, and retained through focus
 * loss into the VS Code iframe (the editor state keeps the last caret; an
 * absent selection answers the document end by the face's contract, which
 * is the right landing point for a never-focused composer). Hosts without
 * the face fall back to the DOM selection of the displayed composer (the
 * modern contenteditable mapping, or the old textarea), gated on the
 * displayed session matching.
 *
 * @param sessions - the sessions service (the legacy displayed-session gate).
 * @param conversation - the conversation service (the input resolver).
 * @param sessionId - the addressed session.
 * @returns the resolved point, or undefined when no face could answer (the
 * caller then appends at the draft tail).
 */
export function readComposerPoint(
  sessions: SessionsListFace | undefined,
  conversation: ConversationServiceFace | undefined,
  sessionId: string | undefined,
): ComposerPoint | undefined {
  if (sessionId === undefined) return undefined
  const input = conversation?.input
  const keyboard = input?.keyboard
  if (input !== undefined && keyboard !== undefined) {
    try {
      // Invoke the face as the METHOD it is, with the resolver as `this`
      // (see the module doc): a detached `keyboard(id)` call loses the
      // receiver and throws inside the hub before it can ever reach a
      // shell.
      return { point: keyboard.call(input, sessionId).caretSpan(), fromDom: false }
    } catch {
      // No shell for the id (a never-displayed session): fall through to
      // the displayed-surface gate.
    }
  }
  if (!composerDisplayedFor(sessions, sessionId)) return undefined
  const fromSurface = readActiveComposerSelection()
  return fromSurface === undefined ? undefined : { point: fromSurface, fromDom: true }
}
