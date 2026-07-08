import { test, expect } from "@playwright/test";

/**
 * 005 EARS-4 — the event page reflects the AUTHENTICATED doctor's true
 * registration state via the per-user `EventRegistrationState` read, composed
 * onto the 004 public page WITHOUT contaminating its public, cacheable
 * projection:
 *   • an unregistered doctor (and a guest) sees the 004 «Участвовать» register CTA;
 *   • a registered doctor sees the registered confirmation + join-signpost
 *     placeholder REPLACING the register CTA — never the register CTA as if
 *     unregistered;
 *   • the public page is byte-for-byte identical for a guest and a principal
 *     (asserted server-side in `apps/api/test/registration/state.e2e-spec.ts`; the
 *     browser side here asserts the guest render carries no registered state).
 *
 * Live-stand-gated tier (mirrors `event-page.e2e.spec.ts` / `auth-journeys.e2e.
 * spec.ts`): it needs a running portal whose `/v1/*` rewrite reaches a running api
 * + Postgres seeded with a `published` event, plus a real 003 login. It
 * `test.skip`s unless the dev-stand env is present, so a stray CI invocation is
 * inert. Seeds are the 005↔007 fixture seam (lifecycle transitions are feature
 * 007). The full guest→auth→registered browser journey is owned by the 005
 * portal-integration + E2E child Issue; this spec pins the EARS-4 state swap.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG = process.env.E2E_WEBINAR_SLUG;
// A pre-provisioned doctor known to be REGISTERED for `SLUG` (seeded by the
// operator against the same stand — email + password of an account with a
// registration row for the event).
const DOCTOR_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;

test.skip(
  !process.env.E2E_PORTAL_URL || !SLUG,
  "requires a live portal + a seeded published event slug",
);

// The leading `005 EARS-4 ` prefix is the ears-test-lint feature scope (a
// parenthesized mid-title does NOT scope): it binds this file to feature 005 so
// its EARS-4 references neither satisfy nor stale-flag another spec's EARS-4.
test.describe("005 EARS-4 registered-state overlay on the event page (e2e)", () => {
  test("005 EARS-4: a guest sees the 004 «Участвовать» register CTA and no registered-state confirmation", async ({
    page,
    context,
  }) => {
    // A guest — no session cookie — never issues the authenticated state read, so
    // they see 004's public register CTA, unchanged.
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    const cta = page.getByRole("link", { name: "Участвовать", exact: true });
    await expect(cta).toHaveCount(1);
    await expect(cta).toBeVisible();

    // No registered-state confirmation is composed onto the public page for a guest.
    await expect(page.getByText("Вы записаны", { exact: false })).toHaveCount(0);
  });

  test("005 EARS-4: a registered doctor sees the registered confirmation and NO register CTA (never shown the register CTA as if unregistered)", async ({
    page,
  }) => {
    test.skip(
      !DOCTOR_EMAIL || !DOCTOR_PASSWORD,
      "requires a doctor account registered for the seeded event",
    );

    // Log the doctor in through the real 003 flow (identifier + password).
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/почта|email/i).fill(DOCTOR_EMAIL!);
    await page.getByLabel(/пароль|password/i).fill(DOCTOR_PASSWORD!);
    await page.getByRole("button", { name: /войти|продолжить/i }).click();
    await page.waitForURL(/\/account|\/webinars/);

    // The event page now composes the per-user registered state.
    await page.goto(`${BASE}/webinars/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    // The registered confirmation is present…
    await expect(
      page.getByText("Вы записаны", { exact: false }).first(),
    ).toBeVisible();
    // …and the register CTA is GONE — a registered doctor is never re-offered it.
    await expect(
      page.getByRole("link", { name: "Участвовать", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Записаться", exact: true }),
    ).toHaveCount(0);
  });
});
