import { describe, expect, it } from "vitest";

import { evidenceProfilesForPaths, isUiSourcePath } from "../lib/ui-surface";

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
    "packages/design-system/src/index.ts",
    "packages/design-system/src/lib/utils.ts",
    "packages/design-system/src/primitives/interactive-base.ts",
    "apps/portal/lib/theme.ts",
    "apps/portal/lib/auth-error-message.ts",
  ])("green: %s is rendered UI source", (path) => {
    expect(isUiSourcePath(path)).toBe(true);
  });

  it.each([
    "apps/api/src/main.ts",
    "packages/db/src/index.ts",
    "apps/portal/lib/consent.ts",
    "apps/admin/lib/admin-auth.ts",
    "apps/docs/lib/source.ts",
  ])("red: %s is outside rendered UI roots", (path) => {
    expect(isUiSourcePath(path)).toBe(false);
  });

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
    "packages/design-system/src/styles/allowed-tokens.json",
    "packages/design-system/src/primitives/button.test.ts",
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

  it.each([
    "apps/admin/messages/ru.json",
    "packages/design-system/tokens/primitive.json",
    "packages/design-system/tokens/semantic.json",
    "packages/design-system/tokens/semantic.dark.json",
    "packages/design-system/tokens/component.json",
    "packages/design-system/src/styles/tokens.css",
  ])("green: %s can change user-visible rendering", (path) => {
    expect(isUiSourcePath(path)).toBe(true);
  });

  it("assigns responsive-web and native-mobile evidence profiles", () => {
    expect(evidenceProfilesForPaths(["apps/portal/app/page.tsx"])).toEqual([
      "responsive-web",
    ]);
    expect(
      evidenceProfilesForPaths(["apps/mobile/src/screens/home.tsx"]),
    ).toEqual(["native-mobile"]);
    expect(
      evidenceProfilesForPaths([
        "apps/mobile/src/screens/home.tsx",
        "apps/admin/app/page.tsx",
      ]),
    ).toEqual(["native-mobile", "responsive-web"]);
  });
});
