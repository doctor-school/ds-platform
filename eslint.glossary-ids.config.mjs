/**
 * Dedicated flat config for the `glossary-ids` CI job (#468, ADR-0006 §6.3).
 *
 * The main `eslint.config.js` registers `local/glossary-canonical-ids` at `warn`
 * (editor/dev feedback, rides the `lint` job, non-blocking). THIS config is the
 * standalone, PROMOTABLE check surface the ADR-0007 §2.6 WARN→BLOCK sweep needs:
 * it enables ONLY that rule, at `error`, on the same glossary-consumer scope, so
 * `pnpm lint:glossary-ids` exits non-zero on a real violation. The CI job runs it
 * with `continue-on-error: true` (WARN v1) — flip that flag to promote to BLOCK
 * (and add the job to the `ci` needs-list) with no rule change.
 *
 * Passed via `eslint --config`, so it REPLACES the auto-discovered root config —
 * only the TS parser + this one rule apply; all other files/rules are unconfigured.
 */
import tseslint from "typescript-eslint";

import localRules from "./tools/lint/eslint-rules/index.mjs";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/out/**",
      "**/generated/**",
      "apps/docs/.source/**",
    ],
  },
  {
    // Same glossary-consumer scope as the `warn` wiring in eslint.config.js.
    files: ["apps/cms/**/*.{ts,tsx,js,jsx,mjs,cjs}", "apps/docs/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    // This config runs only one rule, so foreign `eslint-disable` directives for
    // other rules read as "unused" — don't report them; only glossary-id findings.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    // `@typescript-eslint` is registered (rules left OFF) only so that foreign
    // `eslint-disable @typescript-eslint/*` directives in scope resolve to a known
    // rule — otherwise ESLint errors "Definition for rule … was not found". This
    // config enforces exactly ONE rule: `local/glossary-canonical-ids`.
    plugins: { local: localRules, "@typescript-eslint": tseslint.plugin },
    rules: {
      "local/glossary-canonical-ids": ["error", { domainEnumIds: ["doctor_guest"] }],
    },
  },
];
