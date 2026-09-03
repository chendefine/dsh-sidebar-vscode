/**
 * The turn-tail takeover (research option II): this plugin registers the
 * `conversation.chat.turnTail` slot at priority -2 — BEFORE
 * dsh-better-sidebar's own -1 entry — and claims the produced-files row
 * (the "changed files" chips at the end of a turn) with the same
 * `selectProducedFiles` derivation. The rendered row is a visual twin of
 * better-sidebar's, but the chips open the file in THIS plugin's VSCode tab
 * instead of the built-in editor tab.
 *
 * When the gate declines (the `openAsDefault` switch off, the VSCode tab
 * type disabled, or the turn produced nothing) the select returns null and
 * the chain falls through untouched — better-sidebar's -1 entry, then the
 * default deliverables row — so switch-off keeps the stock behavior.
 *
 * Per-chip routing honors the open blocklist (openBlocklist.ts): a chip
 * whose path is blocked reroutes into better-sidebar's built-in Files tab
 * (its file viewers render the Office/image/PDF types the code editor
 * shows poorly). When that reroute declines — the Files tab type disabled
 * in the side card settings — the chip degrades to the render site's own
 * stock `openFile` (carried on the matched value), and finally to the
 * VSCode open (never a dead chip).
 *
 * The slot is a CHILD slot the host's ui-conversation declares in its
 * `conversation.chat.node` children table (kind: chain, scope: session).
 * Registering it directly races the declaration — the ui-slots core's
 * load-time validation throws "not declared (a parent entry's children
 * table must declare it)" when the parent entry is not on the ledger yet.
 * slots.inject waits for the declaration (mirrors better-sidebar's
 * registration of the same slot).
 *
 * @module dsh-sidebar-vscode/client/turnTail
 */

import type { ReactNode } from 'react'
import { makeTurnTailSelect, type TurnTailMatch } from './producedFiles.ts'
import { t } from './i18n.ts'

/** Idempotency id of the injected turn-tail <style> element. */
const TURN_TAIL_STYLE_ID = 'dsh-sidebar-vscode-turn-tail-css'

/**
 * The chips row's stylesheet — a visual twin of better-sidebar's produced
 * row (its sidebar.module.css `.producedRow` family), namespaced under this
 * plugin's prefix and driven by the same host `--dsw-alias-*` tokens.
 */
const TURN_TAIL_CSS = `
.dsh_vscodeTurnTail_row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0;
}
.dsh_vscodeTurnTail_label {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeTurnTail_chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
  overflow: hidden;
}
.dsh_vscodeTurnTail_chip:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeTurnTail_chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh_vscodeTurnTail_more {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
`

/** Idempotently install the row stylesheet into `document.head`. */
export function adoptTurnTailStyles(): () => void {
  const existing = document.getElementById(TURN_TAIL_STYLE_ID)
  if (existing !== null) {
    const node = existing
    return () => { node.remove() }
  }
  const style = document.createElement('style')
  style.id = TURN_TAIL_STYLE_ID
  style.dataset.plugin = 'dsh-sidebar-vscode'
  style.dataset.pluginCss = TURN_TAIL_STYLE_ID
  style.textContent = TURN_TAIL_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** The chip's small code glyph (an inline twin of the primitives' outline icon). */
function CodeGlyph(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The file name of a path (both separators). */
function baseNameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** The chip's ×-style small glyph for a stock-opened (blocked) file. */
function DocGlyph(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 2h6L12.5 5v9h-9V2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9 2v3.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

/** The intercepted produced-files row (visual twin of the deliverables chips). */
export function TurnTailProducedFiles(props: {
  matched: TurnTailMatch
  openInVscode: (path: string) => void
  /** The open blocklist verdict (per click): a blocked path reroutes into
   * the built-in Files tab first (openInFiles), degrading to the stock
   * `matched.openFile` when that declines — else to the VSCode open
   * (never a dead chip). */
  isBlocked: (path: string) => boolean
  /** Reroute one blocked path into better-sidebar's built-in Files tab.
   * Returns whether the reroute landed (false = the tab type is disabled
   * in the side card settings and the click must degrade). */
  openInFiles: (path: string) => boolean
}): ReactNode {
  const { matched, openInVscode, isBlocked, openInFiles } = props
  const shown = matched.paths.slice(0, 6)
  const hidden = matched.paths.length - shown.length
  return (
    <div className="dsh_vscodeTurnTail_row">
      <span className="dsh_vscodeTurnTail_label">{t('produced')}</span>
      {shown.map(path => {
        const blocked = isBlocked(path)
        return (
          <button
            key={path}
            type="button"
            className="dsh_vscodeTurnTail_chip"
            title={blocked ? t('producedOpenFiles') : t('producedOpen')}
            onClick={() => {
              if (!blocked) {
                openInVscode(path)
                return
              }
              // Blocked: the built-in Files tab first (the viewer surface
              // for this type), the stock openFile funnel when it refuses,
              // and the VSCode open as the last resort — never a dead chip.
              if (openInFiles(path)) return
              if (matched.openFile !== undefined) {
                matched.openFile(path)
                return
              }
              openInVscode(path)
            }}
          >
            {blocked ? <DocGlyph /> : <CodeGlyph />}
            <span>{baseNameOf(path)}</span>
          </button>
        )
      })}
      {hidden > 0 && <span className="dsh_vscodeTurnTail_more">+{hidden}</span>}
    </div>
  )
}

/** The slots service slice the registration touches (structural). */
export interface TurnTailSlotsFace {
  inject(key: string, callback: () => () => void): () => void
  register(options: {
    name: string
    priority?: number
    registrant?: string
    select?: (owner: unknown) => unknown
    inject?: (sessionId: string) => Record<string, unknown>
  }, component: unknown): () => void
}

/**
 * Register the turn-tail takeover (returns the disposer).
 *
 * @param slots - the client slots service.
 * @param takeoverEnabled - the gate (the openAsDefault switch AND the VSCode
 * tab type enabled — evaluated per render/claim, so flipping the switch
 * applies to the next row render).
 * @param openInVscode - the chip click handler (reroutes into the VSCode tab).
 * @param isBlocked - the open blocklist verdict per path (a blocked chip
 * reroutes into the built-in Files tab instead).
 * @param openInFiles - the blocklist-hit reroute (better-sidebar's built-in
 * Files tab); returns whether it landed, so a refusal degrades the click to
 * the stock `matched.openFile` (and then the VSCode open).
 */
export function registerTurnTailVscode(
  slots: TurnTailSlotsFace,
  takeoverEnabled: () => boolean,
  openInVscode: (sessionId: string, path: string) => void,
  isBlocked: (path: string) => boolean = () => false,
  openInFiles: (sessionId: string, path: string) => boolean = () => false,
): () => void {
  return slots.inject('conversation.chat.turnTail', () => slots.register({
    name: 'conversation.chat.turnTail',
    // -2: before dsh-better-sidebar's -1 entry (same slot), so the chips
    // route here while enabled; a decline falls through to its row.
    priority: -2,
    registrant: 'dsh-sidebar-vscode',
    select: makeTurnTailSelect(takeoverEnabled),
    inject: (sessionId: string) => ({
      openInVscode: (path: string) => { openInVscode(sessionId, path) },
      isBlocked,
      openInFiles: (path: string) => openInFiles(sessionId, path),
    }),
  }, TurnTailProducedFiles))
}
