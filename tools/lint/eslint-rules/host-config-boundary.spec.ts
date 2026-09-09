import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./host-config-boundary.mjs";

/**
 * Unit proof for `host-config-boundary` (#2002 slice C, tech spec
 * `2026-09-07-one-code-two-storefronts-plan-en.md` §3 rule 3 «Import boundary»,
 * second half: «a host-config module imports nothing from `apps/<host>/{lib,
 * components}` … which rejects function-valued fields outside the closed adapter
 * list»).
 *
 * The adapter list is EMPTY in the repo config until #2027 lands `HostConfig`
 * and names the adapters; the option is exercised here so the closed-list
 * mechanism is proven before it carries a value. Engineering-task ids (`2002:`).
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

const FILE = "apps/doctor/host/host-config.ts";

describe("host-config-boundary", () => {
  it("2002: flags host-logic imports into a host-config module", () => {
    ruleTester.run("host-config-boundary", rule, {
      valid: [
        { filename: FILE, code: `import { Cfg } from "@ds/auth-flow";` },
        { filename: FILE, code: `import { copy } from "./copy";` },
      ],
      invalid: [
        {
          filename: FILE,
          code: `import { session } from "@/lib/session";`,
          errors: [{ messageId: "hostLogicImport" }],
        },
        {
          filename: FILE,
          code: `import { Btn } from "@/components/btn";`,
          errors: [{ messageId: "hostLogicImport" }],
        },
        {
          filename: FILE,
          code: `import { session } from "../lib/session";`,
          errors: [{ messageId: "hostLogicImport" }],
        },
      ],
    });
  });

  it("2002: flags a callback field outside the closed adapter list", () => {
    ruleTester.run("host-config-boundary", rule, {
      valid: [
        { filename: FILE, code: `export default { title: "A", steps: ["a"] };` },
        {
          filename: FILE,
          options: [{ allowedAdapters: ["formatTitle"] }],
          code: `export default { formatTitle: () => "A" };`,
        },
        // Not an exported object literal — the rule claims only the config shape.
        { filename: FILE, code: `const local = { onSuccess: () => {} };\nexport const cfg = { title: "A" };` },
      ],
      invalid: [
        {
          filename: FILE,
          code: `export default { onSuccess: () => {} };`,
          errors: [{ messageId: "callbackOutsideAdapterList" }],
        },
        {
          filename: FILE,
          code: `export const cfg = { onSuccess: function () {} };`,
          errors: [{ messageId: "callbackOutsideAdapterList" }],
        },
        {
          filename: FILE,
          code: `export const cfg = { onSuccess() {} } satisfies HostConfig;`,
          errors: [{ messageId: "callbackOutsideAdapterList" }],
        },
        {
          filename: FILE,
          code: `export default { nested: { onSuccess: () => {} } } as HostConfig;`,
          errors: [{ messageId: "callbackOutsideAdapterList" }],
        },
        {
          filename: FILE,
          options: [{ allowedAdapters: ["formatTitle"] }],
          code: `export default { formatTitle: () => "A", onSuccess: () => {} };`,
          errors: [{ messageId: "callbackOutsideAdapterList" }],
        },
      ],
    });
  });
});
