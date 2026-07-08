import { expect } from "@playwright/test";
import { Given, Then, When, test } from "../support/fixtures";
import {
  LIVE_STAND,
  provisionLoggedInDoctor,
  submitRegisterAndVerify,
} from "../support/doctor-session";

/**
 * 005 registration-journey step definitions (#574) — the browser translation of
 * the requirements Verification `all` row: guest → «Участвовать» → 003 auth →
 * returns registered → «мои события» → back, plus logged-in one-tap and
 * ended/archived gating, driven on the live dev stand. The whole journey rides a
 * non-Moscow timezone (playwright.config `bdd` project) so the МСК labels prove no
 * viewer-local drift (EARS-11).
 *
 * Fixture events are the seeded `seed-005-*` slugs (apps/api/scripts/seed-events.ts,
 * the 005↔007 seam); the slugs are read from env so a stand with differently-named
 * fixtures can override them.
 */

const SEED = {
  published: process.env.E2E_WEBINAR_SLUG ?? "seed-005-upcoming",
  // A SECOND registrable event so the one-tap path drives an event the doctor is
  // not yet registered for, independently of the guest journey's event.
  oneTap: process.env.E2E_ONE_TAP_SLUG ?? "seed-005-upcoming-2",
  live: process.env.E2E_WEBINAR_SLUG_LIVE ?? "seed-005-live",
  ended: process.env.E2E_WEBINAR_SLUG_ENDED ?? "seed-005-ended",
  archived: process.env.E2E_WEBINAR_SLUG_ARCHIVED ?? "seed-005-archived",
} as const;

const CONFIRMATION = "Вы записаны";
const PARTICIPATE = "Участвовать";

// ── Background ───────────────────────────────────────────────────────────────

Given("the live dev stand is available", async () => {
  // Dev-stand-gated: without a running portal + real Zitadel + Mailpit the whole
  // journey skips cleanly (never a false red on a bare CI run).
  test.skip(
    !LIVE_STAND,
    "requires a live portal + real Zitadel + Mailpit (E2E_PORTAL_URL / IDP_ISSUER / MAILPIT_URL) — manual gate",
  );
});

// ── Guest through auth → registered → «мои события» → back (EARS-2/4/6/11) ────

Given("a guest on the published event page", async ({ page, context, world }) => {
  world.slug = SEED.published;
  // A genuine guest — no session cookie rides the request, so the public 004 page
  // renders its «Участвовать» register CTA (never a per-user registered state).
  await context.clearCookies();
  await page.goto(`/webinars/${world.slug}`, { waitUntil: "domcontentloaded" });
});

When("the guest activates «Участвовать»", async ({ page }) => {
  // The public register CTA is a same-origin `/register?returnTo=/webinars/:slug`
  // link (buildRegistrationHref) — clicking it carries the event context into 003.
  const cta = page.getByRole("link", { name: PARTICIPATE, exact: true });
  await expect(cta).toBeVisible();
  await cta.click();
  await page.waitForURL(/\/register/);
});

When("the guest completes the feature-003 signup flow", async ({ page }) => {
  // Fill the register form the browser is on (the returnTo is already in the URL),
  // read the real verify OTP from Mailpit, and submit — auto-login + the post-auth
  // resume fire `RegisterForEvent` for the carried slug and land on the event page.
  await submitRegisterAndVerify(page);
});

Then(
  "the guest lands back on that same event page in the registered state",
  async ({ page, world }) => {
    // EARS-2: the doctor returns to the ORIGINALLY chosen event, registered — no
    // re-search, no second «Участвовать» tap. The resume navigates to the returnTo.
    await page.waitForURL(new RegExp(`/webinars/${world.slug}(?:$|[?#])`));
    await expect(
      page.getByText(CONFIRMATION, { exact: false }).first(),
    ).toBeVisible();
  },
);

