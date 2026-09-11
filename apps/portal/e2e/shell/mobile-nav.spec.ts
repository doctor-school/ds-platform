import { test, expect } from "@playwright/test";
import {
  shellHeader,
  DISCOVERY_HREF,
  NAV_BROADCASTS,
} from "../support/shell";

/**
 * 008 EARS-11 — at the mobile breakpoint (the canvas `≤900px`) the top-nav
 * collapses into a `≡` dropdown carrying the SAME items the desktop bar shows,
 * and every nav target still resolves (EARS-2). Driven at a 375px viewport
 * against the shipped header's native `<details>` dropdown.
 *
 * Since #2180 that shared list is «Эфиры» alone (owner decision 2026-09-10), so
 * the dropdown's contract is «exactly what the host config declares», not a
 * hardcoded pair. The doctor-side collapse is owned by the shell journey.
 *
 * Public-surface tier: only a running portal is needed (`E2E_PORTAL_URL`). The
 * guest drive proves target resolution end-to-end. `test.skip`s cleanly on a bare
 * CI run.
 */

test.describe("008 EARS-11 mobile nav collapses into a ≡ dropdown (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test.use({ viewport: { width: 375, height: 800 } });

  test("008 EARS-11: at ≤900px the top-nav collapses into a ≡ dropdown carrying the configured nav items, targets resolving", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The desktop nav is collapsed; the mobile `≡` disclosure takes its place.
    await expect(page.getByTestId("shell-nav-desktop")).toBeHidden();
    const menu = shellHeader(page).getByTestId("shell-mobile-menu");
    await expect(menu).toBeVisible();

    // Open the ≡ dropdown and confirm it carries the same two nav items + targets.
    await menu.locator("summary").click();
    const mobileNav = page.getByTestId("shell-nav-mobile");
    await expect(mobileNav).toBeVisible();
    // The SAME configured targets as the desktop nav — one host config value
    // feeds both, so the two lists cannot drift apart. Since #2180 that list is
    // «Эфиры» alone (owner decision 2026-09-10).
    await expect(mobileNav.getByRole("link")).toHaveCount(1);
    const broadcasts = mobileNav.getByRole("link", { name: NAV_BROADCASTS });
    await expect(broadcasts).toHaveAttribute("href", DISCOVERY_HREF);

    // It closes again — a native `<details>`, trapping nothing.
    await menu.locator("summary").click();
    await expect(mobileNav).toBeHidden();

    // …and the target really navigates.
    await menu.locator("summary").click();
    await mobileNav.getByRole("link", { name: NAV_BROADCASTS }).click();
    await expect(page).toHaveURL(new RegExp(`${DISCOVERY_HREF}(?:$|[?#])`));
  });
});
