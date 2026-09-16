import { describe, expect, it } from "vitest";

import { portalNav, portalNavigationModel } from "@/lib/navigation-model";
import {
  academyShellConfig,
  LOGIN_HREF,
  PROFILE_HREF,
  type ShellConfigKey,
} from "@/lib/shell-config";

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
 *  nav, and both branches of the auth cluster (`academy-shell-header-client`). */
const paintedHrefs: readonly string[] = [
  config.logo.href,
  ...config.nav.map((item) => item.href),
  LOGIN_HREF,
  PROFILE_HREF,
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
  });

  it("has no header search: this host owns no results surface", () => {
    expect(config.search).toBeNull();
  });
});
