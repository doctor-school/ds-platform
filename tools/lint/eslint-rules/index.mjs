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

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: "@ds/eslint-rules-local" },
  rules: {
    "no-raw-auth-field-input": noRawAuthFieldInput,
    // #234 design-system lint guardrails (spec §4 level 3).
    "no-arbitrary-tailwind-value": noArbitraryTailwindValue,
    "no-token-redefinition": noTokenRedefinition,
  },
};

export default plugin;
