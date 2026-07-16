import { test, expect } from "@playwright/test";
import { DISCOVERY_HEADING, SCAFFOLD_COPY } from "../support/shell";

/**
 * 008 EARS-9 — the `/` «Каркас приложения» scaffold is RETIRED: the placeholder
 * card (whose only action was a "go to sign in" button) is no longer reachable in
 * the portal, and `/` serves the feature-004 discovery listing in its place.
 *
 * Public-surface tier: only a running portal is needed (`E2E_PORTAL_URL`) — `/` is
 * public. `test.skip`s cleanly on a bare CI run.
 */

test.describe("008 EARS-9 the / «Каркас приложения» scaffold is retired (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test("008 EARS-9: / serves the discovery listing and the «Каркас приложения» placeholder is unreachable", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // `/` serves the discovery listing (the feature-004 poster heading).
    await expect(
      page.getByRole("heading", { name: DISCOVERY_HEADING }),
    ).toBeVisible();

    // The retired scaffold card copy appears nowhere on the front-door.
    await expect(page.getByText(SCAFFOLD_COPY)).toHaveCount(0);
  });
});
