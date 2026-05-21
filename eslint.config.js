import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `examples/**` is ignored wholesale: each example ships its own toolchain
  // (Vite or Next) and per-example tsconfig, none of which is wired into this
  // config's typescript-eslint project. Linting example source here would
  // resolve `react-chorus` imports against the wrong project context. Examples
  // are instead gated by `npm run verify:examples`, which installs and
  // build-smokes every example (see scripts/check-example-metadata.mjs).
  globalIgnores(['coverage', 'dist', 'dist-playground', 'examples/**']),
  {
    // `scripts/**/*.mjs` are real, tested build/verify scripts — lint them too.
    files: ['**/*.{ts,tsx}', 'scripts/**/*.mjs'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // ecmaVersion 2022 covers top-level `await`, used by the scripts/*.mjs files.
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
])
