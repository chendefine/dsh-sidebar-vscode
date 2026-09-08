/**
 * Composer dock: the reference rail and the paste fallbacks — the DSH-side
 * landing of VS Code selections that did not come through the iframe bridge.
 *
 * The rail projects the input machine's occurrence table (`input.occurrences`,
 * refreshed on every machine change) into one closable tag per distinct
 * vscode-selection reference. Closing a tag removes every chip citing that
 * reference from the draft — on Lexical hosts through the injected
 * chip-preserving removal (span-addressed consume-token transactions; see
 * `removeVscodeReferences`), falling back to the whole-draft `setDraft`
 * splice only where the inject face is absent.
 *
 * Two paste fallbacks cover what the bridge cannot: a clipboard envelope
 * (cross-origin or standalone editor windows) pasted into the composer
 * decodes back into the same reference chips the bridge path produces —
 * landing at the paste caret, like any paste — and a copied reference item
 * — the `@ [ label ]( dsh-vscode: … )` text a rendered chip yields on
 * copy, mangled or canonical — is recovered into chips at the caret with
 * its surrounding prose kept verbatim. Both address the modern
 * contenteditable composer (`div[data-composer-input]`, detect-coordinate
 * selection via the composer DOM mapping) and the textarea-era one alike.
 *
 * @module dsh-sidebar-vscode/client/composer
 */

import { useEffect } from 'react'
import {
  groupRailTags,
  parseRecoveredPaste,
  removeRefRanges,
  type OccurrenceLike,
  type ReferenceInsertLike,
} from './references.ts'
import { parseClipboardEnvelope } from './selection.ts'
import {
  getFallbackOptions,
  type FallbackOptions,
  type MentionPaster,
  type ReferenceLander,
  type ReferenceRemover,
} from './referencePipeline.ts'
import {
  readComposerSelectionDetect,
  restoreComposerCaretDetect,
} from './composerDom.ts'
import { t } from './i18n.ts'
import { FileRefIcon, FolderRefIcon, XIcon } from './icons.tsx'

// The pipeline handle types are re-exported for the plugin body and the
// tab (they live in referencePipeline.ts now — one typed home).
export type { FallbackOptions, MentionPaster, ReferenceLander, ReferenceRemover }

/** Props of the dock component (framework session kit + inject face). */
interface ComposerDockProps {
  /** The addressed session (the modern session-scoped dock owner prop). */
  session?: { readonly sessionId?: string }
  /** Legacy dock props carried the bare id; kept for old hosts. */
  sessionId?: string
  input: {
    readonly draft: string
    readonly occurrences: readonly OccurrenceLike[]
  }
  inputActions: { setDraft(text: string): void }
  lander: ReferenceLander
  pasteMentions: MentionPaster
  removeRef?: ReferenceRemover
}

/**
 * The dock entry: renders the reference rail over the live occurrence table
 * and runs the paste fallbacks.
 */
