import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-arbitrary-tailwind-value.mjs";

/**
 * Unit proof for the `no-arbitrary-tailwind-value` gate (#234, spec §4 level 3).
 *
 * The rule forbids the Tailwind v4 *arbitrary value* escape hatch
 * (`utility-[literal]`) in app className strings, because it hardcodes a value
 * that bypasses the generated design-token pipeline. The hard part — and the
 * reason this gets its own spec — is that it MUST NOT misfire on Tailwind
 * *arbitrary variants* (`data-[…]:`, `has-[…]:`, `group-[…]:`), which are
 * legitimate conditional styling the design-system primitives already use
 * (input-otp's `has-[:disabled]:opacity-50`, tabs' `data-[state=active]:…`).
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

describe("no-arbitrary-tailwind-value", () => {
  it("flags arbitrary values, allows scale utilities + arbitrary variants", () => {
    ruleTester.run("no-arbitrary-tailwind-value", rule, {
      valid: [
        // Token-backed scale utilities — the sanctioned styling.
        { code: `function F(){ return <div className="p-4 gap-2 text-sm bg-primary rounded-md" />; }` },
        // Arbitrary VARIANTS are conditional styling, not hardcoded values — allowed.
        { code: `function F(){ return <div className="data-[state=active]:bg-background data-[state=active]:text-foreground" />; }` },
        { code: `function F(){ return <div className="has-[:disabled]:opacity-50" />; }` },
        { code: `function F(){ return <div className="group-[.is-open]:flex" />; }` },
        { code: `function F(){ return <div className="supports-[display:grid]:grid" />; }` },
        { code: `function F(){ return <div className="aria-[expanded=true]:rotate-180" />; }` },
        // cn() composition with only token utilities passes.
        { code: `function F(){ return <div className={cn("flex items-center", isActive && "ring-2 ring-ring")} />; }` },
        // A fully dynamic className cannot be statically classified — not flagged.
        { code: `function F(){ return <div className={dynamic} />; }` },
        // Non-className attribute with brackets is irrelevant.
        { code: `function F(){ return <div data-foo="x-[1px]" />; }` },
      ],
      invalid: [
        // Hardcoded color via arbitrary value.
        {
          code: `function F(){ return <div className="bg-[#ff5733]" />; }`,
          errors: [{ messageId: "arbitraryValue" }],
        },
        // Arbitrary spacing.
        {
          code: `function F(){ return <div className="p-[13px] gap-[18px]" />; }`,
          errors: [{ messageId: "arbitraryValue" }],
        },
        // Arbitrary radius / size / typography.
        {
          code: `function F(){ return <div className="rounded-[7px]" />; }`,
          errors: [{ messageId: "arbitraryValue" }],
        },
        {
          code: `function F(){ return <div className="w-[323px]" />; }`,
          errors: [{ messageId: "arbitraryValue" }],
        },
        {
          code: `function F(){ return <div className="text-[15px]" />; }`,
          errors: [{ messageId: "arbitraryValue" }],
        },
        // Arbitrary value carried INSIDE an otherwise-legit variant prefix:
        // the variant is fine, the value at the end is not.
        {
          code: `function F(){ return <div className="hover:bg-[#abc]" />; }`,
          errors: [{ messageId: "arbitraryValue" }],
        },
        // Arbitrary CSS-property form.
        {
          code: `function F(){ return <div className="[mask-type:luminance]" />; }`,
          errors: [{ messageId: "arbitraryValue" }],
        },
        // Inside a cn() call.
        {
          code: `function F(){ return <div className={cn("flex", "p-[13px]")} />; }`,
          errors: [{ messageId: "arbitraryValue" }],
        },
        // Inside a template literal.
        {
          code: "function F(){ return <div className={`flex w-[50px]`} />; }",
          errors: [{ messageId: "arbitraryValue" }],
        },
      ],
    });
  });
});
