import { Linter, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import rule from "./no-primitive-style-override.mjs";

/**
 * Unit proof for `no-primitive-style-override` (#2180, ADR-0013 §6 Enforcement,
 * tech spec `2026-09-07-one-code-two-storefronts-plan-en.md` §3/§5): a host or a
 * shared block consumes a `@ds/design-system` primitive through its
 * `variant`/`size`/`tone` props plus POSITIONAL utilities only — geometry,
 * typography, colour and borders live in the primitive, so a token change
 * reaches both storefronts by construction.
 *
 * Two harnesses, on purpose. RuleTester covers the CLASSIFICATION (which
 * utility is positional, which restyles). The disable-directive behaviour is
 * driven through a real `Linter` instead, because RuleTester registers the rule
 * under `rule-to-test/…` and therefore rejects a `local/…` directive as an
 * unknown rule — only the Linter reproduces what CI actually does.
 *
 * Engineering-task ids (`2180:`), matching the guard-test id convention.
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

const HOST = "apps/doctor/app/page.tsx";
const SHARED = "packages/storefront-shell/src/storefront-header.tsx";
const DS_IMPORT = `import { Button, Link as DsLink } from "@ds/design-system";\n`;

describe("no-primitive-style-override", () => {
  it("2180: allows positional utilities and prop-driven variants on a DS primitive", () => {
    ruleTester.run("no-primitive-style-override", rule, {
      valid: [
        // Positional only: where the element sits is the business of the call site.
        {
          filename: HOST,
          code: `${DS_IMPORT}const A = () => <Button className="ml-auto hidden layout:inline-flex">x</Button>;`,
        },
        {
          filename: SHARED,
          code: `${DS_IMPORT}const A = () => <DsLink className="relative z-10 w-full max-w-content">x</DsLink>;`,
        },
        // Geometry through props, the sanctioned knob.
        {
          filename: SHARED,
          code: `${DS_IMPORT}const A = () => <Button variant="on-primary" size="chip">x</Button>;`,
        },
        // A responsive / theme prefix on an allowed utility stays allowed.
        {
          filename: HOST,
          code: `${DS_IMPORT}const A = () => <Button className="md:ml-auto dark:hidden">x</Button>;`,
        },
        // No className at all.
        { filename: HOST, code: `${DS_IMPORT}const A = () => <Button>x</Button>;` },
        // A non-DS component is not the business of this rule.
        {
          filename: HOST,
          code: `import { Button } from "./local-button";\nconst A = () => <Button className="px-6 py-3">x</Button>;`,
        },
        // A raw NON-interactive tag may carry any utility.
        {
          filename: SHARED,
          code: `const A = () => <div className="bg-header px-6">x</div>;`,
        },
        // A raw interactive tag with positional-only utilities is fine.
        {
          filename: SHARED,
          code: `const A = () => <button className="ml-auto flex">x</button>;`,
        },
      ],
      invalid: [],
    });
  });

  it("2180: flags spacing, borders and typography overrides on a DS primitive", () => {
    ruleTester.run("no-primitive-style-override", rule, {
      valid: [],
      invalid: [
        {
          filename: HOST,
          code: `${DS_IMPORT}const A = () => <DsLink className="px-6 py-3">x</DsLink>;`,
          errors: [
            { messageId: "primitiveStyleOverride" },
            { messageId: "primitiveStyleOverride" },
          ],
        },
        {
          filename: SHARED,
          code: `${DS_IMPORT}const A = () => <Button className="border-2">x</Button>;`,
          errors: [{ messageId: "primitiveStyleOverride" }],
        },
        {
          filename: SHARED,
          code: `${DS_IMPORT}const A = () => <Button className="text-caption font-bold">x</Button>;`,
          errors: [
            { messageId: "primitiveStyleOverride" },
            { messageId: "primitiveStyleOverride" },
          ],
        },
        // A template literal and `cn(...)` arguments are read the same way.
        {
          filename: SHARED,
          code: `${DS_IMPORT}const A = ({ on }) => <Button className={\`ml-auto \${on ? "" : ""} rounded-full\`}>x</Button>;`,
          errors: [{ messageId: "primitiveStyleOverride" }],
        },
        {
          filename: SHARED,
          code: `${DS_IMPORT}declare const cn: (...a: unknown[]) => string;\nconst A = ({ on }) => <Button className={cn("ml-auto", on && "bg-primary")}>x</Button>;`,
          errors: [{ messageId: "primitiveStyleOverride" }],
        },
        // A responsive prefix does not neutralise a styling utility.
        {
          filename: HOST,
          code: `${DS_IMPORT}const A = () => <Button className="layout:text-lg">x</Button>;`,
          errors: [{ messageId: "primitiveStyleOverride" }],
        },
        // An aliased sub-path import counts too.
        {
          filename: HOST,
          code: `import { Card } from "@ds/design-system/blocks";\nconst A = () => <Card.Header className="p-8">x</Card.Header>;`,
          errors: [{ messageId: "primitiveStyleOverride" }],
        },
        // REGRESSION PIN (#2198 Mode (a) round 1). The shell search band that
        // shipped WITH this rule was itself on the baseline ignore list, so the
        // guard could not see the package that introduced it. The ignore entries
        // are gone and the look now lives on `Input variant="header"`; this
        // fixture is the exact line that used to be exempt, and it must fail.
        {
          filename: "packages/storefront-shell/src/shell-search.tsx",
          code: `import { Input } from "@ds/design-system/input";
const A = () => <Input className="w-full border-header-hairline bg-transparent font-semibold text-header-foreground placeholder:text-header-foreground focus-visible:border-header-foreground" />;`,
          // `w-full` is positional; the other six utilities are the fork.
          errors: [
            { messageId: "primitiveStyleOverride" },
            { messageId: "primitiveStyleOverride" },
            { messageId: "primitiveStyleOverride" },
            { messageId: "primitiveStyleOverride" },
            { messageId: "primitiveStyleOverride" },
            { messageId: "primitiveStyleOverride" },
          ],
        },
      ],
    });
  });

  it("2180: flags a raw interactive tag carrying a styling utility", () => {
    ruleTester.run("no-primitive-style-override", rule, {
      valid: [],
      invalid: [
        {
          filename: SHARED,
          code: `const A = () => <a className="bg-header-foreground px-3" href="/x">x</a>;`,
          errors: [{ messageId: "useDsPrimitive" }, { messageId: "useDsPrimitive" }],
        },
        {
          filename: HOST,
          code: `const A = () => <summary className="rounded-md">x</summary>;`,
          errors: [{ messageId: "useDsPrimitive" }],
        },
      ],
    });
  });

  describe("2180: disable directives", () => {
    const linter = new Linter();
    const config = [
      {
      files: ["**/*.tsx"],
      plugins: { local: { rules: { "no-primitive-style-override": rule } } },
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          ecmaFeatures: { jsx: true },
        },
      },
      rules: { "local/no-primitive-style-override": "error" },
      },
    ] as unknown as Linter.Config[];

    const violation = `${DS_IMPORT}const A = () => <Button className="px-6">x</Button>;`;

    it("2180: reports the override when no directive covers it", () => {
      const messages = linter.verify(violation, config, HOST);
      expect(messages.map((m) => m.messageId)).toEqual(["primitiveStyleOverride"]);
    });

    it("2180: accepts a disable carrying a reason", () => {
      const code = `${DS_IMPORT}// eslint-disable-next-line local/no-primitive-style-override -- owner design decision pending, Issue #2180\nconst A = () => <Button className="px-6">x</Button>;`;
      expect(linter.verify(code, config, HOST)).toEqual([]);
    });

    it("2180: flags a disable that carries no reason", () => {
      const code = `${DS_IMPORT}// eslint-disable-next-line local/no-primitive-style-override\nconst A = () => <Button className="px-6">x</Button>;`;
      const messages = linter.verify(code, config, HOST);
      expect(messages.map((m) => m.messageId)).toEqual(["disableNeedsReason"]);
    });
  });
});
