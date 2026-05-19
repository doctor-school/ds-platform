/**
 * Root ESLint flat-config — Phase 0 baseline (G3).
 *
 * Composition:
 *   - @eslint/js recommended (JS baseline)
 *   - typescript-eslint recommended (TS baseline, no type-aware rules yet)
 *   - eslint-config-prettier last (disables stylistic rules; Prettier handles formatting)
 *
 * Per ADR-0008 §2.8 and design spec §3.1 the per-rule extensions
 * (no-vercel-only-api, glossary-canonical-ids, …) land in G5 via
 * packages/eslint-config. This root config is the minimum viable scaffold
 * to keep `pnpm lint` green across the monorepo until that lands.
 *
 * Type-aware rules (parserOptions.project / projectService) are intentionally
 * disabled: workspace stubs have no tsconfig.json yet. Enabled in G9+ once
 * apps/packages get real tsconfigs.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/out/**',
      '**/generated/**',
      '**/*.tsbuildinfo',
      'pnpm-lock.yaml',
      '.changeset/**',
      'apps/docs/.source/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      // Pragmatic Phase 0 narrowings; revisited in G5 via packages/eslint-config.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
      // `no-useless-assignment` (recommended) flags defaulted-then-reassigned
      // patterns common in bootstrap/diagnostic scripts; disable until G5.
      'no-useless-assignment': 'off',
    },
  },
  prettier,
];
