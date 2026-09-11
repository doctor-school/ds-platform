import { describe, expect, it } from "vitest";

import { evidenceProfilesForPaths, isUiSourcePath } from "../lib/ui-surface";

describe("rendered UI source classification", () => {
  it.each([
    "apps/academy-demo/src/app/page.tsx",
    "apps/admin/app/page.tsx",
    "apps/cms/src/components/custom.tsx",
    "apps/docs/app/page.tsx",
    // The doctor storefront's chrome moved into `@ds/storefront-shell` (#2180);
    // what the host still owns is the auth-cluster slot filler, which is the
    // live doctor component this row pins.
    "apps/doctor/components/storefront-auth-cluster.tsx",
    "packages/storefront-shell/src/storefront-header.tsx",
    "apps/mobile/src/screens/home.tsx",
    "apps/portal/app/page.tsx",
    "apps/promo/app/page.tsx",
    "apps/showcase/app/page.tsx",
    "packages/design-system/src/primitives/button.tsx",
    "packages/design-system/src/index.ts",
    "packages/design-system/src/lib/utils.ts",
    "packages/design-system/src/primitives/interactive-base.ts",
    "apps/portal/lib/theme.ts",
    "apps/portal/theme.ts",
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
    "packages/design-system/src/generated.d.ts",
    "packages/design-system/src/generated.d.mts",
    "packages/design-system/src/generated.d.cts",
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

/**
 * #1907 — shared-package UI is classified by the `src/ui/**` CONVENTION, not by
 * a hardcoded `packages/room/` name match. A package declares its render-capable
 * surface by putting it under `src/ui/`; everything else in the package (model,
 * server, client, transport, schemas) is not UI evidence just because it lives
 * in a package that happens to own a screen. The pre-#1907 name match made every
 * file in `packages/room/**` — `src/model/display-name.ts`, `src/server/*` —
 * render-capable, so a pure server-logic PR demanded canvas-parity evidence.
 */
describe("ui-surface: shared-package UI is the `src/ui/**` convention (#1907)", () => {
  it.each([
    "packages/room/src/ui/room-view.tsx",
    "packages/room/src/ui/room-header-bar.tsx",
    "packages/room/src/ui/index.ts",
    "packages/events-storefront/src/ui/event-card.tsx",
  ])("green: %s is render-capable package UI", (path) => {
    expect(isUiSourcePath(path)).toBe(true);
  });

  it.each([
    "packages/room/src/index.ts",
    "packages/room/src/model/display-name.ts",
    "packages/room/src/server/room-entry.ts",
    "packages/schemas/src/x.ts",
    "packages/events-storefront/src/server/registration-state.ts",
  ])("red: %s is package non-UI source", (path) => {
    expect(isUiSourcePath(path)).toBe(false);
  });

  it.each([
    "packages/room/src/ui/room-chat.test.tsx",
    "packages/room/src/ui/__tests__/room-chat.tsx",
  ])("red: %s is test code, not UI evidence", (path) => {
    expect(isUiSourcePath(path)).toBe(false);
  });

  it("green: authored .tsx outside src/ui still renders (no #1722 D11 regression)", () => {
    // `packages/room/src/room-shell.tsx` is the composed room screen itself; the
    // convention must not silently drop it when the name match goes away.
    expect(isUiSourcePath("packages/room/src/room-shell.tsx")).toBe(true);
  });
});
