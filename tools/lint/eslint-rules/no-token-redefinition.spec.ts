import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-token-redefinition.mjs";

/**
 * Unit proof for the `no-token-redefinition` gate (#234, spec §4 level 3).
 *
 * The rule forbids re-defining a design-token CSS variable in app code, deriving
 * the protected set from the generated `allowed-tokens.json` (the single source
 * of truth — #233/#234). The fixtures below use `--color-primary`, `--space-4`,
 * `--text-base`, and `--radius-md` — a `:root` var (`--space-4`) and `@theme`
 * namespace keys (`--text-base`, `--radius-md`), all present in that generated
 * enumeration; a non-token custom property (`--my-local`) and token *reads* must
 * pass.
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

describe("no-token-redefinition", () => {
  it("flags redefining a known design token, allows local vars + reads", () => {
    ruleTester.run("no-token-redefinition", rule, {
      valid: [
        // A non-token custom property is the app's own — allowed.
        { code: `const s = { "--my-local-gap": "8px" };` },
        { code: `function F(){ return <div style={{ "--app-sidebar-width": "280px" }} />; }` },
        // READING a token is fine — only (re)definition is forbidden.
        { code: `const s = { color: "var(--color-primary)" };` },
        { code: `const c = el.style.getPropertyValue("--color-primary");` },
        // Ordinary inline style with no custom properties.
        { code: `function F(){ return <div style={{ color: "red", padding: 4 }} />; }` },
      ],
      invalid: [
        // Inline style object key (React `style={{…}}`).
        {
          code: `function F(){ return <div style={{ "--color-primary": "#f00" }} />; }`,
          errors: [{ messageId: "tokenRedefinition" }],
        },
        // A plain style object redefining a spacing token.
        {
          code: `const s = { "--space-4": "13px" };`,
          errors: [{ messageId: "tokenRedefinition" }],
        },
        // A Tailwind `@theme` namespace key form (font-size scale).
        {
          code: `const s = { "--text-base": "13px" };`,
          errors: [{ messageId: "tokenRedefinition" }],
        },
        // setProperty on a CSSStyleDeclaration.
        {
          code: `el.style.setProperty("--radius-md", "7px");`,
          errors: [{ messageId: "tokenRedefinition" }],
        },
        // Computed style assignment.
        {
          code: `el.style["--color-primary"] = "#f00";`,
          errors: [{ messageId: "tokenRedefinition" }],
        },
      ],
    });
  });
});
