import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "../support/doctor-session";
import { DISCOVERY_HEADING, mainWebinarHrefs } from "../support/shell";

/**
 * 008 EARS-8 — `/` renders the feature-004 discovery listing IDENTICALLY for a
 * guest and a logged-in doctor; the content does not branch on auth state — only
 * the header's account affordance differs («Войти» vs the avatar icon). Driven by
 * capturing the listing's event-link fingerprint in each render and asserting they
 * match, then confirming the header affordance is the only divergence.
 *
 * LIVE_STAND tier (needs a doctor session). A FRESHLY provisioned doctor has no
 * registrations, so the per-viewer 004 «registered» overlay adds nothing — the
 * doctor's `/` is byte-for-byte the guest listing. `test.skip`s on a bare CI run.
 */

test.describe("008 EARS-8 / renders identically for guest and doctor (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("008 EARS-8: the discovery listing content is identical for guest and doctor — only the header affordance differs", async ({
    page,
    context,
  }) => {
    // Guest render of `/`.
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: DISCOVERY_HEADING }),
    ).toBeVisible();
    const guestHrefs = await mainWebinarHrefs(page);
    // The guest's account affordance is «Войти» (no avatar).
    await expect(page.getByTestId("shell-login")).toBeVisible();
    await expect(page.getByTestId("shell-avatar")).toHaveCount(0);

    // Doctor render of `/` (fresh 003 doctor, no registrations).
    await provisionLoggedInDoctor(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: DISCOVERY_HEADING }),
    ).toBeVisible();
    const doctorHrefs = await mainWebinarHrefs(page);
    // The doctor's account affordance is the avatar icon (no «Войти»).
    await expect(page.getByTestId("shell-avatar")).toBeVisible();
    await expect(page.getByTestId("shell-login")).toHaveCount(0);

    // The listing content itself is identical — `/` does not branch on auth.
    expect(doctorHrefs).toEqual(guestHrefs);
  });
});
