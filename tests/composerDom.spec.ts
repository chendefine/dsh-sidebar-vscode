/**
 * Unit tests for the composer DOM mapping: the detect-projection walk over
 * the Lexical contenteditable's DOM (text wrappers, atomic chip hosts,
 * line breaks, paragraph gaps) and the DOM-boundary ⇄ detect-offset
 * translations. The walk is exercised through structural fakes — the same
 * shape real DOM nodes satisfy at runtime.
 *
 * @module dsh-sidebar-vscode/tests/composerDom.spec
 */

import { describe, expect, it } from 'vitest'
import {
  buildComposerLayoutMap,
  type NodeLike,
} from '../src/client/composerDom.ts'

/** Build one fake element node. */
function el (nodeName: string, attrs: Record<string, string> = {}, children: NodeLike[] = []): NodeLike {
  return {
    nodeType: 1,
    nodeName,
    childNodes: children,
    parentNode: null,
    getAttribute: (name: string): string | null => (name in attrs ? (attrs[name] as string) : null),
  }
}

/** Build one fake text node. */
function text (data: string): NodeLike {
  return { nodeType: 3, nodeName: '#text', data, childNodes: [], parentNode: null }
}

/** Wire parentNode over a built tree. */
function link (node: NodeLike): NodeLike {
  for (const child of node.childNodes) {
    (child as { parentNode: NodeLike | null }).parentNode = node
    link(child)
  }
  return node
}

/** Lexical wraps text runs in `span[data-lexical-text]`. */
function textRun (data: string): NodeLike {
  return el('SPAN', { 'data-lexical-text': 'true' }, [text(data)])
}

/** One chip host: atomic, contenteditable=false, decorator content inside. */
function chip (label: string): NodeLike {
  return el('SPAN', { 'data-composer-chip': 'vscode-reference', contenteditable: 'false' }, [
    el('SPAN', {}, [text(label)]),
  ])
}

/** A managed (presentational) br — what an empty paragraph renders. */
function managedBr (): NodeLike {
  return el('BR', { 'data-lexical-managed-linebreak': 'true' })
}

/**
 * The canonical composer shape:
 * `<p>a text + CHIP</p><p><br managed></p><p>tail</p>` — detect `aa bb￼\n\nzz`
 * (the empty block's br is presentational: no detect char of its own).
 */
function canonicalRoot (): NodeLike {
  return link(el('DIV', { contenteditable: 'true' }, [
    el('P', {}, [textRun('aa bb'), chip('src/a.ts L1-L2')]),
    el('P', {}, [managedBr()]),
    el('P', {}, [textRun('zz')]),
  ]))
}

