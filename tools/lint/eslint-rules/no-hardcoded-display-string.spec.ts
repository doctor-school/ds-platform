import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-hardcoded-display-string.mjs";

/**
 * Unit proof for the `no-hardcoded-display-string` gate (#256).
 *
 * The rule forces every user-facing string on the portal auth surfaces through
 * the next-intl catalog (`{t("…")}`), so RU coverage is a catalog-completeness
 * property rather than a brittle per-string language guess. The "valid" cases are
 * the proof it does NOT over-fire (catalogued `{t()}` text + non-copy attributes
 * pass); the "invalid" cases are the English/hardcoded leaks it must catch.
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

describe("no-hardcoded-display-string", () => {
  it("flags hardcoded copy and allows catalogued strings / non-copy attrs", () => {
    ruleTester.run("no-hardcoded-display-string", rule, {
      valid: [
        // Catalogued copy is an expression container, not JSXText — never flagged.
        { code: `function F(){ return <h1>{t("title")}</h1>; }` },
        { code: `function F(){ return <p>{tc("description")}</p>; }` },
        // Whitespace / punctuation / digits between elements carry no letter.
        { code: `function F(){ return <span>{a} — {b}</span>; }` },
        { code: `function F(){ return <span>{count} 42</span>; }` },
        // User-facing attributes sourced from the catalog (expressions) pass.
        {
          code: `function F(){ return <Input placeholder={tc("emailPlaceholder")} />; }`,
        },
        { code: `function F(){ return <Field label={tc("email")} />; }` },
        { code: `function F(){ return <button aria-label={t("close")} />; }` },
        // Non-copy attributes are never checked, even as literals.
        {
          code: `function F(){ return <div data-testid="login-form" className="mx-auto" role="form" />; }`,
        },
        { code: `function F(){ return <a href="/register" id="x" />; }` },
        {
          code: `function F(){ return <Input type="password" name="password" autoComplete="current-password" inputMode="tel" />; }`,
        },
      ],
      invalid: [
        // English JSX text baked in — the #200/#211 leak class.
        {
          code: `function F(){ return <h1>Sign in</h1>; }`,
          errors: [{ messageId: "hardcodedText" }],
        },
        // Russian-but-hardcoded is ALSO flagged: copy belongs in the catalog
        // regardless of language (so a later second locale is purely additive).
        {
          code: `function F(){ return <p>Войти</p>; }`,
          errors: [{ messageId: "hardcodedText" }],
        },
        // Hardcoded user-facing attributes.
        {
          code: `function F(){ return <Input placeholder="Email" />; }`,
          errors: [{ messageId: "hardcodedAttr" }],
        },
        {
          code: `function F(){ return <Field label="Пароль" />; }`,
          errors: [{ messageId: "hardcodedAttr" }],
        },
        {
          code: `function F(){ return <button aria-label="Close" />; }`,
          errors: [{ messageId: "hardcodedAttr" }],
        },
        // `{"x"}` expression-wrapped literal is still a hardcoded string.
        {
          code: `function F(){ return <img alt={"Logo"} />; }`,
          errors: [{ messageId: "hardcodedAttr" }],
        },
      ],
    });
  });
});
