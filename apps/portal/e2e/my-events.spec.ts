import { test, expect } from "@playwright/test";

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

  // The registered event is a card linking to its event page (EARS-6).
  const cardLink = page.locator(`a[href="/webinars/${SLUG}"]`).first();
  await expect(cardLink).toBeVisible();
  await expect(cardLink).toContainText(process.env.E2E_MY_EVENT_SCHOOL ?? "Школа");
  if (process.env.E2E_MY_EVENT_TITLE) {
    await expect(cardLink).toContainText(process.env.E2E_MY_EVENT_TITLE);
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
