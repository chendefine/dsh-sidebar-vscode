/**
 * Vitest configuration.
 *
 * The host-half boundary (`src/mention.ts`) value-imports `@deepseek-ai/dsh-llm`
 * (createUserMessage / freezeMessage — the same runtime import the built
 * `lib/index.js` keeps external and the DSH host loader resolves in
 * production). The package is a devDependency resolved from the npm registry,
 * and this alias additionally prefers the harness checkout's built artifacts
 * when one sits at the sibling location (the freshest build during in-repo
 * development); environments without that checkout — CI, plain clones — fall
 * back to the installed package, so the alias never depends on machine layout.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Runtime candidates for `@deepseek-ai/dsh-llm`, freshest first. */
const dshLlmCandidates = [
  fileURLToPath(new URL('../../../../app/dsh/packages/llm/llm/lib/index.js', import.meta.url)),
  fileURLToPath(new URL('./node_modules/@deepseek-ai/dsh-llm/lib/index.js', import.meta.url)),
]

const dshLlm = dshLlmCandidates.find(candidate => existsSync(candidate))

export default defineConfig({
  resolve: {
    alias: dshLlm === undefined ? [] : [{
      find: /^@deepseek-ai\/dsh-llm$/,
      replacement: dshLlm,
    }],
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
