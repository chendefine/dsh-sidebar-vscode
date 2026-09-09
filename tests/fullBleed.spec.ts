/**
 * fullBleed.ts's pure halves: the padding read off a computed style and
 * the compensating style that covers the host's padding box. (The hook
 * itself needs a real layout engine — E2E covers it.)
 *
 * @module dsh-sidebar-vscode/tests/fullBleed.spec
 */

import { describe, expect, it } from 'vitest'
import { bleedStyle, isBoxless, readPadding, type HostPadding } from '../src/client/fullBleed.ts'

/** A computed-style stand-in carrying only the padding fields read. */
function style(padding: Partial<Record<'paddingLeft' | 'paddingTop', string>>): CSSStyleDeclaration {
  return { paddingLeft: '', paddingTop: '', ...padding } as unknown as CSSStyleDeclaration
}

describe('readPadding', () => {
  it('reads both axes', () => {
    expect(readPadding(style({ paddingLeft: '12px', paddingTop: '10px' })))
      .toEqual({ x: 12, y: 10 })
  })

  it('reads absent or empty padding as zero', () => {
    expect(readPadding(style({}))).toEqual({ x: 0, y: 0 })
    expect(readPadding(style({ paddingLeft: '', paddingTop: '' }))).toEqual({ x: 0, y: 0 })
  })

  it('reads unparsable or non-positive padding as zero', () => {
    expect(readPadding(style({ paddingLeft: 'nonsense', paddingTop: '-4px' }))).toEqual({ x: 0, y: 0 })
    expect(readPadding(style({ paddingLeft: '0px', paddingTop: '0px' }))).toEqual({ x: 0, y: 0 })
  })

  it('accepts fractional padding', () => {
    expect(readPadding(style({ paddingLeft: '0.5px', paddingTop: '1.25px' })))
      .toEqual({ x: 0.5, y: 1.25 })
  })
})

describe('isBoxless', () => {
  it('flags only display styles that generate no box', () => {
    expect(isBoxless('contents')).toBe(true)
    expect(isBoxless('block')).toBe(false)
    expect(isBoxless('flex')).toBe(false)
  })
})

describe('bleedStyle', () => {
  it('pulls each edge out by its padding and grows the box by both', () => {
    expect(bleedStyle({ x: 12, y: 10 })).toEqual({
      marginTop: '-10px',
      marginRight: '-12px',
      marginBottom: '-10px',
      marginLeft: '-12px',
      width: 'calc(100% + 24px)',
      height: 'calc(100% + 20px)',
    })
  })

  it('is the identity at zero padding', () => {
    expect(bleedStyle({ x: 0, y: 0 })).toEqual({
      marginTop: '0px',
      marginRight: '0px',
      marginBottom: '0px',
      marginLeft: '0px',
      width: 'calc(100% + 0px)',
      height: 'calc(100% + 0px)',
    })
  })

  it('round-trips a pane-body read into a covering style', () => {
    const padding: HostPadding = readPadding(style({ paddingLeft: '12px', paddingTop: '12px' }))
    expect(bleedStyle(padding).width).toBe('calc(100% + 24px)')
    expect(bleedStyle(padding).height).toBe('calc(100% + 24px)')
    expect(bleedStyle(padding).marginLeft).toBe('-12px')
  })
})
