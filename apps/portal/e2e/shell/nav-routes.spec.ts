import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "../support/doctor-session";
import {
  shellHeader,
  shellLogo,
  DISCOVERY_HREF,
  NAV_BROADCASTS,
} from "../support/shell";

/**
 * 008 EARS-2 — every chrome navigation target resolves to a SHIPPED surface: the
 * logo and «Эфиры» both reach `/webinars`, the discovery front-door. No inert or
 * deferred target («Школы» is Retired, EARS-10).
 *
 * Since #2180 the nav is «Эфиры» ALONE on both storefronts (owner decision
 * 2026-09-10, merged 008/017 deltas): the nav grows with features 015/016 and
 * the partner surface, and «Мои события» is reached from the profile rather than
 * from the chrome. The former nav item's destination `/account/events` is still
 * driven end-to-end by the feature-005 specs — this file no longer asserts a nav
 * entry that the product deliberately does not ship.
 *
 * Two tiers: the href RESOLUTION is guest-checkable (only a running portal
 * needed); the driven navigation runs on the LIVE_STAND tier. Each `test.skip`s
 * cleanly when its env is absent.
 */

test.describe("008 EARS-2 header nav targets resolve to shipped surfaces (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test("008 EARS-2: the logo and top-nav items resolve to their shipped routes", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Logo & «Эфиры» → the discovery front-door `/webinars` (`/` permanently
    // redirects there, so the chrome points at the canonical route).
    await expect(shellLogo(page)).toHaveAttribute("href", DISCOVERY_HREF);
    const nav = page.getByTestId("shell-nav-desktop");
    await expect(nav.getByRole("link", { name: NAV_BROADCASTS })).toHaveAttribute(
      "href",
      DISCOVERY_HREF,
    );
    // The nav ships exactly what the host config declares — no inert extras.
    await expect(nav.getByRole("link")).toHaveCount(1);
  });
});

test.describe("008 EARS-2 header nav drives navigation to the shipped surfaces (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("008 EARS-2: the logo and «Эфиры» both drive the doctor to the discovery front-door", async ({
    page,
  }) => {
    await provisionLoggedInDoctor(page);

    // From an authenticated surface, the logo returns to the front-door.
    await page.goto("/account/events", { waitUntil: "domcontentloaded" });
    await shellLogo(page).click();
    await expect(page).toHaveURL(
      new RegExp(`${escapeOrigin()}${DISCOVERY_HREF}(?:$|[?#])`),
    );

    // …and so does «Эфиры».
    await page.goto("/account/events", { waitUntil: "domcontentloaded" });
    await shellHeader(page)
      .getByTestId("shell-nav-desktop")
      .getByRole("link", { name: NAV_BROADCASTS })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${escapeOrigin()}${DISCOVERY_HREF}(?:$|[?#])`),
    );
  });
});

/** The portal origin, regex-escaped, so a URL match pins exactly one route. */
function escapeOrigin(): string {
  const base = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
  return base.replace(/\/$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
