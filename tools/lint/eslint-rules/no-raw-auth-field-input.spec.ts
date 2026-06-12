import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-raw-auth-field-input.mjs";

/**
 * Unit proof for the `no-raw-auth-field-input` gate (#197, DoD item 4).
 *
 * The rule is the Layer-1 enforcement of EARS-22 (003 design §8.2): on the portal
 * auth surfaces a credential-bearing field (identifier/email/phone/otp/password)
 * MUST come from the semantic primitive registry (`apps/portal/components/fields`),
 * never a raw design-system `<Input>` — that is what guarantees the validation +
 * mask cannot be forgotten the way it was in #192 / #196.
 *
 * RuleTester is driven with the TS+JSX parser (`typescript-eslint`'s parser) so the
 * `.tsx` syntax the auth pages use actually parses. The "valid" cases are the proof
 * the gate does NOT over-fire (the primitives + a genuinely free-form input pass);
 * the "invalid" cases are the deliberately-bad fixtures the gate MUST catch.
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

describe("no-raw-auth-field-input", () => {
  it("flags raw credential <Input> and allows the primitives / free-form inputs", () => {
    ruleTester.run("no-raw-auth-field-input", rule, {
      valid: [
        // The semantic primitives are the sanctioned controls — never flagged.
        { code: `function F(){ return <EmailField name="email" />; }` },
        { code: `function F(){ return <PhoneField name="phone" />; }` },
        { code: `function F(){ return <OtpField name="code" length={6} />; }` },
        { code: `function F(){ return <PasswordField name="password" />; }` },
        {
          code: `function F(){ return <IdentifierField name="identifier" />; }`,
        },
        // A genuinely free-form text input that matches no credential heuristic is
        // allowed — the gate must not block ordinary inputs (search box, name…).
        {
          code: `function F(){ return <Input name="displayName" placeholder="Имя" />; }`,
        },
        // NOTE on the escape hatch: a genuine free-form field is silenced with a
        // standard `// eslint-disable-next-line local/no-raw-auth-field-input -- <reason>`.
        // That is ESLint-core directive processing, not rule logic, so it is not
        // exercised here (RuleTester registers only the rule under its bare id, and a
        // disable comment naming any other id errors with "rule not found"). The
        // directive's behavior is ESLint's own, covered by ESLint's test suite.
      ],
      invalid: [
        // type="password" → a password field.
        {
          code: `function F(){ return <Input type="password" name="password" />; }`,
          errors: [{ messageId: "rawAuthField" }],
        },
        // autoComplete in the credential set → flagged.
        {
          code: `function F(){ return <Input autoComplete="current-password" />; }`,
          errors: [{ messageId: "rawAuthField" }],
        },
        {
          code: `function F(){ return <Input autoComplete="one-time-code" />; }`,
          errors: [{ messageId: "rawAuthField" }],
        },
        {
          code: `function F(){ return <Input autoComplete="email" />; }`,
          errors: [{ messageId: "rawAuthField" }],
        },
        // inputMode tel/email/numeric → flagged.
        {
          code: `function F(){ return <Input inputMode="tel" />; }`,
          errors: [{ messageId: "rawAuthField" }],
        },
        // name/data-testid/placeholder reading as a credential → flagged. This is
        // the exact #192/#196 regression: an identifier box with no other hint.
        {
          code: `function F(){ return <Input name="identifier" autoComplete="username" />; }`,
          errors: [{ messageId: "rawAuthField" }],
        },
        {
          code: `function F(){ return <Input data-testid="otp-identifier" />; }`,
          errors: [{ messageId: "rawAuthField" }],
        },
      ],
    });
  });
});
