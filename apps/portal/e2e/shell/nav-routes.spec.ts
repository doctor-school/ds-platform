import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "../support/doctor-session";
import { shellHeader } from "../support/shell";

/**
 * 008 EARS-2 — every header navigation target resolves to a SHIPPED surface: the
 * logo & «Эфиры» → `/` (the discovery front-door), «Мои события» → `/account/events`
 * (feature 005). No inert or deferred target («Школы» is Retired, EARS-10).
 *
 * Two tiers: the href RESOLUTION is guest-checkable (only a running portal needed);
 * the actual driven navigation into the authenticated `/account/events` needs a
 * doctor session (LIVE_STAND). Each `test.skip`s cleanly when its env is absent.
 */

test.describe("008 EARS-2 header nav targets resolve to shipped surfaces (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test("008 EARS-2: the logo and top-nav items resolve to their shipped routes", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const header = shellHeader(page);
    // Logo & «Эфиры» → the discovery front-door `/`.
    await expect(header.getByTestId("shell-logo")).toHaveAttribute("href", "/");
    await expect(
      page.getByTestId("shell-nav-broadcasts"),
    ).toHaveAttribute("href", "/");
    // «Мои события» → the feature-005 surface `/account/events`.
    await expect(
      page.getByTestId("shell-nav-my-events"),
    ).toHaveAttribute("href", "/account/events");
  });
});

test.describe("008 EARS-2 header nav drives navigation to the shipped surfaces (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("008 EARS-2: activating «Мои события» lands on /account/events; the logo & «Эфиры» return to /", async ({
    page,
  }) => {
    await provisionLoggedInDoctor(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // «Мои события» → /account/events (a doctor, so no auth redirect).
    await page.getByTestId("shell-nav-my-events").click();
    await expect(page).toHaveURL(/\/account\/events$/);

    // The logo returns to the discovery front-door.
    await shellHeader(page).getByTestId("shell-logo").click();
    await expect(page).toHaveURL(new RegExp(`${escapeOrigin()}/$`));

    // «Эфиры» also resolves to `/` from another route.
    await page.goto("/account/events", { waitUntil: "domcontentloaded" });
    await page.getByTestId("shell-nav-broadcasts").click();
    await expect(page).toHaveURL(new RegExp(`${escapeOrigin()}/$`));
  });
});

/** The portal origin, regex-escaped, so a `…/$` URL match pins exactly `/`. */
function escapeOrigin(): string {
  const base = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
  return base.replace(/\/$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
