import { test, expect } from "@playwright/test";
import { shellHeader } from "../support/shell";

/**
 * 008 EARS-4 — while the caller is a guest (no authenticated session), the header
 * renders a «Войти» button routing to the login surface, and shows NO avatar and
 * NO «Выйти» (sign-out lives on the profile, feature 009). Driven against the
 * shipped header on the public `/` front-door.
 *
 * Public-surface tier: only a running portal is needed (`E2E_PORTAL_URL`).
 */

test.describe("008 EARS-4 guest header shows «Войти», no avatar, no «Выйти» (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test("008 EARS-4: a guest sees a «Войти» button to the login surface, with no avatar and no «Выйти»", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const header = shellHeader(page);
    // The account affordance resolves (loading → guest) to the «Войти» chip.
    const login = page.getByTestId("shell-login");
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute("href", "/login");

    // No doctor affordance and no sign-out anywhere in the header.
    await expect(page.getByTestId("shell-avatar")).toHaveCount(0);
    await expect(header.getByText(/выйти/i)).toHaveCount(0);

    // Activating «Войти» routes to the login surface.
    await login.click();
    await expect(page).toHaveURL(/\/login(?:$|[?#])/);
  });
});
