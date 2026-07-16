import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionDoctorCreds } from "../support/doctor-session";
import { DISCOVERY_HEADING, SCAFFOLD_COPY } from "../support/shell";

/**
 * 008 EARS-7 — completing the feature-003 LOGIN (no event `returnTo`) lands the
 * doctor on `/` — the discovery listing of upcoming broadcasts — never a
 * «Каркас приложения» placeholder or a dead dashboard. This drives the real
 * `/login` round-trip in the running stack and asserts the landing surface.
 *
 * LIVE_STAND tier: it provisions a doctor with KNOWN credentials (registration
 * lands on /account and verifies the email), clears that auto-login session, then
 * logs in deliberately via `/login` to observe the post-LOGIN landing (distinct
 * from the post-REGISTER landing). `test.skip`s on a bare CI run.
 */

test.describe("008 EARS-7 post-login landing is the discovery front-door / (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("008 EARS-7: completing login (no returnTo) lands on / showing the discovery listing, not a scaffold", async ({
    page,
    context,
  }) => {
    const { email, password } = await provisionDoctorCreds(page);

    // Drop the register auto-login session so `/login` drives a genuine sign-in.
    await context.clearCookies();

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: /почта|email/i }).fill(email);
    await page.getByRole("textbox", { name: /пароль|password/i }).fill(password);
    await page.getByRole("button", { name: /войти|продолжить/i }).click();

    // The landing is the discovery front-door `/` — exactly `/`, no returnTo.
    await page.waitForURL((url) => new URL(url).pathname === "/");

    // `/` serves the feature-004 discovery listing (its poster heading), never the
    // retired «Каркас приложения» scaffold card (EARS-7 / EARS-9).
    await expect(
      page.getByRole("heading", { name: DISCOVERY_HEADING }),
    ).toBeVisible();
    await expect(page.getByText(SCAFFOLD_COPY)).toHaveCount(0);
  });
});
