/**
 * Build config: the host half as a plain ESM bundle, and the browser half
 * as a `window.__ModuleLoader__.load({ id, factory })` registration bundle —
 * the official external client-plugin delivery format (same shape as
 * dsh-better-sidebar-onlyoffice and dsh-web-search-aggregation).
 *
 * The client bundle purity gate rejects Node builtins and `@deepseek-ai/*`
 * value imports: the browser half must be self-contained (React comes from
 * the module table; every component it needs lives here; styles are inline).
 */

import { builtinModules } from 'node:module'
import type { UserConfig } from 'tsdown'

const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis']
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map(id => `node:${id}`)])
const PLUGIN_ID = 'dsh-sidebar-vscode'

/** Minimal structural rolldown plugin face (rolldown itself is not hoisted). */
interface PurityPlugin {
  name: string
  resolveId(source: string, importer?: string): string | null | undefined
}

function purityGate(): PurityPlugin {
  return {
    name: 'dsh-sidebar-vscode-client-purity',
    resolveId(source: string) {
      if (NODE_BUILTINS.has(source)) throw new Error(`client bundle cannot import Node builtin ${source}`)
      if (source.startsWith('@deepseek-ai/')) throw new Error(`client bundle cannot value-import ${source}`)
      return null
    },
  }
}

function clientBundle(fileName: string): UserConfig {
  return {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    dts: false,
    sourcemap: true,
    clean: false,
    external: CLIENT_EXTERNALS,
    noExternal: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
    plugins: [purityGate() as unknown as UserConfig['plugins']],
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    outputOptions: {
      entryFileNames: fileName,
      codeSplitting: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2023',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  clientBundle('client.js'),
] satisfies UserConfig[]
