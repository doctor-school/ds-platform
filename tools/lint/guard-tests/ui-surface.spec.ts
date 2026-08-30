import { describe, expect, it } from "vitest";

import { isUiSourcePath } from "../lib/ui-surface";

describe("rendered UI source classification", () => {
  it.each([
    "apps/academy-demo/src/app/page.tsx",
    "apps/admin/app/page.tsx",
    "apps/cms/src/components/custom.tsx",
    "apps/docs/app/page.tsx",
    "apps/doctor/components/storefront-header.tsx",
    "apps/mobile/src/screens/home.tsx",
    "apps/portal/app/page.tsx",
    "apps/promo/app/page.tsx",
    "apps/showcase/app/page.tsx",
    "packages/design-system/src/primitives/button.tsx",
  ])("green: %s is rendered UI source", (path) => {
    expect(isUiSourcePath(path)).toBe(true);
  });

  it.each(["apps/api/src/main.ts", "packages/db/src/index.ts"])(
    "red: %s is outside rendered UI roots",
    (path) => {
      expect(isUiSourcePath(path)).toBe(false);
    },
  );

  it.each([
    "apps/doctor/README.md",
    "apps/docs/content/guide.mdx",
    "apps/showcase/package.json",
    "apps/portal/next-env.d.ts",
    "apps/admin/app/page.test.tsx",
    "apps/promo/app/page.spec.tsx",
    "apps/doctor/components/__tests__/header.tsx",
    "apps/mobile/e2e/home.ts",
    "apps/cms/next.config.ts",
    "apps/academy-demo/vitest.setup.ts",
    "packages/design-system/styles/tokens.css",
    "packages/design-system/allowed-tokens.json",
    "apps/portal/Dockerfile",
    "apps/promo/.eslintrc",
    "apps/admin/.env.example",
    "apps/showcase/compose.yaml",
  ])("red: %s is an explicit non-render-source exemption", (path) => {
    expect(isUiSourcePath(path)).toBe(false);
  });

  it("green: authored CSS can change rendered parity", () => {
    expect(isUiSourcePath("apps/doctor/app/storefront.module.css")).toBe(true);
  });
});
