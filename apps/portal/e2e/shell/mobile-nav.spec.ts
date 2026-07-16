import { test, expect } from "@playwright/test";
import { shellHeader } from "../support/shell";

/**
 * 008 EARS-11 — at the mobile breakpoint (the canvas `≤900px`) the top-nav
 * collapses into a `≡` dropdown carrying the same [Эфиры · Мои события], and every
 * nav target still resolves (EARS-2). Driven at a 375px viewport against the
 * shipped header's native `<details>` dropdown.
 *
 * Public-surface tier: only a running portal is needed (`E2E_PORTAL_URL`). The
 * guest drive proves target resolution end-to-end — «Эфиры» navigates to `/`, and
 * «Мои события» resolves to the authenticated `/account/events` (a guest is taken
 * through the auth gate to /login, proving the target, not an inert item). The
 * doctor-lands-on-/account/events half is owned by the shell journey. `test.skip`s
 * cleanly on a bare CI run.
 */

test.describe("008 EARS-11 mobile nav collapses into a ≡ dropdown (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test.use({ viewport: { width: 375, height: 800 } });

  test("008 EARS-11: at ≤900px the top-nav collapses into a ≡ dropdown carrying [Эфиры · Мои события], targets resolving", async ({
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
    const broadcasts = page.getByTestId("shell-mobile-broadcasts");
    const myEvents = page.getByTestId("shell-mobile-my-events");
    await expect(broadcasts).toBeVisible();
    await expect(myEvents).toBeVisible();
    // «Эфиры» resolves to the discovery front-door `/` (already the current route);
    // «Мои события» resolves to the feature-005 `/account/events` — both targets
    // resolve, neither is inert (EARS-2).
    await expect(broadcasts).toHaveAttribute("href", "/");
    await expect(myEvents).toHaveAttribute("href", "/account/events");

    // Drive the «Мои события» target: a guest is carried through the auth gate to
    // /login (proving the authenticated target resolved, never a dead item).
    await myEvents.click();
    await expect(page).toHaveURL(/\/login(?:$|[?#])/);
  });
});
