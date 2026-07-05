import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./glossary-canonical-ids.mjs";

/**
 * Unit proof for the `glossary-canonical-ids` gate (#468, ADR-0006 §6.3).
 *
 * The rule forbids a bare string literal that equals a glossary canonical id in
 * glossary-consumer code, steering it to `GLOSSARY_IDS.<id>` so a rename breaks
 * the TS build. The id set is loaded from the live glossary source
 * (`apps/docs/content/product/glossary/*.md`, `**Canonical id:**` marker) at
 * module load, so these cases assert against the REAL ids (`consent_gate`,
 * `doctor_guest`, `enumeration_resistance`, `user_mirror`).
 *
 * The `domainEnumIds` option is the id-vs-domain-enum scoping decision: an id that
 * legitimately coincides with a live domain wire-value (`doctor_guest` — the RBAC
 * role, SSOT `apps/api/src/authz/authz.types.ts` ROLES / `idp.types.ts`
 * DOCTOR_GUEST_ROLE) is exempted so the rule abstains on it. The invalid
 * `doctor_guest`-without-option case proves it is the OPTION (not a hardcoded
 * carve-out) that exempts it; the other three ids stay fully enforced.
 */
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
  },
});

describe("glossary-canonical-ids", () => {
  it("flags bare glossary-id literals, exempts typed refs / import sources / domain-enum ids", () => {
    ruleTester.run("glossary-canonical-ids", rule, {
      valid: [
        // The prescribed shape: a typed dot reference, not a bare string literal.
        { code: `const id = GLOSSARY_IDS.consent_gate;` },
        // A colliding domain-enum id, declared via the option, is exempted
        // everywhere (the rule abstains on the ambiguous RBAC wire-value).
        {
          code: `const role = "doctor_guest";`,
          options: [{ domainEnumIds: ["doctor_guest"] }],
        },
        {
          code: `const roles = ["doctor_guest"];`,
          options: [{ domainEnumIds: ["doctor_guest"] }],
        },
        // Import / export source strings are never the concern (a module id that
        // happens to equal a glossary id is not a glossary reference).
        { code: `import { x } from "consent_gate";` },
        { code: `export { y } from "enumeration_resistance";` },
        // Unrelated strings pass.
        { code: `const s = "not_a_glossary_id";` },
        { code: `const s = "hello world";` },
      ],
      invalid: [
        // A bare glossary-id literal in consumer code — steer to GLOSSARY_IDS.
        {
          code: `const x = "consent_gate";`,
          options: [{ domainEnumIds: ["doctor_guest"] }],
          errors: [{ messageId: "useImport" }],
        },
        {
          code: `const x = "enumeration_resistance";`,
          errors: [{ messageId: "useImport" }],
        },
        {
          code: `const x = "user_mirror";`,
          errors: [{ messageId: "useImport" }],
        },
        // Proves the OPTION is what exempts `doctor_guest`: with no domainEnumIds
        // it is flagged like any other id (the collision carve-out is auditable
        // config, not a silent hardcode).
        {
          code: `const x = "doctor_guest";`,
          errors: [{ messageId: "useImport" }],
        },
        // `{"x"}`-wrapped literal in JSX is still a bare literal.
        {
          code: `function F(){ return <GlossaryRef id={"consent_gate"} />; }`,
          errors: [{ messageId: "useImport" }],
        },
      ],
    });
  });
});
