import { test, expect } from "@playwright/test";

/**
 * 004 EARS-7 / EARS-11 — the public upcoming-broadcasts listing renders
 * server-side at `/webinars`: a day-grouped nearest-first list when events exist,
 * the canvas empty-state (never a blank surface) when none do.
 *
 * Live-stand-gated tier (mirrors `event-page.e2e.spec.ts`): needs a running portal
 * whose `/v1/*` rewrite reaches a running api + Postgres. It `test.skip`s unless
 * `E2E_PORTAL_URL` is set, so a stray CI invocation is inert. The seed is the
 * 004↔007 fixture seam (lifecycle transitions are feature 007, parent #549):
 *   - `E2E_WEBINAR_SLUG` — a seeded upcoming (published/live) event whose card the
 *     listing must show, linking to its page.
 *   - `E2E_WEBINARS_EMPTY=1` — the branch DB has NO upcoming event, so the
 *     empty-state must render (EARS-11).
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG = process.env.E2E_WEBINAR_SLUG;
const EXPECTED_EMPTY = process.env.E2E_WEBINARS_EMPTY === "1";

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

test("EARS-7: the listing is complete server-rendered HTML (schedule header, no blank surface)", async ({
  request,
}) => {
  // A cookie-free server fetch — the listing is public and its HTML carries the
  // content (no client gate deciding whether to render).
  const res = await request.get(`${BASE}/webinars`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  // The poster header is always present; the surface is never blank.
  expect(html).toContain("Расписание эфиров");
});

test("EARS-7: a seeded upcoming event appears as a card linking to its page", async ({
  page,
}) => {
  test.skip(!SLUG, "requires a seeded upcoming event slug");
  await page.goto(`${BASE}/webinars`, { waitUntil: "domcontentloaded" });
  // Times on the listing are labeled МСК (EARS-12, no local drift).
  await expect(page.locator("body")).toContainText("МСК");
  const cardLink = page.locator(`a[href="/webinars/${SLUG}"]`).first();
  await expect(cardLink).toBeVisible();
});

test("EARS-11: with no upcoming event, the listing renders the empty-state", async ({
  page,
}) => {
  test.skip(!EXPECTED_EMPTY, "requires a branch DB with no upcoming events");
  await page.goto(`${BASE}/webinars`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Нет предстоящих эфиров")).toBeVisible();
});
