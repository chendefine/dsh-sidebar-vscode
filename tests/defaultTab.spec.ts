/**
 * Unit tests for the "sidebar opens VSCode by default" behavior
 * (src/client/defaultTab.ts).
 *
 * The three safety rails are pinned here: the PRISTINE gate (only an
 * untouched fresh-session seed is swapped — any activity keeps the
 * session's own layout), the ONCE marker (closing the swapped tab must
 * never re-trigger the swap), and the enable/landed gates (a disabled or
 * refused open must never cost the sidebar its seed). The watcher wiring
 * is exercised through a fake service: evaluate-on-startup, evaluate on
 * every store notification, and the disposer.
 *
 * @module dsh-sidebar-vscode/tests/defaultTab.spec
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPEN_AS_DEFAULT_KEY,
  applyDefaultTab,
  isPristineSeed,
  seedTabIdOf,
  watchDefaultTab,
  type DefaultTabServiceFace,
  type DefaultTabStateShape,
} from '../src/client/defaultTab.ts'
import { TAB_ID } from '../src/client/settings.ts'

// ── fixtures ────────────────────────────────────────────────────────────────

/** The seed tab better-sidebar mints for every brand-new session. */
const SEED_TAB = { id: 'tab:1', type: 'editor', title: 'Files', meta: { treeOpen: true } }

/** The exact state `makeDefaultState('editor-home')` produces. */
function seededState(): DefaultTabStateShape {
  return {
    nextTerminal: 1,
    nextBrowser: 1,
    expanded: [],
    bottomOpenedOnce: false,
    splits: { kind: 'leaf', id: 'pane:1', tabs: [{ ...SEED_TAB }], active: SEED_TAB.id },
    bottomSplits: { kind: 'leaf', id: 'pane:2', tabs: [], active: null },
    floats: [],
  }
}

/** A minimal localStorage stub (the node test env has none). */
function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
  return store
}

interface FakeOptions {
  sessionId?: string
  /** The tab-type enablement the service reports. */
  enabled?: boolean
  /** The persisted openAsDefault plugin setting (undefined = unset). */
  setting?: unknown
  /** When false, openTab records the call but never lands the tab
   * (simulates a refused open: missing descriptor, throwing reducer). */
  land?: boolean
}

/**
 * A fake DefaultTabServiceFace over a mutable state cell: openTab really
 * lands single-instance tabs in the (single-pane) tree and closeTab
 * removes them, so the landed-check in applyDefaultTab observes the same
 * transitions the real store produces.
 */
