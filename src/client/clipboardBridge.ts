/**
 * The clipboard signal bridge: turns the embedded VS Code workbench's
 * clipboard writes into a structured channel back into DSH.
 *
 * Why this works: the VSCode tab's iframe loads the VS Code server from the
 * same gateway origin (the `/vscode` subpath), so this plugin — running in the
 * top window — has full same-origin access to the iframe's window. And the
 * extension-host clipboard chain is
 *
 *   vscode.env.clipboard.writeText(text)        [node ext host, container]
 *     → MainThreadClipboard.$writeText          [renderer, workbench window]
 *     → BrowserClipboardService.writeText
 *     → await navigator.clipboard.writeText(t)  [late-bound property lookup]
 *
 * so replacing `writeText` on the workbench window's
 * `navigator.clipboard` intercepts every extension-originated text write.
 * Writes NOT carrying our envelope marker pass through untouched.
 *
 * When the write IS an envelope (`@@DSH_REF::<base64url>::…`, see
 * selection.ts): the payload is decoded and handed to the callback, whose
 * return value reports whether it reached the composer. On delivery the
 * write is swallowed whole — the user's clipboard keeps whatever it held
 * (sending a selection must not clobber it). Only when delivery fails does
 * the human-readable remainder land on the real clipboard as a
 * manual-paste fallback (best effort — clipboard writes need transient
 * user activation and may reject; nothing depends on it).
 *
 * Cross-origin editor URLs (the `serverUrl` setting pointing at another
 * origin) cannot be bridged — reading `navigator` off a cross-origin
 * window proxy throws SecurityError, which the install call catches and
 * turns into a no-op disposer, leaving the composer-side paste fallback
 * as the only path.
 *
 * @module dsh-sidebar-vscode/client/clipboardBridge
 */

import {
  envelopeReadablePart,
  parseClipboardEnvelope,
  type ClipboardPayload,
} from './selection.ts'

/** Structural face of the workbench window the bridge touches. */
interface BridgeWindow {
  readonly navigator: {
    readonly clipboard?: {
      writeText?: (text: string, ...rest: unknown[]) => Promise<void>
    }
  }
}

/**
 * The bridge's payload sink: receives every decoded envelope payload and
 * reports (sync or async) whether it was actually delivered to the DSH
 * composer. `true` preserves the user's clipboard; `false` (or a throw /
 * rejection) falls back to writing the envelope's readable part.
 */
export type ClipboardPayloadSink = (payload: ClipboardPayload) => boolean | Promise<boolean>

/**
 * Patch `navigator.clipboard.writeText` inside the iframe's workbench
 * window so envelope-carrying writes signal this plugin.
 *
 * @param iframe - the VSCode tab's iframe element (already loaded).
 * @param onPayload - receives every decoded payload (selection or resource);
 * a `true` result swallows the write (clipboard preserved), a `false`
 * result / throw / rejection writes the readable fallback instead.
 * @returns the disposer (restores the original method; safe to call twice).
 */
export function installClipboardBridge(
  iframe: HTMLIFrameElement,
  onPayload: ClipboardPayloadSink,
): () => void {
  let win: BridgeWindow | null = null
  try {
    win = iframe.contentWindow as unknown as BridgeWindow | null
  } catch {
    return () => {}
  }
  // Reading any property beyond the sanctioned few off a CROSS-ORIGIN
  // window proxy (`navigator` included) throws SecurityError — optional
  // chaining only short-circuits null/undefined, never throws — so the
  // lookup itself must be guarded. The bridge is same-origin-only by
  // design; a cross-origin workbench (a full-URL `serverUrl` on another
  // origin) degrades to the no-op disposer here instead of crashing the
  // tab: the composer-side paste fallback remains the delivery path.
  let clip: BridgeWindow['navigator']['clipboard'] | undefined
  try {
    clip = win?.navigator?.clipboard
  } catch {
    return () => {}
  }
  if (win === null || clip === undefined || typeof clip.writeText !== 'function') {
    return () => {}
  }

  let disposed = false
  const target = clip as { writeText?: (text: string, ...rest: unknown[]) => Promise<void> }
  const hadOwn = Object.prototype.hasOwnProperty.call(target, 'writeText')
  const previous = target.writeText
  const original = (clip.writeText as (text: string, ...rest: unknown[]) => Promise<void>).bind(clip)

  const patched = (text: string, ...rest: unknown[]): Promise<void> => {
    if (disposed || typeof text !== 'string') return original(text, ...rest)
    const payload = parseClipboardEnvelope(text)
    if (payload === null) return original(text, ...rest)
    let delivered: boolean | Promise<boolean> = false
    try {
      delivered = onPayload(payload)
    } catch (error) {
      console.error('[dsh-sidebar-vscode] selection payload handler failed:', error)
    }
    return Promise.resolve(delivered).catch((error) => {
      console.error('[dsh-sidebar-vscode] selection payload handler rejected:', error)
      return false
    }).then((ok) => {
      // Delivered to the composer: swallow the write entirely so the user's
      // clipboard keeps whatever it held.
      if (ok) return
      const readable = envelopeReadablePart(text)
      if (readable.trim() === '') return
      // Delivery failed: fall back to the human-readable snippet landing on
      // the clipboard for a manual paste. Best effort — a rejection here (no
      // transient activation) must not break the chain.
      return original(readable).then(() => {}, () => {})
    })
  }

  try {
    target.writeText = patched
  } catch {
    return () => {}
  }

  return () => {
    if (disposed) return
    disposed = true
    try {
      if (hadOwn && previous !== undefined) {
        target.writeText = previous
      } else {
        delete target.writeText
      }
    } catch {
      // The window died with the iframe — nothing to restore.
    }
  }
}
