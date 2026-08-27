/**
 * Composer dock: the reference rail and the paste fallbacks — the DSH-side
 * landing of VS Code selections that did not come through the iframe bridge.
 *
 * The rail projects the input machine's occurrence table (`input.occurrences`,
 * refreshed on every machine change) into one closable tag per distinct
 * vscode-selection reference. Closing a tag removes every chip citing that
 * reference from the draft through `inputActions.setDraft` — the machine's
 * diff-scan reconciles the occurrence table, and once no canonical mention
 * remains in the draft there is nothing for the host boundary to inject.
 *
 * Two paste fallbacks cover what the bridge cannot: a clipboard envelope
 * (cross-origin or standalone editor windows) pasted into the composer
 * textarea decodes back into the same reference chips the bridge path
 * produces — landing at the paste caret, like any paste — and a copied
 * reference item — the `@ [ label ]( dsh-vscode: … )` text a rendered chip
 * yields on copy, mangled or canonical — is recovered into chips at the
 * caret with its surrounding prose kept verbatim.
 *
 * @module dsh-sidebar-vscode/client/composer
 */

import { useEffect } from 'react'
import {
  groupRailTags,
  parseRecoveredPaste,
  pasteRecoveredMentions,
  removeRefRanges,
  type InsertOutcome,
  type OccurrenceLike,
  type PasteLandingOutcome,
  type RecoveredPastePart,
  type ReferenceInsertLike,
} from './references.ts'
import { parseClipboardEnvelope, type ClipboardPayload } from './selection.ts'
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
 * or an explorer file/folder list. `at` is the draft range the chips replace
 * (usually the composer caret); when omitted the implementation resolves the
 * insertion point itself — the displayed composer's caret for the addressed
 * session, else the draft tail — and owns the post-landing caret restore.
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

/** Props of the dock component (framework session kit + inject face). */
interface ComposerDockProps {
  sessionId: string
  input: {
    readonly draft: string
    readonly occurrences: readonly OccurrenceLike[]
  }
  inputActions: { setDraft(text: string): void }
  lander: ReferenceLander
  pasteMentions: MentionPaster
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
  const { sessionId, input, inputActions, lander, pasteMentions } = props
  const tags = groupRailTags(input.occurrences)

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (event.defaultPrevented) return
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement)) return
      const clipboard = event.clipboardData
      if (clipboard === null) return
      // File-carrying pastes belong to the composer's image intake.
      if (clipboard.items !== undefined && clipboard.items.length > 0
        && Array.from(clipboard.items).some(item => item.kind === 'File')) return
      const text = clipboard.getData('text/plain')
      if (text === '') return

      /**
       * A handled paste is swallowed whole: preventDefault alone does NOT
       * stop the composer's React onPaste (it machine-pastes the raw text,
       * duplicating whatever this handler lands), so the capture-phase
       * stopPropagation keeps that handler from firing at all — verified
       * against React 18's root delegation.
       */
      const swallow = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      // Fallback 1: the clipboard envelope (standalone editor windows).
      // The envelope lands at the paste selection like any paste — not the
      // draft tail — because the target still holds its pre-edit caret.
      const payload = parseClipboardEnvelope(text)
      if (payload !== null) {
        swallow()
        const el = target
        const selection = {
          start: target.selectionStart ?? 0,
          end: target.selectionEnd ?? target.selectionStart ?? 0,
        }
        void (async () => {
          const outcome = await lander(sessionId, payload, fallbackOptions, selection)
          if (outcome.caret !== undefined) {
            const caret = outcome.caret
            // One frame out: the controlled textarea's value propagates first.
            requestAnimationFrame(() => { el.setSelectionRange(caret, caret) })
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
      const selection = {
        start: target.selectionStart ?? 0,
        end: target.selectionEnd ?? target.selectionStart ?? 0,
      }
      const el = target
      void (async () => {
        const outcome: PasteLandingOutcome = await pasteMentions(sessionId, recovered.parts, selection)
        if (outcome.caret !== undefined) {
          const caret = outcome.caret
          // One frame out: the controlled textarea's value propagates first.
          requestAnimationFrame(() => { el.setSelectionRange(caret, caret) })
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
              inputActions.setDraft(removeRefRanges(input.draft, input.occurrences, tag.ref))
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

/** Locate the displayed conversation's composer textarea, when addressable. */
function activeComposerTextarea(): HTMLTextAreaElement | null {
  const el = document.querySelector('[data-composer-card] textarea')
  return el instanceof HTMLTextAreaElement && !el.disabled ? el : null
}

/**
 * Read the displayed composer's selection — the user's last caret or range,
 * which a textarea keeps through focus loss into the VS Code iframe.
 * Undefined whenever the composer is absent or not addressable; the caller
 * then falls back to the draft tail.
 */
export function readActiveComposerSelection(): { start: number, end: number } | undefined {
  const el = activeComposerTextarea()
  if (el === null) return undefined
  const start = el.selectionStart
  if (start === null) return undefined
  return { start, end: el.selectionEnd ?? start }
}

/**
 * Restore the displayed composer's caret after an external landing. One
 * frame out — the controlled textarea's value propagates first. Selection
 * only, never focus: the user's focus stays wherever they were working
 * (typically inside the VS Code iframe).
 */
export function restoreActiveComposerCaret(caret: number): void {
  if (activeComposerTextarea() === null) return
  requestAnimationFrame(() => {
    const el = activeComposerTextarea()
    if (el !== null) el.setSelectionRange(caret, caret)
  })
}

/** Re-export for the plugin body's slot inject face typing. */
export type { ReferenceInsertLike }
