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
import { readFileSync } from "node:fs";

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import rhythmguard from "stylelint-plugin-rhythmguard/eslint";

// Local repo-specific flat-config plugin (#197 + #234). Plain ESM, no build step
// — see tools/lint/eslint-rules/index.mjs. Imported by relative path so this
// config is self-contained regardless of workspace-package hoisting.
import localRules from "./tools/lint/eslint-rules/index.mjs";

// #234 — the lint guardrails consume ONE generated source of truth: the
// allowed-token enumeration emitted by the Style Dictionary token-build (#233).
// The rhythmguard arbitrary-spacing gate needs the *effective* spacing scale in
// px (the inert `--spacing-N` theme keys do not drive the numeric `p-4`/`gap-2`
// utilities under Tailwind v4 — those derive from the single `--spacing`
// multiplier — so the scale is derived from the `space.*` token VALUES and
// emitted as `spacingScalePx`). Reading it here keeps styling + linting in lockstep.
const allowedTokens = JSON.parse(
  readFileSync(
    new URL(
      "./packages/design-system/src/styles/allowed-tokens.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const SPACING_SCALE_PX = allowedTokens.spacingScalePx;

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
      // Gitignored local scratch (e.g. the retro audit workspace, tools/retro
      // out-dir default). Absent in CI; ignore so local `pnpm lint` matches.
      ".audit-tmp/**",
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
  {
    // #234 — design-system lint guardrails (spec §4), Layer-3 (project ESLint
    // rules) + the rhythmguard scale gate, blocking on the `apps/**` surfaces.
    // These ride the existing `eslint .` → `lint` CI job (no new job) and the
    // lint-staged pre-commit hook (fast feedback). The single source of truth for
    // the allowed scale is the generated allowed-tokens.json (loaded above).
    //
    //   • local/no-arbitrary-tailwind-value — broad backstop: forbids the
    //     Tailwind arbitrary-VALUE escape hatch (`bg-[#fff]`, `p-[13px]`,
    //     `rounded-[7px]`, `w-[323px]`) in className strings (arbitrary VARIANTS
    //     like `data-[…]:` stay allowed). Covers every axis.
    //   • rhythmguard-tailwind/tailwind-class-use-scale — tighter, autofixing
    //     gate for arbitrary SPACING specifically: flags `p-[13px]`/`gap-[18px]`
    //     off the effective scale and fixes to the nearest scale value. Color is
    //     handled by oxlint's `tailwindcss/no-hardcoded-colors` (oxlint.json).
    //   • local/no-token-redefinition — forbids forking a generated token value
    //     via inline style / setProperty in app code (token values change only
    //     in the @ds/design-system source).
    files: ["apps/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      local: localRules,
      "rhythmguard-tailwind": rhythmguard,
    },
    rules: {
      "local/no-arbitrary-tailwind-value": "error",
      "local/no-token-redefinition": "error",
      "rhythmguard-tailwind/tailwind-class-use-scale": [
        "error",
        { scale: SPACING_SCALE_PX },
      ],
    },
  },
  prettier,
];
