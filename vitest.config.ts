/**
 * Vitest configuration.
 *
 * The host-half boundary (`src/mention.ts`) value-imports `@deepseek-ai/dsh-llm`
 * (createUserMessage / freezeMessage — the same runtime import the built
 * `lib/index.js` keeps external and the DSH host loader resolves in
 * production). For tests, alias it to the harness checkout's built package —
 * the same artifacts tsconfig `paths` points typecheck at. Typecheck-time the
 * package has no node_modules entry (its `workspace:` peers cannot resolve
 * outside the harness repo), so this alias is the single runtime mapping.
 */

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dshLlm = fileURLToPath(new URL('../../../../app/dsh/packages/llm/llm/lib/index.js', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [{
      find: /^@deepseek-ai\/dsh-llm$/,
      replacement: dshLlm,
    }],
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
