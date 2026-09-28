/**
 * Unit tests for the Host half's plugin configuration (src/config.ts):
 * the `Config` schema the settings service derives the
 * `dsh-sidebar-vscode` section from — its shape, defaults, volatile
 * flags, and declared bounds.
 *
 * @module dsh-sidebar-vscode/tests/config.spec
 */

import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import {
  DEFAULT_OPEN_BLOCKLIST,
  MAX_BYTES_DEFAULT,
  MAX_LINES_DEFAULT,
  VSCODE_SIDEBAR_SETTINGS_BASE,
  VSCODE_SIDEBAR_SETTINGS_NAMESPACE,
} from '../src/shared/settings.ts'

/** The snapshot of one resolved volatile field. */
function snapshotOf(resolved: Record<string, { get(): unknown }>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(resolved).map(([key, ref]) => [key, ref.get()]))
}

describe('Config schema', () => {
  it('resolves an empty section to exactly the composition base', () => {
    expect(snapshotOf(Config({} as never))).toEqual({
      openAsDefault: VSCODE_SIDEBAR_SETTINGS_BASE.openAsDefault,
      openBlocklist: [...VSCODE_SIDEBAR_SETTINGS_BASE.openBlocklist],
      serverUrl: '',
      pathMap: '',
      maxLines: VSCODE_SIDEBAR_SETTINGS_BASE.maxLines,
      maxBytes: VSCODE_SIDEBAR_SETTINGS_BASE.maxBytes,
    })
  })

  it('accepts and keeps a full user section', () => {
    const section = {
      openAsDefault: true,
      openBlocklist: ['zip'],
      serverUrl: 'http://127.0.0.1:9000/vscode/?tkn=x',
      pathMap: '/a=/b',
      maxLines: 80,
      maxBytes: 5000,
    }
    expect(snapshotOf(Config(section))).toEqual(section)
  })

  it('refuses caps outside the declared bounds', () => {
    expect(() => Config({ maxLines: 0 } as never)).toThrow()
    expect(() => Config({ maxLines: 9999 } as never)).toThrow()
    expect(() => Config({ maxBytes: 10 } as never)).toThrow()
    expect(() => Config({ maxBytes: 1e9 } as never)).toThrow()
  })

  it('refuses a blocklist beyond its entry budget or entry length', () => {
    expect(() => Config({ openBlocklist: new Array(65).fill('zip') } as never)).toThrow()
    expect(() => Config({ openBlocklist: ['toolongextension12345'] } as never)).toThrow()
  })

  it('marks every field volatile so the settings service derives the section', () => {
    const fields = Object.keys(VSCODE_SIDEBAR_SETTINGS_BASE) as Array<keyof typeof VSCODE_SIDEBAR_SETTINGS_BASE>
    const dict = Config.dict!
    expect(Object.keys(dict)).toEqual(fields)
    for (const field of fields) {
      expect(dict[field]!.meta.volatile).toBe(true)
    }
  })

  it('defaults mirror the composition base (an unset field resolves to it)', () => {
    const dict = Config.dict!
    expect(dict.openBlocklist!.meta.default).toEqual([...DEFAULT_OPEN_BLOCKLIST])
    expect(dict.maxLines!.meta.default).toBe(MAX_LINES_DEFAULT)
    expect(dict.maxBytes!.meta.default).toBe(MAX_BYTES_DEFAULT)
    expect(dict.serverUrl!.meta.default).toBe('')
    expect(dict.pathMap!.meta.default).toBe('')
    expect(dict.openAsDefault!.meta.default).toBe(false)
  })

  it('keys the section by the composition entry id', () => {
    // The namespace the settings service (and the browser half's config
    // form) keys this section by IS the entry id the patch declares.
    expect(VSCODE_SIDEBAR_SETTINGS_NAMESPACE).toBe('dsh-sidebar-vscode')
  })
})
