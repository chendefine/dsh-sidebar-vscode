/**
 * Unit tests for the pure path/URL logic of the VSCode tab.
 *
 * @module dsh-sidebar-vscode/tests/paths.spec
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PATH_MAP,
  DEFAULT_SERVER_URL,
  buildVscodeUrl,
  mapPath,
  normalizeBaseUrl,
  parsePathMap,
} from '../src/client/paths.ts'

describe('parsePathMap', () => {
  it('empty or whitespace input yields the default rules', () => {
    expect(parsePathMap('')).toEqual(parsePathMap(DEFAULT_PATH_MAP))
    expect(parsePathMap('   ')).toEqual(parsePathMap(DEFAULT_PATH_MAP))
    expect(parsePathMap(undefined)).toEqual(parsePathMap(DEFAULT_PATH_MAP))
  })

  it('parses src=dst pairs joined by ;', () => {
    expect(parsePathMap('/a=/b;/c=/d')).toEqual([
      { from: '/a', to: '/b' },
      { from: '/c', to: '/d' },
    ])
  })

  it('trims entries and normalizes slashes', () => {
    expect(parsePathMap(' /a/ = /b/ ; /c = //d// ')).toEqual([
      { from: '/a', to: '/b' },
      { from: '/c', to: '/d' },
    ])
  })

  it('skips malformed entries but keeps the valid ones', () => {
    expect(parsePathMap('no-equals;/x=/y;=/z; ;/w=')).toEqual([{ from: '/x', to: '/y' }])
  })

  it('falls back to the default when every entry is malformed', () => {
    expect(parsePathMap('nope; = ;=')).toEqual(parsePathMap(DEFAULT_PATH_MAP))
  })

  it('orders rules by longest source prefix first', () => {
    const rules = parsePathMap('/data/workspace=/mnt/vscode;/data/workspace/code=/x')
    expect(rules[0]).toEqual({ from: '/data/workspace/code', to: '/x' })
    expect(rules[1]).toEqual({ from: '/data/workspace', to: '/mnt/vscode' })
  })
})

describe('mapPath (default deployment rules)', () => {
  const rules = parsePathMap(DEFAULT_PATH_MAP)

  it('passes the DSH workspace prefix through unchanged (identity rule)', () => {
    expect(mapPath('/data/workspace', rules)).toBe('/data/workspace')
    expect(mapPath('/data/workspace/myproject', rules)).toBe('/data/workspace/myproject')
    expect(mapPath('/data/workspace/code/app/src.ts', rules)).toBe('/data/workspace/code/app/src.ts')
  })

  it('passes /opt paths through unchanged (identity rule)', () => {
    expect(mapPath('/opt', rules)).toBe('/opt')
    expect(mapPath('/opt/dsh/plugins/dsh-sidebar-vscode', rules)).toBe('/opt/dsh/plugins/dsh-sidebar-vscode')
  })

  it('does not match sibling prefixes that merely share a string prefix', () => {
    expect(mapPath('/data/workspace-other/x', rules)).toBeNull()
    expect(mapPath('/data', rules)).toBeNull()
  })

  it('returns null for unmappable or non-absolute paths', () => {
    expect(mapPath('/srv/data', rules)).toBeNull()
    expect(mapPath('relative/path', rules)).toBeNull()
    expect(mapPath('', rules)).toBeNull()
  })
})

describe('mapPath (custom rules)', () => {
  it('honors user-supplied mappings over the defaults', () => {
    const rules = parsePathMap('/mnt/agent=/workspace')
    expect(mapPath('/mnt/agent/deep/nested', rules)).toBe('/workspace/deep/nested')
  })

  it('passes through paths already sitting under a destination prefix', () => {
    const rules = parsePathMap('/dsh-ws=/vscode-ws')
    expect(mapPath('/vscode-ws/project', rules)).toBe('/vscode-ws/project')
  })

  it('root source prefix maps everything', () => {
    const rules = parsePathMap('/=/mirror')
    expect(mapPath('/anything/here', rules)).toBe('/mirror/anything/here')
  })
})

describe('normalizeBaseUrl', () => {
  it('empty input falls back to the gateway subpath default', () => {
    expect(normalizeBaseUrl('')).toBe(DEFAULT_SERVER_URL)
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_SERVER_URL)
    expect(normalizeBaseUrl('   ')).toBe(DEFAULT_SERVER_URL)
  })

  it('drops trailing slashes', () => {
    expect(normalizeBaseUrl('/vscode/')).toBe('/vscode')
    expect(normalizeBaseUrl('/vscode///')).toBe('/vscode')
    expect(normalizeBaseUrl('http://127.0.0.1:8000/vscode/')).toBe('http://127.0.0.1:8000/vscode')
  })

  it('anchors scheme-less values as subpaths', () => {
    expect(normalizeBaseUrl('vscode')).toBe('/vscode')
  })

  it('keeps absolute URLs and trims whitespace', () => {
    expect(normalizeBaseUrl('  http://127.0.0.1:8000/vscode  ')).toBe('http://127.0.0.1:8000/vscode')
    expect(normalizeBaseUrl('https://example.com/vscode')).toBe('https://example.com/vscode')
  })

  it('keeps a bare root as root', () => {
    expect(normalizeBaseUrl('/')).toBe('/')
  })
})

describe('buildVscodeUrl', () => {
  it('appends the folder query with encoded path', () => {
    expect(buildVscodeUrl('/vscode', '/data/workspace')).toBe('/vscode/?folder=%2Fdata%2Fworkspace')
    expect(buildVscodeUrl('http://h:8000/vscode', '/a b/c')).toBe('http://h:8000/vscode/?folder=%2Fa%20b%2Fc')
  })

  it('opens the default workspace when folder is null', () => {
    expect(buildVscodeUrl('/vscode', null)).toBe('/vscode/')
    expect(buildVscodeUrl('http://h:8000/vscode', null)).toBe('http://h:8000/vscode/')
  })
})
