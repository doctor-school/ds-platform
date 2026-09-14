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
// The import-boundary answer key lives with the promotable guard config (#2002).
import {
  ALLOWED_ADAPTERS,
  PACKAGE_GRAPH,
} from "./eslint.import-boundary.config.mjs";

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
      // `bddgen` output (`packages/e2e/.features-gen/**`, gitignored): generated
      // Playwright specs regenerated on every `test:e2e`. Linting them reports
      // playwright-bdd's own codegen style as repository findings and makes a
      // local `pnpm lint` red purely because a suite was generated.
      "**/.features-gen/**",
      // Next.js generated triple-slash reference files
      "**/next-env.d.ts",
      // #286 — lint-guard-test fixtures are deliberately-broken file trees fed to
      // the guards under test (missing imports, commented-out tokens, raster
      // assets). They are data, not source, and must not be linted.
      "tools/lint/guard-tests/fixtures/**",
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
    // Workflow tool scripts (`.claude/workflows/*.js`) run inside the harness's async
    // script context, not as standalone Node modules: the orchestration hooks are
    // injected globals and the body may `return` its result at top level.
    files: [".claude/workflows/*.js"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { globalReturn: true } },
      globals: {
        agent: "readonly",
        parallel: "readonly",
        pipeline: "readonly",
        phase: "readonly",
        log: "readonly",
        workflow: "readonly",
        args: "readonly",
        budget: "readonly",
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
      // #256 — enforcement gates for two recurring rules deferred by #251 (epic
      // #247). Scoped to the auth surfaces (the defect class's home + what #237
      // rebuilds): RU-i18n coverage (every display string flows through the
      // next-intl catalog, sidestepping brittle language detection) and
      // actionable errors (a catch that shows an error routes it through
      // `authErrorMessage`, which bakes in the EARS-16-generic exception).
      "local/no-hardcoded-display-string": "error",
      "local/auth-catch-uses-error-mapper": "error",
    },
  },
  {
    // 007 EARS-10 — RU-i18n coverage gate for the admin event surface (#595).
    // Every user-facing string on the admin pages/components MUST flow through the
    // next-intl catalog (`apps/admin/messages/ru.json`) via `useTranslations`, so
    // RU coverage is guaranteed and the English-leak class is prevented (mirrors
    // the portal auth-surface gate above). Scoped to the admin app/component tree
    // (not the config/provider plumbing, which carries no display copy). Rides the
    // existing `eslint .` → `lint` CI job.
    files: [
      "apps/admin/app/**/*.tsx",
      "apps/admin/components/**/*.tsx",
    ],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { local: localRules },
    rules: {
      "local/no-hardcoded-display-string": "error",
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
    // #1722 D11 / #2005 — `packages/room/src` and `packages/events-storefront/src`
    // carry UI that used to live under `apps/portal/app`; the tokens-only
    // contract follows the code, so the shared units are scoped here alongside
    // the apps that mount them.
    files: [
      "apps/**/*.{ts,tsx,js,jsx,mjs,cjs}",
      "packages/events-storefront/src/**/*.{ts,tsx}",
      "packages/room/src/**/*.{ts,tsx}",
    ],
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
  {
    // #468 — glossary canonical-id SSOT enforcement (ADR-0006 §6.3). Forbids a
    // bare string literal equal to a glossary canonical id, steering it to the
    // typed `GLOSSARY_IDS.<id>` (import from `@ds/glossary/ids`) so a rename
    // breaks the build. SCOPED to the glossary-CONSUMER surface only (cms +
    // docs), which keeps it entirely off `apps/api/**` / `packages/db|schemas/**`
    // — the home of the ~35 `doctor_guest` RBAC-wire-value sites. WIDEN
    // ADDITIVELY: add a glob here when a new glossary-consumer surface lands.
    // `domainEnumIds: ["doctor_guest"]` exempts the one id that also is a live
    // domain wire-value (the RBAC role, SSOT `apps/api/src/authz/authz.types.ts`
    // ROLES / `idp.types.ts` DOCTOR_GUEST_ROLE) — the rule abstains on it.
    //
    // Severity `warn` here (WARN v1, ADR-0007 §2.6): editor/dev in-line feedback
    // that rides the `eslint .` → `lint` job WITHOUT blocking (eslint exits 0 on
    // warnings). The PROMOTABLE pass/fail check surface for the WARN→BLOCK sweep
    // is the dedicated `glossary-ids` CI job (`pnpm lint:glossary-ids`, its own
    // `eslint.glossary-ids.config.mjs` at `error`).
    files: ["apps/cms/**/*.{ts,tsx,js,jsx,mjs,cjs}", "apps/docs/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { local: localRules },
    rules: {
      "local/glossary-canonical-ids": ["warn", { domainEnumIds: ["doctor_guest"] }],
    },
  },
  {
    // #2002 slice C — the IMPORT BOUNDARY of the one-code-two-storefronts plan
    // (tech spec 2026-09-07-one-code-two-storefronts-plan-en.md §3 rule 3, graph §4).
    // Severity `warn` here (WARN v1, ADR-0007 §2.6): editor/dev in-line feedback that
    // rides `eslint .` WITHOUT blocking. The PROMOTABLE pass/fail surface is the
    // dedicated guard (`pnpm lint:import-boundary`, `eslint.import-boundary.config.mjs`
    // at `error`), which owns the same graph table — keep the two in step.
    files: ["packages/**/*.{ts,tsx,mts,cts}"],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__tests__/**"],
    plugins: { local: localRules },
    rules: {
      "local/package-import-boundary": ["warn", { graph: PACKAGE_GRAPH }],
    },
  },
  {
    // #2180 — "hosts never style primitives", the system-wide design-element
    // contract (ADR-0013 §6 Enforcement; tech spec
    // `2026-09-07-one-code-two-storefronts-plan-en.md` §3/§5). Geometry,
    // typography, colour and borders live in the `@ds/design-system` primitive;
    // a host or a shared block passes `variant` / `size` / `tone` and positional
    // utilities only, so one token change reaches BOTH storefronts by
    // construction. Severity ERROR = BLOCK (AGENTS.md §5): a silent per-surface
    // fork is exactly the class #2180 found in the two headers, and it is
    // invisible in review.
    //
    // SCOPE: the storefront hosts plus the shared chrome packages that carry UI
    // which used to live in a host (`storefront-shell`, `events-storefront`,
    // `room`). NOT `packages/design-system/**` — a primitive legitimately styles
    // itself — and not `apps/showcase` (its job is to demonstrate primitives,
    // including deliberate overrides) nor test / e2e sources.
    files: [
      "apps/**/*.{ts,tsx,js,jsx,mjs,cjs}",
      "packages/storefront-shell/src/**/*.{ts,tsx}",
      "packages/events-storefront/src/**/*.{ts,tsx}",
      "packages/room/src/**/*.{ts,tsx}",
    ],
    //
    // LEGACY BASELINE (decision-debt, DEBT.md 2026-09-14). The rule lands with
    // 143 pre-existing hits across the 23 files enumerated below. Every one of
    // them is a real per-surface fork, but retiring it means ADDING a
    // canvas-backed `variant` / `size` / `tone` to the primitive — a product
    // decision the owner makes on a canvas, never a lint-driven guess (AGENTS.md
    // §6 "UI is approved, then driven by the agent, then re-confirmed live"), and
    // changing any of these looks would mutate a LIVE surface. So the severity
    // stays ERROR and the exception set is ENUMERATED AT FILE GRANULARITY rather
    // than softened to a warning: every file outside this list is blocked, and
    // the list only ever shrinks. Deleting an entry is the definition of done for
    // that surface.
    //
    // The four `packages/storefront-shell/src/*` files this PR creates are NOT in
    // it: a guard blind to its own subject proves nothing, so the shell chrome
    // carries its look as `variant` / `size` / `tone` / `weight` on the DS
    // primitives instead (27 of the original 170 hits, retired — the rendered
    // result is unchanged, every value is the same one, moved).
    ignores: [
      "apps/showcase/**",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/__tests__/**",
      "**/e2e/**",
      "apps/academy-demo/app/academy-home-view.tsx",
      "apps/admin/app/events/[[]id[]]/page.tsx",
      "apps/admin/app/mfa/challenge/page.tsx",
      "apps/admin/app/mfa/enroll/page.tsx",
      "apps/admin/components/back-to-list.tsx",
      "apps/admin/components/fields.tsx",
      "apps/doctor/app/(storefront)/events/month-pane.tsx",
      "apps/doctor/app/(storefront)/events/page.tsx",
      "apps/doctor/components/account-screen.tsx",
      "apps/doctor/components/specialty-catalog-view.tsx",
      "apps/portal/app/academy-home-view.tsx",
      "apps/portal/app/account/events/page.tsx",
      "apps/portal/app/account/page.tsx",
      "apps/portal/app/documents/page.tsx",
      "apps/portal/app/webinars/[[]slug[]]/recording-gate.tsx",
      "apps/portal/components/calendar-shell.tsx",
      "apps/portal/components/discovery-listing.tsx",
      "apps/portal/components/month-calendar-view.tsx",
      "apps/portal/components/view-switcher.tsx",
      "packages/room/src/ui/display-name-prompt.tsx",
      "packages/room/src/ui/room-chat.tsx",
      "packages/room/src/ui/room-header-bar.tsx",
      "packages/room/src/ui/room-view.tsx",
    ],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { local: localRules },
    rules: {
      "local/no-primitive-style-override": "error",
    },
  },
  {
    // The host-config FILE CONVENTION (the type is #2027). Same WARN posture.
    files: [
      "apps/portal/**/host-config.{ts,tsx}",
      "apps/portal/**/*.host-config.{ts,tsx}",
      "apps/doctor/**/host-config.{ts,tsx}",
      "apps/doctor/**/*.host-config.{ts,tsx}",
    ],
    plugins: { local: localRules },
    rules: {
      "local/host-config-boundary": ["warn", { allowedAdapters: ALLOWED_ADAPTERS }],
    },
  },
  prettier,
];
