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
import { type ClipboardPayload } from './selection.ts';
/**
 * The bridge's payload sink: receives every decoded envelope payload and
 * reports (sync or async) whether it was actually delivered to the DSH
 * composer. `true` preserves the user's clipboard; `false` (or a throw /
 * rejection) falls back to writing the envelope's readable part.
 */
export type ClipboardPayloadSink = (payload: ClipboardPayload) => boolean | Promise<boolean>;
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
export declare function installClipboardBridge(iframe: HTMLIFrameElement, onPayload: ClipboardPayloadSink): () => void;
