/**
 * @ds/eslint-rules-local — local flat-config ESLint plugin (#197).
 *
 * Plain ESM so the root `eslint .` path consumes it with no build/tsx step (the
 * root `eslint.config.js` is itself plain ESM). Exposes the repo-specific rules
 * under the `local/` namespace; see each rule file for its rationale + escape hatch.
 */
import noRawAuthFieldInput from "./no-raw-auth-field-input.mjs";

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: "@ds/eslint-rules-local" },
  rules: {
    "no-raw-auth-field-input": noRawAuthFieldInput,
  },
};

export default plugin;
