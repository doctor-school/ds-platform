import { test, expect } from "@playwright/test";
import { DISCOVERY_HEADING, SCAFFOLD_COPY } from "../support/shell";

/**
 * 008 EARS-9 — the `/` «Каркас приложения» scaffold is RETIRED: the placeholder
 * card (whose only action was a "go to sign in" button) is no longer reachable in
 * the portal. Per the 008 «Amendment — 2026-08-17» (`008-requirements-en.md`) `/`
 * serves the Academy landing (feature 013) and the feature-004 discovery listing
 * lives at `/webinars`; the scaffold copy appears on neither.
 *
 * Public-surface tier: only a running portal is needed (`E2E_PORTAL_URL`) — both
 * routes are public. `test.skip`s cleanly on a bare CI run.
 */

test.describe("008 EARS-9 the / «Каркас приложения» scaffold is retired (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test("008 EARS-9: / and /webinars serve the landing and the listing, and the «Каркас приложения» placeholder is unreachable", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // `/` is a real page (the Academy landing), not the retired scaffold card.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(SCAFFOLD_COPY)).toHaveCount(0);

    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    // `/webinars` serves the discovery listing (the feature-004 poster heading).
    await expect(
      page.getByRole("heading", { name: DISCOVERY_HEADING }),
    ).toBeVisible();
    await expect(page.getByText(SCAFFOLD_COPY)).toHaveCount(0);
  });
});
