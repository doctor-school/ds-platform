import { test, expect } from "@playwright/test";
import { LIVE_STAND, provisionLoggedInDoctor } from "./support/doctor-session";

/**
 * 005 EARS-6 / EARS-10 / EARS-11 — the «мои события» Предстоящие tab renders
 * server-side at `/account/events` for an authenticated doctor: their registered
 * upcoming events, day-grouped nearest-first, each with date/time (МСК), title,
 * school, and a link back to `/webinars/:slug`. The canvas empty-state renders
 * when the doctor has no registrations. A guest is redirected to login (the
 * surface is authenticated, EARS-10).
 *
 * Live-stand-gated tier (mirrors `event-page-registered.spec.ts` /
 * `webinars-listing.e2e.spec.ts`): needs a running portal whose `/v1/*` rewrite
 * reaches a running api + Postgres, plus a doctor session. It `test.skip`s unless
 * `E2E_PORTAL_URL` is set, so a stray CI invocation is inert. The seed is the
 * 005↔007 fixture seam (lifecycle transitions are feature 007, parent #564):
 *   - `E2E_SESSION_COOKIE` — a `__Host-ds_session` cookie value for a doctor who
 *     is registered for `E2E_MY_EVENT_SLUG` (the one-tap registration is EARS-1).
 *   - `E2E_MY_EVENT_SLUG` / `E2E_MY_EVENT_TITLE` / `E2E_MY_EVENT_SCHOOL` — the
 *     registered upcoming event the Предстоящие list must show, linking to its page.
 *   - `E2E_MY_EVENTS_EMPTY=1` — the session's doctor has NO registrations, so the
 *     empty-state must render (EARS-6).
 *
 * The session cookie is fingerprint-bound (ADR-0001 §6): the SSR read forwards the
 * request's `user-agent` + `accept-language`, so the browser that owns the cookie
 * must present the same surface it bound at login — the operator seeds the cookie
 * for the default Playwright chromium UA.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const COOKIE = process.env.E2E_SESSION_COOKIE;
const SLUG = process.env.E2E_MY_EVENT_SLUG;
const EXPECTED_EMPTY = process.env.E2E_MY_EVENTS_EMPTY === "1";
const SESSION_COOKIE_NAME = "__Host-ds_session";

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

async function seedSession(context: import("@playwright/test").BrowserContext) {
  if (!COOKIE) return;
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: COOKIE,
      url: BASE,
      httpOnly: true,
      secure: BASE.startsWith("https"),
      sameSite: "Lax",
    },
  ]);
}

test("EARS-10: a guest hitting «мои события» is redirected to login", async ({
  page,
}) => {
  await page.goto(`${BASE}/account/events`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);
});

test("EARS-6: the Предстоящие list shows the registered event with МСК date/time, title, school, and a link to its page", async ({
  page,
  context,
}) => {
  test.skip(!COOKIE || !SLUG, "requires a doctor session + a registered event");
  await seedSession(context);
  await page.goto(`${BASE}/account/events`, { waitUntil: "domcontentloaded" });

  // The «мои события» heading + the МСК-labeled times (EARS-11, no local drift).
  await expect(page.getByRole("heading", { name: "Мои события" })).toBeVisible();
  await expect(page.locator("body")).toContainText("МСК");

  // The registered event is a card linking to its event page (EARS-6). The title
  // is the card's stretched link; the school kicker is a sibling in the card
  // container, so scope content assertions to `[data-webinar-card]`.
  const cardLink = page.locator(`a[href="/webinars/${SLUG}"]`).first();
  const card = page.locator("[data-webinar-card]", { has: cardLink });
  await expect(card).toBeVisible();
  await expect(card).toContainText(process.env.E2E_MY_EVENT_SCHOOL ?? "Школа");
  if (process.env.E2E_MY_EVENT_TITLE) {
    await expect(card).toContainText(process.env.E2E_MY_EVENT_TITLE);
  }

  // Clicking the card navigates to that event page (EARS-6 → the event page).
  await cardLink.click();
  await expect(page).toHaveURL(new RegExp(`/webinars/${SLUG}$`));
});

test("EARS-6: with no registrations, the surface renders the empty-state", async ({
  page,
  context,
}) => {
  test.skip(!COOKIE || !EXPECTED_EMPTY, "requires a doctor session with no registrations");
  await seedSession(context);
  await page.goto(`${BASE}/account/events`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("Пока нет предстоящих событий"),
  ).toBeVisible();
});

/**
 * 005 EARS-7 — a just-registered event appears in «мои события» IMMEDIATELY on
 * the next read, with no read-model staleness window. This drives the invariant
 * in the ACTUAL running stack (browser → portal SSR → `/v1/*` rewrite → api →
 * Postgres): a logged-in doctor who is NOT yet registered for `E2E_FRESH_EVENT_SLUG`
 * fires the real `RegisterForEvent` command the portal client uses (a same-origin
 * `fetch('/v1/events/:slug/registration', { method:'POST', credentials:'include' })`
 * — `lib/registration-client.ts`), and the very NEXT `/account/events` read shows
 * the event. Firing the command from the page's own `fetch` carries the browser's
 * real session cookie + fingerprint surface (UA + accept-language), exactly as the
 * portal client does, so the authenticated read is not 401'd (ADR-0001 §6).
 *
 * Both registration paths converge on this ONE command (design §3): the logged-in
 * one-tap path (this test's trigger) and the guest-through-auth completion fire
 * the identical `RegisterForEvent`, so the freshness invariant this asserts is
 * path-independent. The per-path assertion (one-tap + guest-through-auth) is owned
 * authoritatively by the Vitest e2e (`apps/api/test/registration/freshness.e2e-spec.ts`,
 * both paths); the full guest→003→registered browser journey is the 005
 * portal-integration + E2E child Issue's deliverable.
 *
 * Live-stand-gated: needs a running portal + api + Postgres, a real 003 doctor
 * account (`E2E_DOCTOR_EMAIL` / `E2E_DOCTOR_PASSWORD`), and a registrable
 * (`published`/`live`) event the doctor is NOT yet registered for
 * (`E2E_FRESH_EVENT_SLUG`, the 005↔007 fixture seam). Inert on a bare CI run.
 */
