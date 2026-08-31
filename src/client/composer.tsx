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
  type InsertOutcome,
  type OccurrenceLike,
  type PasteLandingOutcome,
  type RefRemovalOutcome,
  type RecoveredPastePart,
  type ReferenceInsertLike,
} from './references.ts'
import { parseClipboardEnvelope, type ClipboardPayload } from './selection.ts'
import {
  readComposerSelectionDetect,
  restoreComposerCaretDetect,
} from './composerDom.ts'
import { t } from './i18n.ts'
import { FileRefIcon, FolderRefIcon, XIcon } from './icons.tsx'

/** Options kept fresh by the VSCode tab render (paste fallback path). */
export interface FallbackOptions {
  readonly reverseRules?: readonly { from: string, to: string }[]
  readonly cwd?: string
  readonly maxLines?: number
  readonly maxBytes?: number
}

/**
 * Land one decoded payload's reference chips on the addressed session.
 * Implemented by the plugin body (which owns the service context) and handed
 * in through the slot's inject face. The payload can be an editor selection
 * or an explorer file/folder list. `at` is the range the chips replace
 * (usually the composer caret), in the plane the addressed composer's
 * selection speaks — detect coordinates on Lexical hosts, draft coordinates
 * on textarea-era ones; when omitted the implementation resolves the
 * insertion point itself — the displayed composer's caret for the addressed
 * session, else the draft tail.
 */
export type ReferenceLander = (
  sessionId: string | undefined,
  payload: ClipboardPayload,
  options: FallbackOptions,
  at?: { readonly start: number, readonly end: number },
) => Promise<InsertOutcome>

/**
 * Land one parsed mention-carrying paste on the addressed session at the
 * paste selection. Implemented by the plugin body beside the lander.
 */
export type MentionPaster = (
  sessionId: string | undefined,
  parts: readonly RecoveredPastePart[],
  selection: { start: number, end: number },
) => Promise<PasteLandingOutcome>

/**
 * Remove every chip citing one reference from the addressed session's
 * draft (the rail's close affordance). Implemented by the plugin body;
 * the outcome tells the dock whether the chip-preserving path worked or
 * the legacy whole-draft splice must run instead.
 */
export type ReferenceRemover = (
  sessionId: string | undefined,
  ref: string,
) => Promise<RefRemovalOutcome>

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

// ---- rail stylesheet ----

/** Idempotency id of the injected rail <style> element. */
const RAIL_STYLE_ID = 'dsh-sidebar-vscode-composer-css'

/**
 * The rail's stylesheet. Class names carry the `dsh_vscodeRef_` prefix; the
 * rules follow the composer's reference-chip geometry (rail layout, 28px
 * pill rows, 13px labels, 20px round remove button) using the host's
 * `--dsw-alias-*` design tokens and `--dsh-composer-*` layout variables.
 * The two extra rules (`[data-invalid='true']`) render this plugin's
 * lost-owner state.
 */
const RAIL_CSS = `
.dsh_vscodeRef_rail {
  box-sizing: border-box;
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 6px;
  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance));
  max-width: var(--dsh-composer-card-max-width);
  min-width: 0;
  margin: 0 auto;
}
.dsh_vscodeRef_row {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  height: 28px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_vscodeRef_row[data-invalid='true'] {
  opacity: 0.55;
}
.dsh_vscodeRef_row[data-invalid='true'] .dsh_vscodeRef_path {
  text-decoration: line-through;
}
.dsh_vscodeRef_path {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 360px;
  height: 100%;
  padding: 0 6px 0 10px;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh_vscodeRef_icon {
  flex: none;
  width: 14px;
  height: 14px;
}
.dsh_vscodeRef_text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh_vscodeRef_remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  margin-right: 4px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--dsw-alias-label-dimmed);
  cursor: pointer;
}
.dsh_vscodeRef_remove svg {
  width: 12px;
  height: 12px;
}
.dsh_vscodeRef_remove:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
`

/**
 * Idempotently install the rail stylesheet into `document.head`. Tokens and
 * layout variables are host globals, so the stylesheet stands alone.
 * @returns a disposer that removes the element (safe to call twice).
 */
export function adoptRailStyles(): () => void {
  const existing = document.getElementById(RAIL_STYLE_ID)
  if (existing !== null) {
    const node = existing
    return () => { node.remove() }
  }
  const style = document.createElement('style')
  style.id = RAIL_STYLE_ID
  style.dataset.plugin = 'dsh-sidebar-vscode'
  style.dataset.pluginCss = RAIL_STYLE_ID
  style.textContent = RAIL_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
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
      // contenteditable (`[data-composer-input]`) on current ones. The
      // contenteditable check goes through the element chain — the paste
      // target may be a text node or a chip's decorator span inside it.
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
          const outcome = await lander(sessionId, payload, fallbackOptions, selection)
          if (outcome.caret !== undefined) {
            const caret = outcome.caret
            // One frame out: the editor's own value settles first.
            if (el !== null) requestAnimationFrame(() => { el.setSelectionRange(caret, caret) })
            else restoreComposerCaretDetect(caret)
          }
        })()
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
        const outcome: PasteLandingOutcome = await pasteMentions(sessionId, recovered.parts, selection)
        if (outcome.caret !== undefined) {
          const caret = outcome.caret
          // One frame out: the editor's own value settles first.
          if (el !== null) requestAnimationFrame(() => { el.setSelectionRange(caret, caret) })
          else restoreComposerCaretDetect(caret)
        }
      })()
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

/** Module-level paste-fallback options (set by the plugin body / tab render). */
let fallbackOptions: FallbackOptions = {}

/** Refresh the paste-fallback options (VSCode tab render path). */
export function setFallbackOptions(options: FallbackOptions): void {
  fallbackOptions = options
}

/** Module-level lander handle (set by the plugin body; cleared on dispose). */
let lander: ReferenceLander | undefined

/** Install the module-level lander handle (plugin body). */
export function setReferenceLander(instance: ReferenceLander | undefined): void {
  lander = instance
}

/** The lander installed by the plugin body (undefined before apply). */
export function getReferenceLander(): ReferenceLander | undefined {
  return lander
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
