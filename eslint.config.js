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
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Local repo-specific flat-config plugin (#197). Plain ESM, no build step — see
// tools/lint/eslint-rules/index.mjs. Imported by relative path so this config is
// self-contained regardless of workspace-package hoisting.
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
      "**/*.tsbuildinfo",
      "pnpm-lock.yaml",
      ".changeset/**",
      "apps/docs/.source/**",
      // Next.js generated triple-slash reference files
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node runtime globals for plain JS/ESM tooling scripts (tools/**/*.mjs).
    // TS files get this from typescript-eslint, which disables `no-undef`.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        // Node 18+ runtime globals (also global in browsers).
        fetch: "readonly",
        AbortController: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      // Pragmatic Phase 0 narrowings; revisited in G5 via packages/eslint-config.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      // `no-useless-assignment` (recommended) flags defaulted-then-reassigned
      // patterns common in bootstrap/diagnostic scripts; disable until G5.
      "no-useless-assignment": "off",
    },
  },
  {
    // #197 — auth-surface field-primitive gate (Layer-1 enforcement of EARS-22,
    // 003 design §8.2). Scoped to ONLY the portal auth surfaces: a credential field
    // (identifier/email/phone/otp/password) there MUST come from the semantic
    // primitives in `apps/portal/components/fields`, never a raw design-system
    // `<Input>` whose validation/mask is hand-wired (the #192/#196 defect class).
    // The rule + its heuristic + the escape hatch are documented in
    // tools/lint/eslint-rules/no-raw-auth-field-input.mjs. It rides the existing
    // `eslint .` → `lint` CI job; no new CI job.
    files: [
      "apps/portal/app/login/**/*.tsx",
      "apps/portal/app/register/**/*.tsx",
      "apps/portal/app/verify/**/*.tsx",
      "apps/portal/app/reset/**/*.tsx",
      "apps/portal/app/account/**/*.tsx",
    ],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { local: localRules },
    rules: {
      "local/no-raw-auth-field-input": "error",
    },
  },
  prettier,
];
