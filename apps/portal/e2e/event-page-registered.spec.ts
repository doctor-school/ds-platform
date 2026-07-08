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

/**
 * 005 EARS-5 — for a registered doctor the event page signposts HOW/WHEN they
 * will join. This binds the two registered signpost modes to the live stand:
 *   • `upcoming` → the МСК start date/time is on the page + a «вы записаны»
 *     confirmation (EARS-5 + EARS-11: no viewer-local drift — the МСК unit is
 *     unit-tested in `lib/msk-signpost.test.ts` with a `timezoneId` override here);
 *   • `live` → an obvious ONWARD path toward the room (feature 006 route
 *     `/webinars/:slug/room`), asserted as the routing target only (006 owns the
 *     room + admission).
 *
 * Same live-stand-gated tier as the EARS-4 block above: it needs a running portal
 * + api + a seeded event and a registered doctor. The registered-`live` case also
 * needs a seeded event in the `live` lifecycle state (`E2E_WEBINAR_SLUG_LIVE`) —
 * the 005↔007 fixture seam (lifecycle transitions are feature 007); it `test.skip`s
 * when that seed is absent so the suite stays inert on a bare stand.
 */
const SLUG_LIVE = process.env.E2E_WEBINAR_SLUG_LIVE;
// The Europe/Moscow render must not drift to the browser's timezone (EARS-11): the
// whole EARS-5 block runs under a deliberately non-Moscow browser TZ.
test.use({ timezoneId: "Asia/Tokyo" });

test.describe("005 EARS-5 registered join signposting on the event page (e2e)", () => {
  test("005 EARS-5: registered + upcoming — the page signposts the МСК start and «вы записаны», no register CTA", async ({
    page,
  }) => {
    test.skip(
      !DOCTOR_EMAIL || !DOCTOR_PASSWORD,
      "requires a doctor account registered for the seeded upcoming event",
    );

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/почта|email/i).fill(DOCTOR_EMAIL!);
    await page.getByLabel(/пароль|password/i).fill(DOCTOR_PASSWORD!);
    await page.getByRole("button", { name: /войти|продолжить/i }).click();
    await page.waitForURL(/\/account|\/webinars/);

    await page.goto(`${BASE}/webinars/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    // The registered confirmation is present…
    await expect(
      page.getByText("Вы записаны", { exact: false }).first(),
    ).toBeVisible();
    // …the МСК start is signposted (the «МСК» label rides the status-card time
    // plate) regardless of the Asia/Tokyo browser timezone (EARS-11, no drift)…
    await expect(page.getByText("МСК", { exact: false }).first()).toBeVisible();
    // …and no register CTA is re-offered.
    await expect(
      page.getByRole("link", { name: "Участвовать", exact: true }),
    ).toHaveCount(0);
  });

  test("005 EARS-5: registered + live — the page shows an obvious onward path to the room (feature 006 route)", async ({
    page,
  }) => {
    test.skip(
      !SLUG_LIVE || !DOCTOR_EMAIL || !DOCTOR_PASSWORD,
      "requires a seeded LIVE event + a doctor registered for it (005↔007 fixture seam)",
    );

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/почта|email/i).fill(DOCTOR_EMAIL!);
    await page.getByLabel(/пароль|password/i).fill(DOCTOR_PASSWORD!);
    await page.getByRole("button", { name: /войти|продолжить/i }).click();
    await page.waitForURL(/\/account|\/webinars/);

    await page.goto(`${BASE}/webinars/${SLUG_LIVE}`, {
      waitUntil: "domcontentloaded",
    });

    // The confirmation is present (a registered doctor is signposted, not gated)…
    await expect(
      page.getByText("Вы записаны", { exact: false }).first(),
    ).toBeVisible();
    // …and the onward path targets the 006 room route for THIS event — 005 asserts
    // the ROUTE only (`/webinars/:slug/room`), not that the room admits.
    const roomLink = page.getByRole("link", { name: "Войти в эфир", exact: true });
    await expect(roomLink).toBeVisible();
    await expect(roomLink).toHaveAttribute("href", `/webinars/${SLUG_LIVE}/room`);
  });
});

/**
 * 005 EARS-9 — registration lifecycle gating on the event page. The register
 * affordance is OFFERED while the event is `published` (upcoming) or `live`, and
 * ABSENT for `ended`/`archived`:
 *   • ended    → no «Участвовать»/«Записаться» affordance anywhere on the page
 *     (the ended render carries no participation CTA — 004 EARS-4);
 *   • archived → likewise no affordance, plus the «в архиве» notice (004 EARS-5);
 *   • register-during-live → a normal path: the single «Участвовать» CTA leads
 *     STRAIGHT TOWARD the room (feature 006 route `/webinars/:slug/room`) —
 *     005 asserts the routing target only (006 owns the room + admission).
 *
 * The server-side refusal (the `RegisterForEvent` command 4xx for ended/archived)
 * is the sibling assertion in `apps/api/test/registration/gating.e2e-spec.ts`;
 * this file pins the client-side affordance-absent + register-during-live routing.
 *
 * Same live-stand-gated tier as the EARS-4/5 blocks above: it needs a running
 * portal + api and events seeded in each target lifecycle state (the 005↔007
 * fixture seam — lifecycle transitions are feature 007). Each case `test.skip`s
 * when its seeded slug is absent, so the suite stays inert on a bare stand.
 */
const SLUG_ENDED = process.env.E2E_WEBINAR_SLUG_ENDED;
const SLUG_ARCHIVED = process.env.E2E_WEBINAR_SLUG_ARCHIVED;

// The leading `005 EARS-9 ` prefix is the ears-test-lint feature scope (a
// parenthesized mid-title does NOT scope): it binds this block to feature 005.
test.describe("005 EARS-9 registration lifecycle gating on the event page (e2e)", () => {
  test("005 EARS-9: an ended event offers NO register affordance (the command is refused server-side)", async ({
    page,
    context,
  }) => {
    test.skip(!SLUG_ENDED, "requires a seeded ended event (005↔007 fixture seam)");

    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG_ENDED}`, {
      waitUntil: "domcontentloaded",
    });

    // No participation affordance is rendered for an ended event — neither the
    // «Участвовать» register CTA nor the footer «Записаться» band.
    await expect(
      page.getByRole("link", { name: "Участвовать", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Записаться", exact: true }),
    ).toHaveCount(0);
  });

  test("005 EARS-9: an archived event offers NO register affordance and shows the «в архиве» notice", async ({
    page,
    context,
  }) => {
    test.skip(
      !SLUG_ARCHIVED,
      "requires a seeded archived event (005↔007 fixture seam)",
    );

    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG_ARCHIVED}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("link", { name: "Участвовать", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Записаться", exact: true }),
    ).toHaveCount(0);
    // The archived render replaces the CTA column with a plain «в архиве» notice.
    await expect(page.getByText("в архиве", { exact: false }).first()).toBeVisible();
  });

  test("005 EARS-9: register-during-live — the «Участвовать» CTA leads straight toward the room (feature 006 route)", async ({
    page,
    context,
  }) => {
    test.skip(
      !SLUG_LIVE,
      "requires a seeded live event (005↔007 fixture seam)",
    );

    // A guest / unregistered doctor on a live event: registration is OFFERED, and
    // the single «Участвовать» CTA routes STRAIGHT toward the room (feature 006).
    // 005 asserts the routing target only — 006 owns the room + its admission.
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}`, {
      waitUntil: "domcontentloaded",
    });

    const cta = page.getByRole("link", { name: "Участвовать", exact: true });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", `/webinars/${SLUG_LIVE}/room`);
  });
});