describe('buildComposerLayoutMap', () => {
  it('counts chips as one char, blocks join with one newline each', () => {
    const layout = buildComposerLayoutMap(canonicalRoot())
    expect(layout.detectLength).toBe('aa bb￼\n\nzz'.length)
  })

  it('maps text-node boundaries into their detect offsets', () => {
    const root = canonicalRoot()
    const layout = buildComposerLayoutMap(root)
    const firstRun = root.childNodes[0]!.childNodes[0]!.childNodes[0]!
    expect(layout.detectOffsetOf({ container: firstRun, offset: 0 })).toBe(0)
    expect(layout.detectOffsetOf({ container: firstRun, offset: 3 })).toBe(3)
    expect(layout.detectOffsetOf({ container: firstRun, offset: 99 })).toBe(5) // clamped to the run
    const tailRun = root.childNodes[2]!.childNodes[0]!.childNodes[0]!
    expect(layout.detectOffsetOf({ container: tailRun, offset: 1 })).toBe('aa bb￼\n\nz'.length)
  })

  it('maps element boundaries (blocks, chips, br) into detect offsets', () => {
    const root = canonicalRoot()
    const layout = buildComposerLayoutMap(root)
    const firstPara = root.childNodes[0]!
    expect(layout.detectOffsetOf({ container: firstPara, offset: 0 })).toBe(0)
    expect(layout.detectOffsetOf({ container: firstPara, offset: 1 })).toBe('aa bb'.length) // before the chip
    expect(layout.detectOffsetOf({ container: firstPara, offset: 2 })).toBe('aa bb￼'.length) // after the chip
    expect(layout.detectOffsetOf({ container: root, offset: 0 })).toBe(0)
    // The boundary between the first two blocks sits BEFORE the gap newline.
    expect(layout.detectOffsetOf({ container: root, offset: 1 })).toBe('aa bb￼'.length)
    expect(layout.detectOffsetOf({ container: root, offset: 3 })).toBe('aa bb￼\n\nzz'.length)
  })

  it('snaps decorator-internal boundaries to the owning chip edge', () => {
    const root = canonicalRoot()
    const layout = buildComposerLayoutMap(root)
    const chipHost = root.childNodes[0]!.childNodes[1]!
    expect(layout.detectOffsetOf({ container: chipHost, offset: 0 })).toBe('aa bb'.length)
    expect(layout.detectOffsetOf({ container: chipHost, offset: 2 })).toBe('aa bb￼'.length)
    const decoratorText = chipHost.childNodes[0]!.childNodes[0]!
    expect(layout.detectOffsetOf({ container: decoratorText, offset: 0 })).toBe('aa bb'.length)
    expect(layout.detectOffsetOf({ container: decoratorText, offset: 4 })).toBe('aa bb￼'.length)
  })

  it('answers null for foreign boundaries', () => {
    const root = canonicalRoot()
    const layout = buildComposerLayoutMap(root)
    const foreign = link(el('DIV', {}, [text('elsewhere')]))
    expect(layout.detectOffsetOf({ container: foreign, offset: 0 })).toBeNull()
    expect(layout.detectOffsetOf({ container: foreign.childNodes[0]!, offset: 1 })).toBeNull()
  })

  it('round-trips detect offsets through DOM points', () => {
    const root = canonicalRoot()
    const layout = buildComposerLayoutMap(root)
    for (let offset = 0; offset <= layout.detectLength; offset++) {
      const point = layout.domPointOf(offset)
      expect(point, `domPointOf(${offset})`).not.toBeNull()
      const back = point === null ? null : layout.detectOffsetOf(point)
      // A boundary may fold to the same edge as a neighbor (chips/gaps are
      // atomic); the round trip must at least stay inside the same edge set.
      expect(back === null ? -1 : Math.abs(back - offset) <= 1, `round trip of ${offset} → ${back}`).toBe(true)
    }
  })

  it('places interior carets exactly (text) and edge carets beside chips', () => {
    const root = canonicalRoot()
    const layout = buildComposerLayoutMap(root)
    const inside = layout.domPointOf(3)
    expect(inside?.container.nodeType).toBe(3)
    expect(inside?.offset).toBe(3)
    // The boundary at the end of the 'aa bb' run opens the chip segment; the
    // mapper resolves it to the element point just before the chip host (the
    // same document position as the text node's end).
    const beforeChip = layout.domPointOf('aa bb'.length)
    expect(beforeChip?.container).toBe(root.childNodes[0]) // the paragraph
    expect(beforeChip?.offset).toBe(1)
    // The chip's trailing edge coincides with the following block gap; the
    // mapper prefers the boundary that opens there — the point between the
    // two <p> children, the same document position as (paragraph, 2).
    const afterChip = layout.domPointOf('aa bb￼'.length)
    expect(afterChip?.container).toBe(root)
    expect(afterChip?.offset).toBe(1)
    // The document end addresses the final text run's end.
    const end = layout.domPointOf(layout.detectLength)
    expect(end?.container).toBe(root.childNodes[2]!.childNodes[0]!.childNodes[0])
    expect(end?.offset).toBe('zz'.length)
  })

  it('treats the empty composer as a zero-length map', () => {
    const root = link(el('DIV', { contenteditable: 'true' }, []))
    const layout = buildComposerLayoutMap(root)
    expect(layout.detectLength).toBe(0)
    const point = layout.domPointOf(0)
    expect(point?.container).toBe(root)
    expect(point?.offset).toBe(0)
  })
})

describe('buildComposerLayoutMap (degenerate boundaries)', () => {
  it('addresses an empty text node (a collapsed caret can sit in one)', () => {
    const empty = text('')
    const root = link(el('DIV', { contenteditable: 'true' }, [
      el('P', {}, [textRun('aa'), empty, chip('x.ts')]),
    ]))
    const layout = buildComposerLayoutMap(root)
    expect(layout.detectOffsetOf({ container: empty, offset: 0 })).toBe(2)
  })

  it('counts a plain (unmanaged) br as one newline', () => {
    const root = link(el('DIV', { contenteditable: 'true' }, [
      el('P', {}, [textRun('aa'), el('BR'), textRun('bb')]),
    ]))
    const layout = buildComposerLayoutMap(root)
    expect(layout.detectLength).toBe('aa\nbb'.length)
  })
})
