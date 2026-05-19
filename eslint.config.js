/**
 * Root ESLint flat-config — placeholder.
 *
 * Real configuration lands in G3 (Step 6: ESLint guards + ADR-0004 rules).
 * Until then, this file exists solely so that `eslint --fix` invoked by
 * the lint-staged pre-commit hook does not error out with
 * "ESLint couldn't find an eslint.config.(js|mjs|cjs) file" on G2+ TS files.
 *
 * Globally ignores everything so eslint exits 0 without parsing anything;
 * this placeholder will be replaced — not extended — in G3.
 */
export default [
  {
    ignores: ['**/*'],
  },
];
