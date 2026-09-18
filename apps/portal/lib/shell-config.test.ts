import { describe, expect, it } from "vitest";

import { portalNav, portalNavigationModel } from "@/lib/navigation-model";
import {
  academyShellConfig,
  LOGIN_HREF,
  MY_EVENTS_HREF,
  PROFILE_HREF,
  type ShellConfigKey,
} from "@/lib/shell-config";
import catalog from "../messages/ru.json";

/**
 * The §6.3 invariant of the staging/regression-contour tech spec (Issue #2067),
 * stated as a test rather than as a comment: the links this storefront's chrome
 * PAINTS and the links the derived navigation walk VISITS are one list.
 *
 * Both directions are asserted. A destination the chrome paints but the model
 * omits is a link no walk would ever open; a destination the model carries but
 * the chrome paints nowhere is a walk asserting an affordance the visitor cannot
 * reach. The first is the blindness #2067 exists to remove, the second is how a
 * stale model quietly turns green.
 *
 * The translator is the IDENTITY on the key, so an assertion below reads the
 * message KEY the config projects rather than one locale's rendered bytes — the
 * catalog's own copy is covered by the shell tests of `@ds/storefront-shell`.
 */
const echoKey = (key: ShellConfigKey) => key;
const config = academyShellConfig(echoKey);

/** Every destination the shared chrome links to for this host: the wordmark, the
 *  nav, and both branches of the auth cluster (`lib/shell-auth.ts`). */
const paintedHrefs: readonly string[] = [
  config.logo.href,
  ...config.nav.map((item) => item.href),
  LOGIN_HREF,
  PROFILE_HREF,
  // The signed-in cluster's own link — canvas `user.links` line 209, painted by
  // the package beside the chip and in the `≡` menu (#2243). It is a chrome
  // destination like any other, which is exactly why the walk must visit it.
  MY_EVENTS_HREF,
];

describe("§6.3: the academy chrome and the navigation model are one list", () => {
  it("paints no destination the navigation model does not carry", () => {
    const modelHrefs = portalNavigationModel.map((item) => item.href);

    for (const href of paintedHrefs) {
      expect(modelHrefs, `chrome href ${href}`).toContain(href);
    }
  });

  it("carries no model destination the chrome paints nowhere", () => {
    for (const item of portalNavigationModel) {
      expect(paintedHrefs, `model item ${item.id}`).toContain(item.href);
    }
  });

  it("projects the model's own message keys, so no key is stated twice", () => {
    expect(config.logo.href).toBe(portalNav.discovery.href);
    expect(config.nav).toEqual([
      { label: portalNav.discovery.label, href: portalNav.discovery.href },
    ]);
    expect(LOGIN_HREF).toBe(portalNav.login.href);
    expect(PROFILE_HREF).toBe(portalNav.profile.href);
    expect(MY_EVENTS_HREF).toBe(portalNav.myEvents.href);
    // …and it stays OUT of the top nav: the owner decision of 2026-09-10
    // (#2180) ships «Эфиры» alone there.
    expect(config.nav.map((item) => item.href)).not.toContain(MY_EVENTS_HREF);
  });

  it("has no header search: this host owns no results surface", () => {
    expect(config.search).toBeNull();
  });
});

/**
 * 008 EARS-2/12/13/14 — the academy host VALUES the package renders, projected
 * from the real `ru` catalog (the chrome composition itself is proven once in
 * `packages/storefront-shell/src/shell.test.tsx`, driven by BOTH host configs).
 */
describe("008 EARS-2/12/13/14: the academy host config", () => {
  const ru = academyShellConfig(
    (key: ShellConfigKey) => (catalog.shell as Record<string, string>)[key]!,
  );

  it("008 EARS-13: every string is read from the catalog, none hardcoded", () => {
    expect(ru.logo.alt).toBe(catalog.shell.logoAlt);
    expect(ru.nav[0]!.label).toBe(catalog.shell.navBroadcasts);
    expect(ru.footer.giant.text).toBe(catalog.shell.footerGiant);
  });

  it("008 EARS-2: the nav is «Эфиры» alone, pointing at the canonical listing", () => {
    expect(ru.nav).toHaveLength(1);
    expect(ru.nav[0]!.href).toBe("/webinars");
    expect(ru.logo.href).toBe("/webinars");
  });

  it("008 EARS-12: the chrome hides on the auth surfaces and in the room, and nowhere else", () => {
    expect(ru.hiddenOnPaths).toEqual([
      "/login",
      "/register",
      "/verify",
      "/reset",
      "/webinars/*/room",
    ]);
  });

  it("017 EARS-12: exactly one crossing out, and it is the doctor storefront", () => {
    const crossings = JSON.stringify(ru).match(/doctor\.school/g) ?? [];
    expect(crossings).toHaveLength(1);
    expect(ru.footer.cross.href).toBe("https://doctor.school/");
  });
});
