import { test, expect } from "@playwright/test";

/**
 * 004 EARS-9 — cross-surface live-state consistency, driven in the running UI.
 * A live event's "live now" signal («В эфире») must appear on BOTH its listing
 * card at `/webinars` AND its event page at `/webinars/:slug`, because both
 * surfaces derive the signal from the same `EventLifecycleState` (`state ===
 * 'live'`, design §5.3) — there is no second projection to drift, so a doctor
 * never sees a contradictory state across the two surfaces.
 *
 * Live-stand-gated tier (mirrors `event-page.e2e.spec.ts` /
 * `webinars-listing.e2e.spec.ts`): needs a running portal whose `/v1/*` rewrite
 * reaches a running api + Postgres. It `test.skip`s unless `E2E_PORTAL_URL` and a
 * seeded live slug are provided, so a stray CI invocation is inert. The seed is
 * the 004↔007 fixture seam (lifecycle transitions are feature 007, parent #549):
 *   - `E2E_WEBINAR_SLUG_LIVE` — a seeded `live` event whose card the listing must
 *     show with «В эфире», and whose page must carry the same signal.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG_LIVE = process.env.E2E_WEBINAR_SLUG_LIVE;
const LIVE_LABEL = "В эфире";

test.skip(
  !process.env.E2E_PORTAL_URL || !SLUG_LIVE,
  "requires a live portal + a seeded live event slug",
);

test.describe("004 EARS-9 cross-surface live-state consistency (e2e)", () => {
  test("EARS-9: when an event is live, its listing card shows the «В эфире» signal", async ({
    page,
  }) => {
    await page.goto(`${BASE}/webinars`, { waitUntil: "domcontentloaded" });

    const card = page.locator("[data-webinar-card]", {
      has: page.locator(`a[href="/webinars/${SLUG_LIVE}"]`),
    });
    await expect(card).toBeVisible();
    // The live signal is inside the card itself (derived from state === 'live').
    await expect(card).toContainText(LIVE_LABEL);
  });

  test("EARS-9: when an event is live, its event page shows the same «В эфире» signal — the two surfaces agree", async ({
    page,
    context,
  }) => {
    // Guest recipient of the distributed link — the page is public, no auth.
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}`, {
      waitUntil: "domcontentloaded",
    });

    // The same live signal the card carried is present on the page — both read
    // the one `EventLifecycleState`, so they can never contradict for one event.
    await expect(page.getByText(LIVE_LABEL).first()).toBeVisible();
  });
});