Then("the register CTA is no longer offered", async ({ page }) => {
  // EARS-4: a registered doctor is never re-shown the register affordance.
  await expect(
    page.getByRole("link", { name: PARTICIPATE, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("event-register-one-tap"),
  ).toHaveCount(0);
});

When("the doctor opens «мои события»", async ({ page }) => {
  await page.goto("/account/events", { waitUntil: "domcontentloaded" });
});

Then(
  "the just-registered event is listed, linking back to its event page",
  async ({ page, world }) => {
    // EARS-6/EARS-7: the just-registered event is present immediately, as a card
    // linking back to `/webinars/:slug`.
    const card = page.locator(`a[href="/webinars/${world.slug}"]`).first();
    await expect(card).toBeVisible();
  },
);

Then(
  "every listed time is labeled МСК with no drift to the viewer timezone",
  async ({ page }) => {
    // EARS-11: under the non-Moscow browser timezone (config `bdd` project,
    // America/New_York) every «мои события» instant is still presented in
    // Europe/Moscow, explicitly labeled МСК — no drift to the viewer's local tz.
    await expect(page.locator("body")).toContainText("МСК");
  },
);

When("the doctor opens the listed event from «мои события»", async ({ page, world }) => {
  await page.locator(`a[href="/webinars/${world.slug}"]`).first().click();
  await page.waitForURL(new RegExp(`/webinars/${world.slug}(?:$|[?#])`));
});

Then(
  "the doctor is back on that event page in the registered state",
  async ({ page }) => {
    await expect(
      page.getByText(CONFIRMATION, { exact: false }).first(),
    ).toBeVisible();
  },
);

// ── Logged-in one-tap (EARS-1) ───────────────────────────────────────────────

Given(
  "a logged-in doctor on a second, not-yet-registered published event page",
  async ({ page, world }) => {
    world.slug = SEED.oneTap;
    // Provision a fresh 003 doctor (register + verify + auto-login → /account),
    // then open a SECOND registrable event they are not yet registered for.
    await provisionLoggedInDoctor(page);
    await page.goto(`/webinars/${world.slug}`, { waitUntil: "domcontentloaded" });
    // A logged-in, not-yet-registered doctor gets the one-tap COMMAND button
    // (not the guest `/register` handoff link).
    await expect(page.getByTestId("event-register-one-tap")).toBeVisible();
  },
);

When("the doctor activates the one-tap «Участвовать» command", async ({ page }) => {
  // EARS-1: one action — the button POSTs `RegisterForEvent` and re-reads the
  // per-user state; no trip through auth, no confirmation round-trip.
  await page.getByTestId("event-register-one-tap").click();
});

Then("the event page immediately shows the registered state", async ({ page }) => {
  await expect(
    page.getByText(CONFIRMATION, { exact: false }).first(),
  ).toBeVisible();
});

// ── Register-during-live (EARS-1 + EARS-9, the #673 Stage-B rework) ──────────

Given(
  "a logged-in doctor on the live, not-yet-registered event page",
  async ({ page, world }) => {
    world.slug = SEED.live;
    // A fresh 003 doctor (register + verify + auto-login) — never registered for
    // the seeded live event, so the one-tap command button must be offered
    // (EARS-9: `live` is a registrable state, same affordance as `published`).
    await provisionLoggedInDoctor(page);
    await page.goto(`/webinars/${world.slug}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("event-register-one-tap")).toBeVisible();
  },
);

Then(
  "the doctor is still on that live event page, not a 404",
  async ({ page, world }) => {
    // The rework finding: the live-event «Участвовать» must never navigate to the
    // not-yet-built 006 room (`/webinars/:slug/room` → 404). The one-tap COMMAND
    // registers in place and the SAME page re-renders registered.
    await expect(page).toHaveURL(new RegExp(`/webinars/${world.slug}(?:$|[?#])`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  },
);

Given("a guest on the live event page", async ({ page, context, world }) => {
  world.slug = SEED.live;
  await context.clearCookies();
  await page.goto(`/webinars/${world.slug}`, { waitUntil: "domcontentloaded" });
});

Then(
  "the guest is taken into the auth flow carrying that live event, not a 404",
  async ({ page, world }) => {
    // EARS-2 on a live event: the guest CTA is the same `/register?returnTo=…`
    // auth handoff as `published` — registration first (EARS-9), the room is 006
    // (#584). The event context (slug) rides the returnTo, never a dead room link.
    await page.waitForURL(/\/register\?/);
    expect(page.url()).toContain(
      `returnTo=${encodeURIComponent(`/webinars/${world.slug}`)}`,
    );
  },
);

// ── Lifecycle gating (EARS-9) ────────────────────────────────────────────────

Given("the {string} event page", async ({ page, context, world }, state: string) => {
  world.slug = state === "archived" ? SEED.archived : SEED.ended;
  await context.clearCookies();
  await page.goto(`/webinars/${world.slug}`, { waitUntil: "domcontentloaded" });
});

Then("no register affordance is offered", async ({ page }) => {
  // EARS-9: ended/archived events render NO participation affordance — neither the
  // «Участвовать» register CTA/one-tap nor the footer «Записаться» band.
  await expect(
    page.getByRole("link", { name: PARTICIPATE, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Записаться", exact: true }),
  ).toHaveCount(0);
});

// ── Authz — the per-user surface is authenticated (EARS-10) ───────────────────

Given("a guest with no session", async ({ context, world }) => {
  world.slug = SEED.published;
  await context.clearCookies();
});

When("the guest opens «мои события»", async ({ page }) => {
  await page.goto("/account/events", { waitUntil: "domcontentloaded" });
});

Then("the guest is redirected to the login screen", async ({ page }) => {
  // EARS-10: «мои события» is an authenticated surface — a guest is taken to login,
  // never served a blank or another doctor's data (unlike the public 004 pages).
  await expect(page).toHaveURL(/\/login(?:$|[?#])/);
});

Then("the MyEvents read is refused without a session", async ({ page }) => {
  const res = await page.request.get("/v1/me/events", {
    headers: { accept: "application/json" },
  });
  expect(res.ok(), "MyEvents must not be served to an unauthenticated caller").toBe(
    false,
  );
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

Then(
  "the EventRegistrationState read is refused without a session",
  async ({ page, world }) => {
    const res = await page.request.get(
      `/v1/events/${encodeURIComponent(world.slug)}/registration`,
      { headers: { accept: "application/json" } },
    );
    expect(
      res.ok(),
      "EventRegistrationState must not be served to an unauthenticated caller",
    ).toBe(false);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  },
);

Then(
  "the RegisterForEvent command is refused without a session",
  async ({ page, world }) => {
    const res = await page.request.post(
      `/v1/events/${encodeURIComponent(world.slug)}/registration`,
      { headers: { accept: "application/json" } },
    );
    expect(
      res.ok(),
      "RegisterForEvent must not be satisfied for an unauthenticated caller",
    ).toBe(false);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  },
);
