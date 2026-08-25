/**
 * Unit tests for the clipboard signal bridge's write policy: an
 * envelope-carrying write must reach the real clipboard ONLY as a failure
 * fallback — a delivered payload (the normal in-sidebar path) preserves the
 * user's clipboard untouched.
 *
 * @module dsh-sidebar-vscode/tests/clipboardBridge.spec
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installClipboardBridge } from '../src/client/clipboardBridge.ts'
import {
  SELECTION_MARKER,
  encodeEnvelopePayload,
  type SelectionPayload,
} from '../src/client/selection.ts'

/** Fixture payload the envelope carries. */
function payload (): SelectionPayload {
  return {
    path: '/data/workspace/code/app/src/main.ts',
    relative: 'app/src/main.ts',
    language: 'typescript',
    spans: [{ startLine: 10, endLine: 11, text: 'const a = 1\nconst b = 2' }],
  }
}

const READABLE = '@app/src/main.ts L10-L11:\n```typescript\nconst a = 1\nconst b = 2\n```'
const ENVELOPE = `${SELECTION_MARKER}${encodeEnvelopePayload(payload())}::\n${READABLE}`

/**
 * A fake iframe: contentWindow.navigator.clipboard.writeText records every
 * call (the "real clipboard" face) and resolves.
 */
function makeFrame () {
  const written: string[] = []
  const clipboard = {
    writeText (text: string): Promise<void> {
      written.push(text)
      return Promise.resolve()
    },
  }
  const frame = { contentWindow: { navigator: { clipboard } } } as unknown as HTMLIFrameElement
  return { frame, written }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('clipboard bridge write policy', () => {
  it('delivered payload: swallows the write, clipboard untouched (sync)', async () => {
    const { frame, written } = makeFrame()
    const sink = vi.fn(() => true)
    const dispose = installClipboardBridge(frame, sink)
    await frame.contentWindow?.navigator.clipboard?.writeText?.(ENVELOPE)
    expect(sink).toHaveBeenCalledExactlyOnceWith(payload())
    expect(written).toEqual([])
    dispose()
  })

  it('delivered payload: swallows the write (async delivery report)', async () => {
    const { frame, written } = makeFrame()
    const sink = vi.fn(() => Promise.resolve(true))
    const dispose = installClipboardBridge(frame, sink)
    await frame.contentWindow?.navigator.clipboard?.writeText?.(ENVELOPE)
    expect(written).toEqual([])
    dispose()
  })

  it('undelivered payload: readable fallback lands on the clipboard', async () => {
    const { frame, written } = makeFrame()
    const sink = vi.fn(() => false)
    const dispose = installClipboardBridge(frame, sink)
    await frame.contentWindow?.navigator.clipboard?.writeText?.(ENVELOPE)
    expect(written).toEqual([READABLE])
    dispose()
  })

  it('throwing sink: counts as undelivered, readable fallback written', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { frame, written } = makeFrame()
    const sink = vi.fn(() => { throw new Error('boom') })
    const dispose = installClipboardBridge(frame, sink)
    await frame.contentWindow?.navigator.clipboard?.writeText?.(ENVELOPE)
    expect(written).toEqual([READABLE])
    expect(errorSpy).toHaveBeenCalledOnce()
    dispose()
  })

  it('rejecting sink: counts as undelivered, readable fallback written', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { frame, written } = makeFrame()
    const sink = vi.fn(() => Promise.reject(new Error('boom')))
    const dispose = installClipboardBridge(frame, sink)
    await frame.contentWindow?.navigator.clipboard?.writeText?.(ENVELOPE)
    expect(written).toEqual([READABLE])
    expect(errorSpy).toHaveBeenCalledOnce()
    dispose()
  })

  it('undelivered payload with empty readable part: nothing is written', async () => {
    const { frame, written } = makeFrame()
    const sink = vi.fn(() => false)
    const dispose = installClipboardBridge(frame, sink)
    const bare = `${SELECTION_MARKER}${encodeEnvelopePayload(payload())}::`
    await frame.contentWindow?.navigator.clipboard?.writeText?.(bare)
    expect(sink).toHaveBeenCalledOnce()
    expect(written).toEqual([])
    dispose()
  })

  it('non-envelope writes pass through verbatim', async () => {
    const { frame, written } = makeFrame()
    const sink = vi.fn(() => false)
    const dispose = installClipboardBridge(frame, sink)
    await frame.contentWindow?.navigator.clipboard?.writeText?.('just some copied text')
    expect(sink).not.toHaveBeenCalled()
    expect(written).toEqual(['just some copied text'])
    dispose()
  })

  it('dispose restores the original writeText', () => {
    const { frame, written } = makeFrame()
    const sink = vi.fn(() => true)
    const dispose = installClipboardBridge(frame, sink)
    dispose()
    void frame.contentWindow?.navigator.clipboard?.writeText?.(ENVELOPE)
    expect(sink).not.toHaveBeenCalled()
    expect(written).toEqual([ENVELOPE])
  })
})
