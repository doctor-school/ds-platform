import { test, expect } from "@playwright/test";

/**
 * 021 #1945 — the landing a gate arrival is promised resolves on THIS app.
 * The door that publishes it renders on the sign-in host now (#3172,
 * `apps/login/e2e/doctor-register-return-context.e2e.spec.ts`); the page it
 * names is this storefront's, so its proof stays on this tier, against
 * `e2e/support/return-context-api.mjs`.
 */
const KNOWN = "prp-pri-gonartroze";

test.describe("021 #1945: the landing a gate arrival is promised", () => {
  test("021 #1945: the landing resolves on this app — it is not a dead path", async ({
    page,
  }) => {
    const response = await page.goto(`/events/${KNOWN}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("event-page-shell")).toBeVisible();

    // And the path the bug used to hand out is genuinely absent on this host —
    // the assertion that keeps the fix from being re-argued as cosmetic.
    const academy = await page.goto(`/webinars/${KNOWN}`, {
      waitUntil: "domcontentloaded",
    });
    expect(academy?.status()).toBe(404);
  });
});
