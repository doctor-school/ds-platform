/**
 * Dedicated flat config for the `import-boundary` guard (#2002 slice C, tech
 * spec `2026-09-07-one-code-two-storefronts-plan-en.md` §3 rule 3 / §4).
 *
 * The main `eslint.config.js` registers the same two rules at `warn` (editor and
 * dev feedback, rides the `lint` job, non-blocking). THIS config is the
 * standalone, PROMOTABLE check surface the ADR-0007 §2.6 WARN→BLOCK sweep needs:
 * only these rules, at `error`, on exactly the two scopes, so
 * `pnpm lint:import-boundary` exits non-zero on a real violation. The CI step is
 * `continue-on-error` while `guard-policy.mjs` calls the guard WARN — #2074 flips
 * it to BLOCK with no rule change.
 *
 * It is consumed two ways: `tools/lint/import-boundary-lint.ts` imports this
 * array and hands it to `new ESLint({ overrideConfig })` (so the guard-tests
 * harness can point the same rules at a fixture root via `LINT_FIXTURE_ROOT`),
 * and `eslint --config eslint.import-boundary.config.mjs` works directly.
 */
import tseslint from "typescript-eslint";

// The two rules are imported DIRECTLY rather than through the
// `tools/lint/eslint-rules/index.mjs` barrel: the barrel also loads
// `glossary-canonical-ids`, which reads the glossary source at module load and
// throws when the root is a guard-test fixture tree. A promotable surface should
// load exactly the rules it enforces, and this keeps the fixture harness honest.
import packageImportBoundary from "./tools/lint/eslint-rules/package-import-boundary.mjs";
import hostConfigBoundary from "./tools/lint/eslint-rules/host-config-boundary.mjs";

/** @type {import('eslint').ESLint.Plugin} */
const localRules = {
  meta: { name: "@ds/eslint-rules-local" },
  rules: {
    "package-import-boundary": packageImportBoundary,
    "host-config-boundary": hostConfigBoundary,
  },
};

/**
 * The §4 dependency graph as DATA — the allowed-edges answer key, keyed by
 * package directory name under `packages/`, values = the packages it may import.
 *
 *   @ds/schemas, @ds/design-system      base — import no feature package
 *   @ds/room, @ds/events-storefront     base only; NOT each other
 *   @ds/auth-flow  (wave 1, not yet)    base + room + events-storefront
 *   @ds/account    (wave 4, not yet)    all of the above
 *
 * The two not-yet-existing packages are listed on purpose: the answer key is
 * complete before the code lands, so wave 1 cannot invent a new edge silently.
 * A package absent from this table (db, api-client, utils, hooks, glossary,
 * legal-content, llm-utils, observability, tsconfig, eslint-config) makes no
 * direction claim — it is still forbidden to import `apps/**`.
 */
export const PACKAGE_GRAPH = {
  schemas: [],
  "design-system": ["schemas"],
  room: ["schemas", "design-system"],
  "events-storefront": ["schemas", "design-system"],
  "auth-flow": ["schemas", "design-system", "room", "events-storefront"],
  account: ["schemas", "design-system", "room", "events-storefront", "auth-flow"],
};

/**
 * The CLOSED host-config adapter list. Deliberately EMPTY: `HostConfig` and the
 * adapters it admits are #2027 work — until then a host config is data only, and
 * any function-valued field is a finding.
 */
export const ALLOWED_ADAPTERS = [];

/** Scope 1 — every package source, minus build output and tests. */
export const PACKAGE_FILES = ["packages/**/*.ts", "packages/**/*.tsx", "packages/**/*.mts", "packages/**/*.cts"];

/**
 * Scope 2 — the host-config FILE CONVENTION on the two storefronts. Slice C
 * fixes the convention; #2027 lands the first real config and the `HostConfig`
 * type it satisfies.
 */
export const HOST_CONFIG_FILES = [
  "apps/portal/**/host-config.ts",
  "apps/portal/**/host-config.tsx",
  "apps/portal/**/*.host-config.ts",
  "apps/portal/**/*.host-config.tsx",
  "apps/doctor/**/host-config.ts",
  "apps/doctor/**/host-config.tsx",
  "apps/doctor/**/*.host-config.ts",
  "apps/doctor/**/*.host-config.tsx",
];

const languageOptions = {
  parser: tseslint.parser,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
};

// `@typescript-eslint` is registered (rules left OFF) only so foreign
// `eslint-disable @typescript-eslint/*` directives in scope resolve to a known
// rule; this config enforces exactly the two `local/*` boundary rules.
const plugins = { local: localRules, "@typescript-eslint": tseslint.plugin };

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
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
    ],
  },
  {
    files: PACKAGE_FILES,
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions,
    plugins,
    rules: {
      "local/package-import-boundary": ["error", { graph: PACKAGE_GRAPH }],
    },
  },
  {
    files: HOST_CONFIG_FILES,
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions,
    plugins,
    rules: {
      "local/host-config-boundary": ["error", { allowedAdapters: ALLOWED_ADAPTERS }],
    },
  },
];