function makeFakeService(state: DefaultTabStateShape | undefined, options: FakeOptions = {}) {
  const listeners = new Set<() => void>()
  const opens: string[] = []
  const closes: string[] = []
  const enabled = options.enabled ?? true
  const land = options.land ?? true
  let setting = options.setting
  const sessionId = options.sessionId ?? 's1'
  const service: DefaultTabServiceFace = {
    getSnapshot: () => {
      const pluginSettings: Record<string, Record<string, unknown>> = {}
      if (setting !== undefined) pluginSettings[TAB_ID] = { [OPEN_AS_DEFAULT_KEY]: setting }
      return { sessionId, state, prefs: { pluginSettings } }
    },
    subscribeState(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    isTabEnabled: () => enabled,
    openTab: (seed) => {
      opens.push(seed.type)
      if (!land || state === undefined) return
      // Single-instance semantics: focus an existing tab of the type.
      if (state.splits.kind === 'leaf' && state.splits.tabs.some(tab => tab.type === seed.type)) return
      if (state.splits.kind === 'leaf') {
        state = {
          ...state,
          splits: { ...state.splits, tabs: [...state.splits.tabs, { id: seed.type, type: seed.type, title: seed.type }], active: seed.type },
        }
      }
    },
    closeTab: (tabId) => {
      closes.push(tabId)
      if (state === undefined || state.splits.kind !== 'leaf') return
      const tabs = state.splits.tabs.filter(tab => tab.id !== tabId)
      state = { ...state, splits: { ...state.splits, tabs, active: tabs[tabs.length - 1]?.id ?? null } }
    },
  }
  return {
    service,
    opens,
    closes,
    setState(next: DefaultTabStateShape | undefined): void { state = next },
    setSetting(next: unknown): void { setting = next },
    notify(): void { for (const listener of [...listeners]) listener() },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── isPristineSeed / seedTabIdOf ────────────────────────────────────────────

describe('isPristineSeed', () => {
  it('accepts the untouched editor-home seed', () => {
    expect(isPristineSeed(seededState())).toBe(true)
  })

  it('accepts the empty seed (the editor tab type disabled)', () => {
    const state = seededState()
    ;(state.splits as { tabs: unknown[] }).tabs = []
    expect(isPristineSeed(state)).toBe(true)
  })

  it('rejects a seed carrying a path-bearing editor tab (a file was opened)', () => {
    const state = seededState()
    ;(state.splits as { tabs: { path?: string }[] }).tabs[0]!.path = '/tmp/a.ts'
    expect(isPristineSeed(state)).toBe(false)
  })

  it('rejects a second tab beside the seed', () => {
    const state = seededState()
    ;(state.splits as { tabs: unknown[] }).tabs.push({ id: 'tab:2', type: 'git', title: 'Git' })
    expect(isPristineSeed(state)).toBe(false)
  })

  it('rejects a terminal ever having been minted', () => {
    const state = seededState()
    state.nextTerminal = 2
    expect(isPristineSeed(state)).toBe(false)
  })

  it('rejects an expanded directory', () => {
    const state = seededState()
    state.expanded = ['/data/workspace/src']
    expect(isPristineSeed(state)).toBe(false)
  })

  it('rejects a bottom-panel tab and a bottom-panel expansion', () => {
    const withTab = seededState()
    ;(withTab.bottomSplits as { tabs: unknown[] }).tabs.push({ id: 'tab:9', type: 'terminal', title: '终端' })
    expect(isPristineSeed(withTab)).toBe(false)
    const expanded = seededState()
    expanded.bottomOpenedOnce = true
    expect(isPristineSeed(expanded)).toBe(false)
  })

  it('rejects a float window', () => {
    const state = seededState()
    state.floats = [{ id: 'float:1' }]
    expect(isPristineSeed(state)).toBe(false)
  })
})

describe('seedTabIdOf', () => {
  it('returns the seed tab id on an editor-home seed', () => {
    expect(seedTabIdOf(seededState())).toBe(SEED_TAB.id)
  })

  it('returns undefined on an empty seed', () => {
    const state = seededState()
    ;(state.splits as { tabs: unknown[] }).tabs = []
    expect(seedTabIdOf(state)).toBeUndefined()
  })
})

// ── applyDefaultTab ─────────────────────────────────────────────────────────

describe('applyDefaultTab', () => {
  it('swaps the seed for the VSCode tab (open then close, tab active)', () => {
    stubLocalStorage()
    const fake = makeFakeService(seededState())
    expect(applyDefaultTab(fake.service)).toBe(true)
    expect(fake.opens).toEqual([TAB_ID])
    expect(fake.closes).toEqual([SEED_TAB.id])
    const state = fake.service.getSnapshot().state!
    expect(state.splits.kind === 'leaf' && state.splits.tabs.map(tab => tab.type)).toEqual([TAB_ID])
    expect(state.splits.kind === 'leaf' && state.splits.active).toBe(TAB_ID)
  })

  it('never closes the seed when the open did not land', () => {
    stubLocalStorage()
    const fake = makeFakeService(seededState(), { land: false })
    expect(applyDefaultTab(fake.service)).toBe(true)
    expect(fake.opens).toEqual([TAB_ID])
    expect(fake.closes).toEqual([])
    const after = fake.service.getSnapshot().state!
    expect(after.splits.kind === 'leaf' && after.splits.tabs.map(tab => tab.id)).toEqual([SEED_TAB.id])
  })

  it('is a strict no-op for a disabled tab type', () => {
    stubLocalStorage()
    const fake = makeFakeService(seededState(), { enabled: false })
    expect(applyDefaultTab(fake.service)).toBe(false)
    expect(fake.opens).toEqual([])
    expect(fake.closes).toEqual([])
  })

  it('is a strict no-op without an active session or state', () => {
    stubLocalStorage()
    expect(applyDefaultTab(makeFakeService(undefined).service)).toBe(false)
    expect(applyDefaultTab(makeFakeService(undefined, { sessionId: undefined }).service)).toBe(false)
  })

  it('marks the session: a later call (state back to empty) never re-swaps', () => {
    stubLocalStorage()
    const fake = makeFakeService(seededState())
    applyDefaultTab(fake.service)
    // The user closes the VSCode tab: the state looks pristine again…
    const state = fake.service.getSnapshot().state!
    fake.setState(state)
    fake.service.closeTab(TAB_ID)
    expect(isPristineSeed(fake.service.getSnapshot().state!)).toBe(true)
    // …but the once-marker makes the second pass a no-op.
    expect(applyDefaultTab(fake.service)).toBe(false)
    expect(fake.opens).toEqual([TAB_ID])
  })

  it('leaves a used session alone (non-pristine keeps its layout)', () => {
    stubLocalStorage()
    const state = seededState()
    state.nextTerminal = 2
    const fake = makeFakeService(state)
    expect(applyDefaultTab(fake.service)).toBe(false)
    expect(fake.opens).toEqual([])
    expect(fake.closes).toEqual([])
  })
})

// ── watchDefaultTab ─────────────────────────────────────────────────────────

describe('watchDefaultTab', () => {
  it('applies immediately when the switch is on and the seed is pristine', () => {
    stubLocalStorage()
    const fake = makeFakeService(seededState(), { setting: true })
    const stop = watchDefaultTab(fake.service)
    stop()
    expect(fake.opens).toEqual([TAB_ID])
    expect(fake.closes).toEqual([SEED_TAB.id])
  })

  it('stays dormant while the switch is off, then applies on the write notification', () => {
    stubLocalStorage()
    const fake = makeFakeService(seededState(), { setting: false })
    const stop = watchDefaultTab(fake.service)
    expect(fake.opens).toEqual([])
    // The settings RPC lands late: the write flips the stored value and
    // notifies the store — exactly what the prefs path must catch.
    fake.setSetting(true)
    fake.notify()
    expect(fake.opens).toEqual([TAB_ID])
    stop()
  })

  it('catches a session that becomes active only after the watch started', () => {
    stubLocalStorage()
    const fake = makeFakeService(undefined, { setting: true })
    const stop = watchDefaultTab(fake.service)
    expect(fake.opens).toEqual([])
    fake.setState(seededState())
    fake.notify()
    expect(fake.opens).toEqual([TAB_ID])
    stop()
  })

  it('stops evaluating once disposed', () => {
    stubLocalStorage()
    const fake = makeFakeService(undefined, { setting: true })
    const stop = watchDefaultTab(fake.service)
    stop()
    fake.setState(seededState())
    fake.notify()
    expect(fake.opens).toEqual([])
  })

  it('does not fight the user: the swap notifications are absorbed', () => {
    stubLocalStorage()
    // The real store notifies DURING openTab/closeTab; the re-entrant
    // evaluation must terminate (marker + non-pristine state).
    const listeners = new Set<() => void>()
    let state: DefaultTabStateShape | undefined = seededState()
    const opens: string[] = []
    const service: DefaultTabServiceFace = {
      getSnapshot: () => ({
        sessionId: 's1',
        state,
        prefs: { pluginSettings: { [TAB_ID]: { [OPEN_AS_DEFAULT_KEY]: true } } },
      }),
      subscribeState(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      isTabEnabled: () => true,
      openTab: (seed) => {
        opens.push(seed.type)
        if (state !== undefined && state.splits.kind === 'leaf') {
          state = { ...state, splits: { ...state.splits, tabs: [...state.splits.tabs, { id: seed.type, type: seed.type }], active: seed.type } }
        }
        for (const listener of [...listeners]) listener()
      },
      closeTab: (tabId) => {
        if (state !== undefined && state.splits.kind === 'leaf') {
          const tabs = state.splits.tabs.filter(tab => tab.id !== tabId)
          state = { ...state, splits: { ...state.splits, tabs, active: tabs[tabs.length - 1]?.id ?? null } }
        }
        for (const listener of [...listeners]) listener()
      },
    }
    watchDefaultTab(service)
    expect(opens).toEqual([TAB_ID])
  })
})

describe('OPEN_AS_DEFAULT_KEY', () => {
  it('keeps the persisted key stable', () => {
    expect(OPEN_AS_DEFAULT_KEY).toBe('openAsDefault')
  })
})