const FRESH_SLUG = process.env.E2E_FRESH_EVENT_SLUG;
const DOCTOR_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;

test.describe("005 EARS-7 my-events freshness (e2e)", () => {
  test("005 EARS-7: a just-registered event appears in «мои события» on the very next read (no staleness window)", async ({
    page,
  }) => {
    test.skip(
      !FRESH_SLUG || !DOCTOR_EMAIL || !DOCTOR_PASSWORD,
      "requires a live portal + a 003 doctor account + a registrable event the doctor is not yet registered for",
    );

    // Log the doctor in through the real 003 flow — the session cookie is bound to
    // this browser's fingerprint surface, which the SSR «мои события» read forwards.
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/почта|email/i).fill(DOCTOR_EMAIL!);
    await page.getByLabel(/пароль|password/i).fill(DOCTOR_PASSWORD!);
    await page.getByRole("button", { name: /войти|продолжить/i }).click();
    await page.waitForURL(/\/account|\/webinars/);

    const cardSelector = `a[href="/webinars/${FRESH_SLUG}"]`;

    // Before the write: the fresh event is absent from «мои события» (the read
    // genuinely reflects registration state, not a coincidental pre-population).
    await page.goto(`${BASE}/account/events`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(cardSelector)).toHaveCount(0);

    // Fire the real `RegisterForEvent` command from the page's own origin (the
    // exact same-origin POST the portal client uses) — carries the browser session.
    const status = await page.evaluate(async (slug) => {
      const res = await fetch(
        `/v1/events/${encodeURIComponent(slug)}/registration`,
        {
          method: "POST",
          headers: { accept: "application/json" },
          credentials: "include",
        },
      );
      return res.status;
    }, FRESH_SLUG!);
    expect(status).toBe(200);

    // The VERY NEXT read of «мои события» must already list the just-registered
    // event — immediately, no staleness window (EARS-7).
    await page.goto(`${BASE}/account/events`, { waitUntil: "domcontentloaded" });
    const card = page.locator(cardSelector).first();
    await expect(card).toBeVisible();

    // …and it links back to that event's page (EARS-6), reachable from the list.
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/webinars/${FRESH_SLUG}$`));
  });
});

/**
 * 006 EARS-6 — the «мои события» room-entry front door (#689). US-1 says a
 * registered doctor enters the room "from the event page (004) OR «мои события»
 * (005)". #584 shipped the event-page CTA; this pins the «мои события» half: on a
 * registered + `live` event the card hosts a «Войти в эфир» CTA routing to
 * `/webinars/:slug/room`, ALONGSIDE (never nested inside) the whole-card link to
 * the event page. This drives the invariant in the ACTUAL running stack (browser →
 * portal SSR → `/v1/*` rewrite → api → Postgres → the room gate).
 *
 * Self-provisioning (like the freshness journey above): a fresh 003 doctor
 * registers for the seeded `live` event through the REAL `RegisterForEvent` command
 * (its session + fingerprint surface ride the same-origin POST), then reads «мои
 * события». Live-stand-gated (portal + real Zitadel + Mailpit) via `LIVE_STAND`;
 * inert on a bare CI run. The `live` event is the `seed:events` fixture
 * `seed-005-live` (override with `E2E_LIVE_SLUG`).
 */
const LIVE_SLUG = process.env.E2E_LIVE_SLUG ?? "seed-005-live";

test.describe("006 EARS-6 my-events room-entry CTA (e2e)", () => {
  test("006 EARS-6: a registered doctor on a live event sees «Войти в эфир» on «мои события», routing to the room with no nested anchor", async ({
    page,
  }) => {
    test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

    // Real 003 signup → a logged-in doctor landing on /account.
    await provisionLoggedInDoctor(page);

    // Register for the seeded LIVE event via the REAL same-origin RegisterForEvent
    // command (the exact POST the portal client fires) — carries the browser session.
    const status = await page.evaluate(async (slug) => {
      const res = await fetch(
        `/v1/events/${encodeURIComponent(slug)}/registration`,
        { method: "POST", headers: { accept: "application/json" }, credentials: "include" },
      );
      return res.status;
    }, LIVE_SLUG);
    expect(status).toBe(200);

    // «мои события» now lists the live event; the card carries the room-entry CTA.
    await page.goto(`${BASE}/account/events`, { waitUntil: "domcontentloaded" });
    const card = page.locator("[data-webinar-card]", {
      has: page.locator(`a[href="/webinars/${LIVE_SLUG}"]`),
    });
    await expect(card).toBeVisible();

    // The room CTA: catalog copy («Войти в эфир»), the hardened room route, and a
    // SIBLING of the card's stretched title link — no anchor nested in an anchor.
    const roomCta = card.getByRole("link", { name: "Войти в эфир", exact: true });
    await expect(roomCta).toHaveAttribute("href", `/webinars/${LIVE_SLUG}/room`);
    expect(await card.locator("a a").count()).toBe(0);

    // The card's own event-page link still resolves (the stretched title link).
    await expect(
      card.locator(`a[href="/webinars/${LIVE_SLUG}"]`),
    ).toBeVisible();

    // Clicking the CTA routes into the room — the gate admits a registered doctor
    // on a live event (006 EARS-1/EARS-6).
    await roomCta.click();
    await expect(page).toHaveURL(new RegExp(`/webinars/${LIVE_SLUG}/room`));
  });
});
