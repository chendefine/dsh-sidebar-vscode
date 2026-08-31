/**
 * DOM face of the modern DSH composer: the Lexical contenteditable that
 * replaced the textarea stack (DSH ≥ 0.1.2-alpha.2, PR #2852).
 *
 * The editable surface is `div[data-composer-input][contenteditable]` inside
 * `[data-composer-card]`; its document is Lexical's plain-text tree —
 * paragraph blocks (`<p>`), text nodes (wrapped in
 * `span[data-lexical-text]`), `<br>` line breaks, and one
 * `span[data-composer-chip][contenteditable=false]` per reference chip whose
 * decorator content (the boxed label) must never be descended into.
 *
 * The machine addresses edits in the DETECT projection (every chip counts as
 * ONE `￼` character; paragraphs join with one `\n`), so this module maps DOM
 * selection boundaries ⇄ detect offsets: the replacement for the textarea's
 * `selectionStart`/`setSelectionRange` pair the old composer exposed.
 *
 * The walk is written against a structural node face so the mapping logic is
 * unit-testable without a DOM; real DOM nodes satisfy the shape at runtime.
 *
 * @module dsh-sidebar-vscode/client/composerDom
 */

// ---- structural faces (satisfied by real DOM nodes) ----

/** The minimal node face the walk reads. */
export interface NodeLike {
  readonly nodeType: number
  readonly nodeName: string
  /** Text nodes only. */
  readonly data?: string
  readonly childNodes: readonly NodeLike[]
  readonly parentNode: NodeLike | null
  getAttribute?(name: string): string | null
}

/** A DOM selection boundary: (container node, offset into it). */
export interface DomPoint {
  readonly container: NodeLike
  readonly offset: number
}

/** Element-node type constant (text is 3). */
const ELEMENT_NODE = 1
/** Text-node type constant. */
const TEXT_NODE = 3

/** Whether one node contains another (or is itself). */
function contains(ancestor: NodeLike, node: NodeLike | null): boolean {
  let cursor: NodeLike | null = node
  while (cursor !== null) {
    if (cursor === ancestor) return true
    cursor = cursor.parentNode
  }
  return false
}

/** Index of one child inside its parent's childNodes (-1 when absent). */
function indexOfChild(parent: NodeLike, child: NodeLike): number {
  const kids = parent.childNodes
  for (let index = 0; index < kids.length; index++) {
    if (kids[index] === child) return index
  }
  return -1
}

// ---- the detect-projection walk ----

/** One walk segment: a leaf (or block gap) with its detect offset window. */
interface Segment {
  readonly kind: 'text' | 'chip' | 'linebreak' | 'gap'
  readonly node: NodeLike | null
  readonly parent: NodeLike | null
  readonly base: number
  readonly length: number
}

/** Element record: content base/length plus per-child boundary offsets. */
interface ElementRecord {
  readonly base: number
  readonly length: number
  /** boundaries[k] = the detect offset of the point before child k (end last). */
  readonly boundaries: readonly number[]
}

/** The walk product: everything the boundary mapping needs. */
export interface ComposerLayoutMap {
  readonly detectLength: number
  /** DOM boundary → detect offset; null when the boundary is foreign. */
  detectOffsetOf(point: DomPoint): number | null
  /** Detect offset → DOM boundary; null when out of range. */
  domPointOf(detectOffset: number): DomPoint | null
}

/** Whether an element is a reference chip host (never descended into). */
function isChipElement(node: NodeLike): boolean {
  return node.nodeType === ELEMENT_NODE
    && node.getAttribute?.('data-composer-chip') != null
}

/**
 * Walk one composer subtree, appending segments and recording elements.
 * @returns the subtree's detect length.
 */
function walk(
  node: NodeLike,
  base: number,
  segments: Segment[],
  elements: Map<NodeLike, ElementRecord>,
  texts: Map<NodeLike, Segment>,
  chips: Map<NodeLike, Segment>,
): number {
  if (node.nodeType === TEXT_NODE) {
    const length = (node.data ?? '').length
    if (length > 0) {
      const segment: Segment = { kind: 'text', node, parent: node.parentNode, base, length }
      segments.push(segment)
      texts.set(node, segment)
    }
    return length
  }
  if (node.nodeType !== ELEMENT_NODE) return 0 // comments and friends: no projection
  if (isChipElement(node)) {
    // The chip IS one detect char; its decorator content never counts.
    const segment: Segment = { kind: 'chip', node, parent: node.parentNode, base, length: 1 }
    segments.push(segment)
    chips.set(node, segment)
    return 1
  }
  if (node.nodeName === 'BR') {
    // A managed line break is the presentational <br> Lexical mounts inside
    // an EMPTY block (cursor geometry); the editor state has no LineBreakNode
    // for it, so the detect projection counts nothing. A plain <br> is a real
    // line break and counts its one newline.
    const managed = node.getAttribute?.('data-lexical-managed-linebreak') != null
    if (!managed) segments.push({ kind: 'linebreak', node, parent: node.parentNode, base, length: 1 })
    return managed ? 0 : 1
  }
  const start = base
  const boundaries: number[] = [base]
  for (const child of node.childNodes) {
    base += walk(child, base, segments, elements, texts, chips)
    boundaries.push(base)
  }
  elements.set(node, { base: start, length: base - start, boundaries })
  return base - start
}

