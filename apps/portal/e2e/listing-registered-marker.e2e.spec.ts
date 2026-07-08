import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "./support/doctor-session";

/**
 * 004 EARS-8 — the listing card's REGISTERED marker (owner decision, #559
 * Stage-B note): on `/webinars`, the card of an event the VIEWER is registered
 * for carries the canvas `registered` variant's «Вы записаны» marker
 * (`design-source/webinar-card.dc.html`), composed in the portal layer from the
 * viewer's own 005 `MyEvents` read — the PUBLIC `UpcomingBroadcastCard`
 * projection stays publish-safe (EARS-10: no per-user field on the public
 * endpoint), and an unauthenticated render stays byte-identical to before.
 *
 * Live-stand-gated tier (mirrors `event-page-registered.spec.ts`): provisions a
 * REAL 003 doctor (register + Mailpit verify + auto-login), registers them for a
 * seeded event through the REAL one-tap command on the event page (005 EARS-1 —
 * the product path, not a fixture insert), then reads the listing. `test.skip`s
 * unless the live stand env is present, so a stray CI invocation is inert.
 *
 * The registered event is `E2E_MARKER_SLUG` (default `seed-005-upcoming-3`, the
 * spare registrable seed) so this spec never races the 005 journeys that consume
 * `seed-005-upcoming` / `seed-005-upcoming-2`; the control card asserting
 * "other cards unchanged" is `E2E_WEBINAR_SLUG` (default `seed-005-upcoming`).
 */

const SLUG = process.env.E2E_MARKER_SLUG ?? "seed-005-upcoming-3";
const CONTROL_SLUG = process.env.E2E_WEBINAR_SLUG ?? "seed-005-upcoming";
const MARKER = "Вы записаны";

test.describe.configure({ mode: "serial" });

test.describe("004 EARS-8 listing-card registered marker (e2e)", () => {
  test.skip(
    !LIVE_STAND,
    "requires a live portal + real Zitadel + Mailpit (E2E_PORTAL_URL / IDP_ISSUER / MAILPIT_URL) — manual gate",
  );

  test("EARS-8: a registered doctor sees the «Вы записаны» marker on exactly the registered card; a guest sees none", async ({
    page,
    context,
  }) => {
    // A guest first: the public listing carries NO registered marker anywhere.
    await context.clearCookies();
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    await expect(
      page.locator(`a[href="/webinars/${CONTROL_SLUG}"]`).first(),
    ).toBeVisible();
    await expect(page.getByText(MARKER, { exact: false })).toHaveCount(0);

    // Provision a fresh 003 doctor and register them for the spare seeded event
    // through the REAL one-tap command on its page (005 EARS-1).
    await provisionLoggedInDoctor(page);
    await page.goto(`/webinars/${SLUG}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("event-register-one-tap").click();
    await expect(page.getByText(MARKER, { exact: false }).first()).toBeVisible();

    // The listing now marks EXACTLY the registered card.
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    const registeredCard = page.locator(`a[href="/webinars/${SLUG}"]`).first();
    await expect(registeredCard).toBeVisible();
    await expect(registeredCard.getByText(MARKER, { exact: false })).toBeVisible();

    // …and every other card is unchanged — no marker outside the registered card.
    const controlCard = page.locator(`a[href="/webinars/${CONTROL_SLUG}"]`).first();
    await expect(controlCard).toBeVisible();
    await expect(controlCard.getByText(MARKER, { exact: false })).toHaveCount(0);
    await expect(page.getByText(MARKER, { exact: false })).toHaveCount(1);

    // A guest again (cookies dropped): the public render is marker-free — the
    // overlay is per-viewer, never baked into the public projection (EARS-10).
    await context.clearCookies();
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    await expect(
      page.locator(`a[href="/webinars/${SLUG}"]`).first(),
    ).toBeVisible();
    await expect(page.getByText(MARKER, { exact: false })).toHaveCount(0);
  });
});