export function ComposerDock(props: ComposerDockProps): React.ReactNode {
  const { session, sessionId: legacySessionId, input, inputActions, lander, pasteMentions, removeRef } = props
  const sessionId = session?.sessionId ?? legacySessionId
  const tags = groupRailTags(input.occurrences)

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (event.defaultPrevented) return
      const target = event.target
      // The composer surface: a textarea on old hosts, the Lexical
      // contenteditable (`[data-composer-input]`) on current ones. Paste
      // events target the FOCUSED element (an Element), and the check goes
      // through its ancestor chain — a chip's decorator span inside the
      // editable still qualifies. (A text-node target would not pass the
      // instanceof gate, but browsers do not report one here.)
      const textarea = target instanceof HTMLTextAreaElement ? target : null
      const editableHit = textarea === null && target instanceof Element
        && target.closest('[data-composer-input]') !== null
        && target.closest('[contenteditable="true"]') !== null
      if (!editableHit && textarea === null) return
      const clipboard = event.clipboardData
      if (clipboard === null) return
      // File-carrying pastes belong to the composer's image intake.
      if (clipboard.items !== undefined && clipboard.items.length > 0
        && Array.from(clipboard.items).some(item => item.kind === 'File')) return
      const text = clipboard.getData('text/plain')
      if (text === '') return

      /**
       * A handled paste is swallowed whole: preventDefault alone does NOT
       * stop the composer's own paste handling (the Lexical root element
       * listens in the bubble phase; the old textarea world delegated
       * through React), so the capture-phase stopPropagation keeps every
       * downstream listener from firing at all.
       */
      const swallow = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      /** The paste landing point in the plane the surface speaks. */
      const selection = textarea !== null
        ? {
            start: textarea.selectionStart ?? 0,
            end: textarea.selectionEnd ?? textarea.selectionStart ?? 0,
          }
        : readComposerSelectionDetect() ?? { start: 0, end: 0 }

      // Fallback 1: the clipboard envelope (standalone editor windows).
      // The envelope lands at the paste selection like any paste — not the
      // draft tail — because the surface still holds its pre-edit caret.
      const payload = parseClipboardEnvelope(text)
      if (payload !== null) {
        swallow()
        const el = textarea
        void (async () => {
          const outcome = await lander(sessionId, payload, getFallbackOptions(), selection)
          if (outcome.caret !== undefined) {
            const caret = outcome.caret
            // One frame out: the editor's own value settles first.
            if (el !== null) requestAnimationFrame(() => { el.setSelectionRange(caret, caret) })
            else restoreComposerCaretDetect(caret)
          }
        })().catch(() => {
          // A throwing service face (scope resolution, the lander wrapper):
          // the paste was already swallowed; do not leave an unhandled
          // rejection on top of the lost landing.
        })
        return
      }

      // Fallback 2: mention copies (whitespace-mangled or canonical) pasted
      // back from a rendered chip — recovered into atomic chips at the caret,
      // surrounding prose preserved.
      const recovered = parseRecoveredPaste(text)
      if (recovered === null) return
      swallow()
      const el = textarea
      void (async () => {
        const outcome = await pasteMentions(sessionId, recovered.parts, selection)
        if (outcome.caret !== undefined) {
          const caret = outcome.caret
          // One frame out: the editor's own value settles first.
          if (el !== null) requestAnimationFrame(() => { el.setSelectionRange(caret, caret) })
          else restoreComposerCaretDetect(caret)
        }
      })().catch(() => {
        // Same fail-soft as the envelope arm above.
      })
    }
    document.addEventListener('paste', onPaste, true)
    return () => {
      document.removeEventListener('paste', onPaste, true)
    }
  }, [lander, pasteMentions, sessionId])

  if (tags.length === 0) return null
  return (
    <div
      className="dsh_vscodeRef_rail"
      role="group"
      aria-label={t('railReferences')}
      data-vscode-reference-dock
    >
      {tags.map(tag => (
        <span
          key={tag.ref}
          className="dsh_vscodeRef_row"
          data-vscode-reference={tag.ref}
          data-invalid={tag.invalid ? 'true' : undefined}
        >
          <span className="dsh_vscodeRef_path" title={tag.label}>
            {tag.folder ? <FolderRefIcon /> : <FileRefIcon />}
            <span className="dsh_vscodeRef_text">
              {tag.truncated ? '… ' : ''}{tag.label}
              {tag.count > 1 ? ` ×${tag.count}` : ''}
            </span>
          </span>
          <button
            type="button"
            className="dsh_vscodeRef_remove"
            aria-label={`${t('removeReference')}: ${tag.label}`}
            onClick={() => {
              // Chip-preserving removal first (Lexical hosts): a whole-draft
              // setDraft write would flatten every remaining chip to raw
              // mention text. The legacy splice stays as the fallback — for
              // hosts without the injected remover AND for a remover that
              // could not resolve the session at all.
              const legacySplice = (): void => {
                inputActions.setDraft(removeRefRanges(input.draft, input.occurrences, tag.ref))
              }
              if (removeRef === undefined) {
                legacySplice()
                return
              }
              void removeRef(sessionId, tag.ref).then(outcome => {
                if (outcome.removed === 0 && outcome.degraded) legacySplice()
              }, () => { legacySplice() })
            }}
          >
            <XIcon />
          </button>
        </span>
      ))}
    </div>
  )
}

// ---- the displayed composer's caret (the bridge path's insertion point) ----

/** Locate the textarea-era composer's textarea, when one is displayed. */
function activeComposerTextarea(): HTMLTextAreaElement | null {
  const el = document.querySelector('[data-composer-card] textarea')
  return el instanceof HTMLTextAreaElement && !el.disabled ? el : null
}

/**
 * Read the displayed composer's selection — the user's last caret or range,
 * which the surface keeps through focus loss into the VS Code iframe — in
 * the coordinates the displayed surface speaks: detect-projection offsets
 * for the modern contenteditable (see composerDom), draft offsets for the
 * textarea-era composer. Undefined whenever the composer is absent, inert,
 * or holds no addressable selection; the caller then falls back to the
 * draft tail.
 */
export function readActiveComposerSelection(): { start: number, end: number } | undefined {
  const fromEditable = readComposerSelectionDetect()
  if (fromEditable !== undefined) return fromEditable
  const el = activeComposerTextarea()
  if (el === null) return undefined
  const start = el.selectionStart
  if (start === null) return undefined
  return { start, end: el.selectionEnd ?? start }
}

/**
 * Restore the displayed composer's caret after an external landing. One
 * frame out — the editor's own commit settles first. Selection only, never
 * focus: the user's focus stays wherever they were working (typically
 * inside the VS Code iframe). Covers both surfaces: the contenteditable
 * mapping (a no-op without one) and the textarea's setSelectionRange.
 */
export function restoreActiveComposerCaret(caret: number): void {
  restoreComposerCaretDetect(caret) // no-ops without a contenteditable
  const el = activeComposerTextarea()
  if (el !== null) requestAnimationFrame(() => { el.setSelectionRange(caret, caret) })
}

/** Re-export for the plugin body's slot inject face typing. */
export type { ReferenceInsertLike }