/**
 * Build the detect-projection map over one composer editable.
 *
 * Block gaps: between every consecutive pair of the root's child nodes —
 * mirroring the host's own `$composerLayout` (a gap is one `\n` regardless
 * of what the two neighbors are; empty paragraphs still get their seams).
 *
 * @param root - the contenteditable element (any structural node works).
 */
export function buildComposerLayoutMap(root: NodeLike): ComposerLayoutMap {
  const segments: Segment[] = []
  const elements = new Map<NodeLike, ElementRecord>()
  const texts = new Map<NodeLike, Segment>()
  const chips = new Map<NodeLike, Segment>()

  // Root children: walk each, inserting one gap segment between neighbors.
  let base = 0
  const kids = root.childNodes
  // Root boundaries follow the host's "gap = end of the block before it"
  // convention: a child-index boundary maps to the end of the preceding
  // block, before the gap that follows it (the two detect offsets around a
  // gap fold to the same DOM point).
  const rootBoundaries: number[] = [0]
  let cumulative = 0
  kids.forEach((child, index) => {
    if (index > 0) {
      segments.push({ kind: 'gap', node: null, parent: root, base, length: 1 })
      base += 1
    }
    const childStart = base
    base += walk(child, base, segments, elements, texts, chips)
    cumulative += base - childStart
    rootBoundaries.push(cumulative)
  })
  // The document-end boundary (index childCount) is past EVERYTHING,
  // trailing gaps included.
  rootBoundaries[rootBoundaries.length - 1] = base
  elements.set(root, { base: 0, length: base, boundaries: rootBoundaries })

  /** Projected length of one child node (element content, leaf, or 0). */
  const lengthOf = (node: NodeLike | undefined): number => {
    if (node === undefined) return 0
    const element = elements.get(node)
    if (element !== undefined) return element.length
    const text = texts.get(node)
    if (text !== undefined) return text.length
    const chip = chips.get(node)
    if (chip !== undefined) return chip.length
    if (node.nodeType === ELEMENT_NODE && node.nodeName === 'BR') return 1
    return 0
  }

  const detectOffsetOf = (point: DomPoint): number | null => {
    const { container, offset } = point
    if (container.nodeType === TEXT_NODE) {
      const segment = texts.get(container)
      if (segment !== undefined) return segment.base + Math.min(Math.max(offset, 0), segment.length)
      // Decorator-internal text (inside a chip): snap to the chip's edges.
      const chip = nearestChip(chips, container)
      if (chip !== null) return offset <= 0 ? chip.base : chip.base + chip.length
      return null
    }
    if (container.nodeType === ELEMENT_NODE) {
      const chip = chips.get(container)
      if (chip !== undefined) return offset <= 0 ? chip.base : chip.base + chip.length
      const record = elements.get(container)
      if (record !== undefined) {
        // The per-child boundary table already folds in the block gaps (the
        // root's children carry them; nested children never do).
        const bound = Math.min(Math.max(offset, 0), container.childNodes.length)
        return record.boundaries[bound] ?? record.base + record.length
      }
      // An unrecorded element (decorator internals): snap to its chip.
      const byAncestor = nearestChip(chips, container)
      if (byAncestor !== null) return offset <= 0 ? byAncestor.base : byAncestor.base + byAncestor.length
      return null
    }
    return null
  }

  const domPointOf = (detectOffset: number): DomPoint | null => {
    if (detectOffset < 0 || detectOffset > base) return null
    // The first segment the boundary opens or sits inside; a boundary at a
    // segment's trailing edge prefers the NEXT segment that starts there
    // (its leading edge is the finer point).
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!
      if (detectOffset < segment.base || detectOffset > segment.base + segment.length) continue
      if (detectOffset === segment.base + segment.length) {
        const next = segments[index + 1]
        if (detectOffset < base && next !== undefined && next.base === detectOffset) continue
      }
      if (segment.kind === 'text' && segment.node !== null) {
        // Interior and both edges of a text run address the text node.
        return { container: segment.node, offset: detectOffset - segment.base }
      }
      if (segment.node !== null && segment.parent !== null) {
        const at = indexOfChild(segment.parent, segment.node)
        if (at < 0) continue
        const before = detectOffset <= segment.base ? at : at + 1
        return { container: segment.parent, offset: Math.min(before, segment.parent.childNodes.length) }
      }
      if (segment.kind === 'gap' && segment.parent !== null) {
        // The gap's trailing edge is the next block's leading boundary.
        const afterIndex = indexOfDetectStart(segment.parent, segments, segment.base + segment.length)
        return { container: segment.parent, offset: afterIndex }
      }
    }
    return { container: root, offset: root.childNodes.length }
  }

  /** Root childNodes index whose detect start is `detectStart` (end fallback). */
  const indexOfDetectStart = (parent: NodeLike, segs: readonly Segment[], detectStart: number): number => {
    let accumulate = 0
    const kidsOf = parent.childNodes
    for (let index = 0; index < kidsOf.length; index++) {
      const child = kidsOf[index]
      if (index > 0) accumulate += 1 // the gap before this child
      if (accumulate >= detectStart) return index
      accumulate += lengthOf(child)
    }
    return kidsOf.length
  }

  return { detectLength: base, detectOffsetOf, domPointOf }
}

