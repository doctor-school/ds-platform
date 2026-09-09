/**
 * @ds/eslint-rules-local — local flat-config ESLint plugin (#197).
 *
 * Plain ESM so the root `eslint .` path consumes it with no build/tsx step (the
 * root `eslint.config.js` is itself plain ESM). Exposes the repo-specific rules
 * under the `local/` namespace; see each rule file for its rationale + escape hatch.
 */
import noRawAuthFieldInput from "./no-raw-auth-field-input.mjs";
import noArbitraryTailwindValue from "./no-arbitrary-tailwind-value.mjs";
import noTokenRedefinition from "./no-token-redefinition.mjs";
import noHardcodedDisplayString from "./no-hardcoded-display-string.mjs";
import authCatchUsesErrorMapper from "./auth-catch-uses-error-mapper.mjs";
import glossaryCanonicalIds from "./glossary-canonical-ids.mjs";
import packageImportBoundary from "./package-import-boundary.mjs";
import hostConfigBoundary from "./host-config-boundary.mjs";

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: "@ds/eslint-rules-local" },
  rules: {
    "no-raw-auth-field-input": noRawAuthFieldInput,
    // #234 design-system lint guardrails (spec §4 level 3).
    "no-arbitrary-tailwind-value": noArbitraryTailwindValue,
    "no-token-redefinition": noTokenRedefinition,
    // #256 enforcement gates (epic #247): RU-i18n coverage + actionable errors.
    "no-hardcoded-display-string": noHardcodedDisplayString,
    "auth-catch-uses-error-mapper": authCatchUsesErrorMapper,
    // #468 — glossary canonical-id SSOT enforcement (ADR-0006 §6.3).
    "glossary-canonical-ids": glossaryCanonicalIds,
    // #2002 slice C — the import-boundary check of the one-code-two-storefronts
    // plan (tech spec 2026-09-07-one-code-two-storefronts-plan-en.md §3 rule 3):
    // the package dependency graph and host-config purity.
    "package-import-boundary": packageImportBoundary,
    "host-config-boundary": hostConfigBoundary,
  },
};

export default plugin;
