/**
 * Unit tests for the user-row reference tag: the seat selector's defensive
 * election over durable user-message sources (the `'user-vscode'` member the
 * host half stamps), and the summary line's render.
 *
 * @module dsh-sidebar-vscode/tests/userReferenceTag.spec
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VscodeUserReferenceTag, vscodeUserReferences } from '../src/client/userReferenceTag.tsx'

describe('vscodeUserReferences', () => {
  it('elects a stamped user source and returns its labels', () => {
    expect(vscodeUserReferences({
      kind: 'user',
      vscodeReferences: ['example.json L10-L12', 'src/main.ts'],
    })).toEqual(['example.json L10-L12', 'src/main.ts'])
  })

  it('keeps producer extras riding the source invisible but intact', () => {
    expect(vscodeUserReferences({
      kind: 'user',
      rpcId: 'req-1',
      vscodeReferences: ['a.ts L1'],
    })).toEqual(['a.ts L1'])
  })

  it('deduplicates labels and drops non-string or empty entries', () => {
    const labels = vscodeUserReferences({
      kind: 'user',
      vscodeReferences: ['a.ts L1', 'a.ts L1', 42, '', null, 'b.ts'],
    })
    expect(labels).toEqual(['a.ts L1', 'b.ts'])
  })

  it('declines every non-stamped source shape', () => {
    expect(vscodeUserReferences({ kind: 'user' })).toBeUndefined()
    expect(vscodeUserReferences({ kind: 'user', vscodeReferences: [] })).toBeUndefined()
    expect(vscodeUserReferences({ kind: 'user', vscodeReferences: 'a.ts' })).toBeUndefined()
    expect(vscodeUserReferences({ kind: 'user', vscodeReferences: [7, {}] })).toBeUndefined()
    expect(vscodeUserReferences({ kind: 'user', vscodeReferences: [''] })).toBeUndefined()
    expect(vscodeUserReferences({ kind: 'assistant' })).toBeUndefined()
    expect(vscodeUserReferences({ kind: 'vscode-mention', form: 'notice' })).toBeUndefined()
    expect(vscodeUserReferences(null)).toBeUndefined()
    expect(vscodeUserReferences('user')).toBeUndefined()
    expect(vscodeUserReferences(undefined)).toBeUndefined()
  })
})

describe('VscodeUserReferenceTag', () => {
  it('renders the summary line with every elected label', () => {
    const markup = renderToStaticMarkup(
      <VscodeUserReferenceTag matched={['example.json L10-L12', 'src/main.ts']} />,
    )
    expect(markup).toContain('example.json L10-L12')
    expect(markup).toContain('src/main.ts')
    expect(markup).toContain('dsh_vscodeRef_userTag')
    expect(markup).toContain('data-vscode-user-references="2"')
  })

  it('carries the full label list as the tooltip', () => {
    const markup = renderToStaticMarkup(
      <VscodeUserReferenceTag matched={['a b.ts L1-L2', 'c d.ts L3']} />,
    )
    expect(markup).toContain('title=')
    expect(markup).toMatch(/title="[^"]*a b\.ts L1-L2[^"]*c d\.ts L3/)
  })
})