/** Nearest chip segment on the ancestor chain, or null. */
function nearestChip(chips: Map<NodeLike, Segment>, node: NodeLike): Segment | null {
  let cursor: NodeLike | null = node.parentNode
  while (cursor !== null) {
    const chip = chips.get(cursor)
    if (chip !== undefined) return chip
    cursor = cursor.parentNode
  }
  return null
}

// ---- document-level helpers over the live composer ----

/** Structural face of a real DOM element/document this module touches. */
interface DocumentLike {
  readonly querySelector: (selector: string) => unknown
  getSelection?(): SelectionLike | null
}

/** Structural selection face (read side + the restore writes). */
interface SelectionLike {
  readonly rangeCount: number
  readonly anchorNode: NodeLike | null
  readonly anchorOffset: number
  readonly focusNode: NodeLike | null
  readonly focusOffset: number
  removeAllRanges?(): void
  addRange?(range: unknown): void
}

/** The live document (injectable for tests). */
let doc: DocumentLike | undefined = typeof document !== 'undefined' ? document as unknown as DocumentLike : undefined

/** Replace the document face (tests). */
export function setComposerDocument(next: DocumentLike | undefined): void {
  doc = next
}

/**
 * Locate the displayed conversation's editable composer surface. Only an
 * EDITABLE surface answers: the no-session hero card renders the same
 * attributes inert (a workspace trigger, not an input).
 */
export function findComposerEditable(): NodeLike | null {
  const el = doc?.querySelector('[data-composer-card] [data-composer-input][contenteditable="true"], [data-composer-card] [contenteditable="true"][data-composer-input]')
  return el != null && (el as NodeLike).childNodes !== undefined ? el as NodeLike : null
}

/**
 * Read the live DOM selection of the displayed composer in detect
 * coordinates — the user's last caret or range, which the contenteditable
 * keeps through focus loss into the VS Code iframe. Undefined whenever the
 * composer is absent or the selection is not wholly inside it.
 */
export function readComposerSelectionDetect(): { readonly start: number, readonly end: number } | undefined {
  const root = findComposerEditable()
  const selection = doc?.getSelection?.()
  if (root === null || selection === null || selection === undefined || selection.rangeCount === 0) return undefined
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  if (anchorNode === null || focusNode === null) return undefined
  if (!contains(root, anchorNode) || !contains(root, focusNode)) return undefined
  const layout = buildComposerLayoutMap(root)
  const anchor = layout.detectOffsetOf({ container: anchorNode, offset: anchorOffset })
  const focus = layout.detectOffsetOf({ container: focusNode, offset: focusOffset })
  if (anchor === null || focus === null) return undefined
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
}

/**
 * Place the DOM caret of the displayed composer at one detect offset — the
 * contenteditable replacement for the textarea's `setSelectionRange`.
 * Selection only, never focus: the user's focus stays wherever they were
 * working (typically inside the VS Code iframe); Lexical adopts the DOM
 * selection when the surface regains focus. One frame out so a concurrent
 * controlled-value render settles first. Best-effort by design.
 */
export function restoreComposerCaretDetect(caret: number): void {
  const root = findComposerEditable()
  if (root === null) return
  requestAnimationFrame(() => {
    try {
      const live = findComposerEditable()
      if (live === null) return
      const layout = buildComposerLayoutMap(live)
      const point = layout.domPointOf(caret)
      if (point === null) return
      const selection = doc?.getSelection?.()
      if (selection === null || selection === undefined) return
      const documentFace = doc as unknown as { createRange?(): unknown }
      if (typeof documentFace.createRange !== 'function'
        || typeof selection.removeAllRanges !== 'function'
        || typeof selection.addRange !== 'function') return
      const range = documentFace.createRange()
      const settable = range as { setStart?(node: NodeLike, offset: number): void, setEnd?(node: NodeLike, offset: number): void, collapse?(toStart: boolean): void }
      if (typeof settable.setStart !== 'function' || typeof settable.collapse !== 'function') return
      settable.setStart(point.container, point.offset)
      settable.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } catch {
      // A stale layout or an uncooperative selection: the caret restore is
      // polish, never a landing requirement.
    }
  })
}
