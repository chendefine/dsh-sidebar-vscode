/**
 * Unit tests for the pure path/URL logic of the VSCode tab.
 *
 * @module dsh-sidebar-vscode/tests/paths.spec
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SERVER_URL,
  buildVscodeUrl,
  mapPath,
  mapPathForOpen,
  normalizeBaseUrl,
  parsePathMap,
  reverseMapPath,
} from '../src/client/paths.ts'

describe('parsePathMap', () => {
  it('empty or whitespace input yields NO rules (pass-through mode)', () => {
    expect(parsePathMap('')).toEqual([])
    expect(parsePathMap('   ')).toEqual([])
    expect(parsePathMap(undefined)).toEqual([])
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

  it('falls back to pass-through when every entry is malformed', () => {
    expect(parsePathMap('nope; = ;=')).toEqual([])
  })

  it('orders rules by longest source prefix first', () => {
    const rules = parsePathMap('/data/workspace=/mnt/vscode;/data/workspace/code=/x')
    expect(rules[0]).toEqual({ from: '/data/workspace/code', to: '/x' })
    expect(rules[1]).toEqual({ from: '/data/workspace', to: '/mnt/vscode' })
  })
})

describe('mapPath (no rules — the unset default)', () => {
  const rules = parsePathMap(undefined)

  it('passes every absolute path through unchanged', () => {
    expect(mapPath('/data/workspace', rules)).toBe('/data/workspace')
    expect(mapPath('/data/workspace/myproject', rules)).toBe('/data/workspace/myproject')
    expect(mapPath('/data/dsh-home', rules)).toBe('/data/dsh-home')
    expect(mapPath('/tmp/scratch', rules)).toBe('/tmp/scratch')
    expect(mapPath('/srv/data', rules)).toBe('/srv/data')
  })

  it('returns null only for non-absolute or empty input', () => {
    expect(mapPath('relative/path', rules)).toBeNull()
    expect(mapPath('', rules)).toBeNull()
    expect(mapPath('   ', rules)).toBeNull()
  })
})

describe('mapPath (identity rules)', () => {
  const rules = parsePathMap('/data/workspace=/data/workspace;/opt=/opt')

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
    expect(mapPath('/data/workspace-other/x', rules)).toBe('/data/workspace-other/x')
    expect(mapPath('/data', rules)).toBe('/data')
  })

  it('passes unmatched absolute paths through unchanged', () => {
    expect(mapPath('/srv/data', rules)).toBe('/srv/data')
  })

  it('returns null for non-absolute or empty paths', () => {
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

  it('root destination prefix strips the source prefix without double slashes', () => {
    const rules = parsePathMap('/data=/')
    expect(mapPath('/data/dsh-home', rules)).toBe('/dsh-home')
    expect(mapPath('/data', rules)).toBe('/')
    const round = reverseMapPath('/dsh-home', rules)
    expect(round).toBe('/data/dsh-home')
  })

  it('root-to-root identity rules pass everything through unchanged', () => {
    const rules = parsePathMap('/=/')
    expect(mapPath('/data/dsh-home', rules)).toBe('/data/dsh-home')
    expect(reverseMapPath('/data/dsh-home', rules)).toBe('/data/dsh-home')
  })
})

describe('mapPathForOpen (no rules — the unset default)', () => {
  const rules = parsePathMap(undefined)

  it('passes out-of-map absolute paths through unchanged (unmapped ≠ unopenable)', () => {
    expect(mapPathForOpen('/app/dsh/packages/foo.ts', rules)).toBe('/app/dsh/packages/foo.ts')
    expect(mapPathForOpen('/tmp/scratch/notes.json', rules)).toBe('/tmp/scratch/notes.json')
    expect(mapPathForOpen('/root/.bashrc', rules)).toBe('/root/.bashrc')
  })

  it('returns null only for non-absolute or empty input', () => {
    expect(mapPathForOpen('relative/path', rules)).toBeNull()
    expect(mapPathForOpen('', rules)).toBeNull()
    expect(mapPathForOpen('   ', rules)).toBeNull()
  })

  it('trims whitespace before deciding', () => {
    expect(mapPathForOpen('  /tmp/x.ts  ', rules)).toBe('/tmp/x.ts')
  })
})

describe('mapPathForOpen (identity rules)', () => {
  const rules = parsePathMap('/data/workspace=/data/workspace;/opt=/opt')

  it('keeps the identity mapping for the configured roots', () => {
    expect(mapPathForOpen('/opt/dsh/plugins/p/x.ts', rules)).toBe('/opt/dsh/plugins/p/x.ts')
    expect(mapPathForOpen('/data/workspace/proj/a.ts', rules)).toBe('/data/workspace/proj/a.ts')
  })

  it('returns null only for non-absolute or empty input', () => {
    expect(mapPathForOpen('relative/path', rules)).toBeNull()
    expect(mapPathForOpen('', rules)).toBeNull()
    expect(mapPathForOpen('   ', rules)).toBeNull()
  })

  it('trims whitespace before deciding', () => {
    expect(mapPathForOpen('  /tmp/x.ts  ', rules)).toBe('/tmp/x.ts')
  })
})

describe('mapPathForOpen (custom rules)', () => {
  it('rewrites matched prefixes and passes everything else through', () => {
    const rules = parsePathMap('/dsh-ws=/vscode-ws')
    expect(mapPathForOpen('/dsh-ws/a.ts', rules)).toBe('/vscode-ws/a.ts')
    expect(mapPathForOpen('/other/a.ts', rules)).toBe('/other/a.ts')
  })

  it('keeps the destination-prefix pass-through of mapPath', () => {
    const rules = parsePathMap('/dsh-ws=/vscode-ws')
    expect(mapPathForOpen('/vscode-ws/project/a.ts', rules)).toBe('/vscode-ws/project/a.ts')
  })

  it('prefers the longest matching source prefix', () => {
    const rules = parsePathMap('/data/workspace=/mnt/vscode;/data/workspace/code=/x')
    expect(mapPathForOpen('/data/workspace/code/a.ts', rules)).toBe('/x/a.ts')
    expect(mapPathForOpen('/data/workspace/other/a.ts', rules)).toBe('/mnt/vscode/other/a.ts')
    expect(mapPathForOpen('/data/elsewhere/a.ts', rules)).toBe('/data/elsewhere/a.ts')
  })
})

describe('normalizeBaseUrl', () => {
  it('empty input falls back to the full-URL default (a bare local serve-web)', () => {
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
