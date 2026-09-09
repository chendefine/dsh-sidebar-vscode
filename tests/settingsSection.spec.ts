/**
 * Unit tests for the Host half's `vscode-sidebar` settings section
 * (src/settingsSection.ts): the schema's shape, defaults, and the
 * install helper's fail-soft contract.
 *
 * @module dsh-sidebar-vscode/tests/settingsSection.spec
 */

import { describe, expect, it, vi } from 'vitest'
import {
  installVscodeSidebarSettings,
  vscodeSidebarSettingsSchema,
} from '../src/settingsSection.ts'
import {
  VSCODE_SIDEBAR_SETTINGS_BASE,
  VSCODE_SIDEBAR_SETTINGS_NAMESPACE,
} from '../src/shared/settings.ts'

describe('vscodeSidebarSettingsSchema', () => {
  it('resolves an empty section to exactly the composition base', () => {
    const schema = vscodeSidebarSettingsSchema()
    expect(schema({} as never)).toEqual({
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
    expect(vscodeSidebarSettingsSchema()(section)).toEqual(section)
  })

  it('refuses caps outside the declared bounds', () => {
    const schema = vscodeSidebarSettingsSchema()
    expect(() => schema({ maxLines: 0 } as never)).toThrow()
    expect(() => schema({ maxLines: 9999 } as never)).toThrow()
    expect(() => schema({ maxBytes: 10 } as never)).toThrow()
    expect(() => schema({ maxBytes: 1e9 } as never)).toThrow()
  })
})

describe('installVscodeSidebarSettings', () => {
  /** A recording settings-provider fake. */
  function providerOf() {
    const calls: Array<{ ns: string, entry: Record<string, unknown> }> = []
    return {
      calls,
      installSection(
        _owner: unknown, ns: string, _schema: unknown, entry: Record<string, unknown>,
        hooks: { setSource: (source: () => unknown) => void, onChange: () => void },
      ): void {
        calls.push({ ns, entry })
        hooks.setSource(() => entry)
        hooks.onChange()
      },
    }
  }

  it('registers the namespace with the base entry', () => {
    const provider = providerOf()
    installVscodeSidebarSettings({} as never, provider)
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]!.ns).toBe(VSCODE_SIDEBAR_SETTINGS_NAMESPACE)
    expect(provider.calls[0]!.entry).toEqual({
      openAsDefault: false,
      openBlocklist: [...VSCODE_SIDEBAR_SETTINGS_BASE.openBlocklist],
      serverUrl: '',
      pathMap: '',
      maxLines: 200,
      maxBytes: 20000,
    })
  })

  it('installs nothing on a foreign service shape', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => installVscodeSidebarSettings({} as never, null)).not.toThrow()
    expect(() => installVscodeSidebarSettings({} as never, {})).not.toThrow()
    expect(() => installVscodeSidebarSettings({} as never, { installSection: 5 })).not.toThrow()
    consoleWarn.mockRestore()
  })
})
