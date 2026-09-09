import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./package-import-boundary.mjs";

/**
 * Unit proof for `package-import-boundary` (#2002 slice C, tech spec
 * `2026-09-07-one-code-two-storefronts-plan-en.md` §3 rule 3 «Import boundary»,
 * dependency graph §4).
 *
 * Two classes: (a) a package reaching into `apps/**` at all, (b) a package
 * importing another package against the declared direction. The graph is DATA
 * passed as the `graph` option, so the rule stays generic and the answer key
 * lives in `eslint.import-boundary.config.mjs`. Engineering-task, so the ids are
 * `2002:` rather than EARS ids.
 */
const GRAPH = {
  schemas: [],
  "design-system": ["schemas"],
  room: ["schemas", "design-system"],
  "events-storefront": ["schemas", "design-system"],
  "auth-flow": ["schemas", "design-system", "room", "events-storefront"],
  account: ["schemas", "design-system", "room", "events-storefront", "auth-flow"],
};
const options = [{ graph: GRAPH }];

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

describe("package-import-boundary", () => {
  it("2002: flags any apps/** reach-in from packages/**", () => {
    ruleTester.run("package-import-boundary", rule, {
      valid: [
        {
          filename: "packages/room/src/x.ts",
          options,
          code: `import { a } from "@ds/schemas";`,
        },
        {
          filename: "packages/room/src/x.ts",
          options,
          code: `import { a } from "./sibling";`,
        },
        // A package outside the graph table gets rule (a) only — no direction claim.
        {
          filename: "packages/utils/src/x.ts",
          options,
          code: `import { a } from "@ds/room";`,
        },
        // A non-graph dependency is not a direction finding either.
        {
          filename: "packages/room/src/x.ts",
          options,
          code: `import { a } from "@ds/db";`,
        },
      ],
      invalid: [
        {
          filename: "packages/room/src/x.ts",
          options,
          code: `import { foo } from "apps/portal/lib/foo";`,
          errors: [{ messageId: "noAppsImport" }],
        },
        {
          filename: "packages/room/src/x.ts",
          options,
          code: `import { foo } from "../../../apps/portal/lib/foo";`,
          errors: [{ messageId: "noAppsImport" }],
        },
        {
          filename: "packages/room/src/x.ts",
          options,
          code: `import { foo } from "@/lib/foo";`,
          errors: [{ messageId: "noAppsImport" }],
        },
      ],
    });
  });

  it("2002: flags a cross-package import against the §4 dependency direction", () => {
    ruleTester.run("package-import-boundary", rule, {
      valid: [
        // Wave-1 auth-flow may import room + events-storefront (spec §4).
        {
          filename: "packages/auth-flow/src/x.ts",
          options,
          code: `import { r } from "@ds/room";`,
        },
        {
          filename: "packages/account/src/x.ts",
          options,
          code: `import { a } from "@ds/auth-flow";`,
        },
      ],
      invalid: [
        // Siblings: events-storefront must not reach into room.
        {
          filename: "packages/events-storefront/src/x.ts",
          options,
          code: `import { r } from "@ds/room";`,
          errors: [{ messageId: "wrongDirection" }],
        },
        // Base importing a feature package.
        {
          filename: "packages/design-system/src/y.ts",
          options,
          code: `import { e } from "@ds/events-storefront";`,
          errors: [{ messageId: "wrongDirection" }],
        },
        // A relative hop across the package boundary is the same violation.
        {
          filename: "packages/design-system/src/y.ts",
          options,
          code: `import { r } from "../../room/src/index";`,
          errors: [{ messageId: "wrongDirection" }],
        },
      ],
    });
  });

  it("2002: covers re-export, dynamic import() and require specifiers", () => {
    ruleTester.run("package-import-boundary", rule, {
      valid: [],
      invalid: [
        {
          filename: "packages/room/src/x.ts",
          options,
          code: `export * from "apps/portal/lib/foo";`,
          errors: [{ messageId: "noAppsImport" }],
        },
        {
          filename: "packages/room/src/x.ts",
          options,
          code: `export { foo } from "apps/portal/lib/foo";`,
          errors: [{ messageId: "noAppsImport" }],
        },
        {
          filename: "packages/design-system/src/y.ts",
          options,
          code: `const m = await import("@ds/room");`,
          errors: [{ messageId: "wrongDirection" }],
        },
        {
          filename: "packages/design-system/src/y.ts",
          options,
          code: `const m = require("@ds/room");`,
          errors: [{ messageId: "wrongDirection" }],
        },
      ],
    });
  });
});
