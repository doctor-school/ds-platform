import { test, expect } from "@playwright/test";

/**
 * 004 EARS-1 — the public webinar event page renders server-side for an
 * UNAUTHENTICATED recipient (a sponsor-distributed direct link "just works").
 *
 * Live-stand-gated tier (mirrors `auth-journeys.e2e.spec.ts`): it needs a running
 * portal whose `/v1/*` rewrite reaches a running api + Postgres seeded with a
 * `published` event. It `test.skip`s unless both `E2E_PORTAL_URL` and a seeded
 * `E2E_WEBINAR_SLUG` are provided, so a stray CI invocation is inert. The seed is
 * the 004↔007 fixture seam (lifecycle transitions are feature 007, parent #549).
 *
 * The contract under test: the page is complete server-rendered HTML with ZERO
 * authentication — no cookie sent, no client soft-wall, the event title present
 * in the raw HTML (not injected by client JS).
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG = process.env.E2E_WEBINAR_SLUG;
const EXPECTED_TITLE = process.env.E2E_WEBINAR_TITLE;

test.skip(!process.env.E2E_PORTAL_URL || !SLUG, "requires a live portal + a seeded event slug");

test("EARS-1: a guest opens the sponsor link and the full page is server-rendered with no authentication", async ({
  page,
  context,
}) => {
  // No session cookie — a guest recipient of the distributed link.
  await context.clearCookies();

  const response = await page.goto(`${BASE}/webinars/${SLUG}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  // The event heading is present and there is no "log in to view" soft-wall.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  if (EXPECTED_TITLE) await expect(heading).toHaveText(EXPECTED_TITLE);
  await expect(page.locator("body")).not.toContainText(/авторизуйтесь|войдите для просмотра/i);
});

test("EARS-1: the page is complete HTML from the server (raw response carries the content, no client JS required)", async ({
  request,
}) => {
  // A cookie-free server fetch — asserts the SSR HTML itself carries the content,
  // proving there is no client-side gate deciding whether to render the page.
  const res = await request.get(`${BASE}/webinars/${SLUG}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("МСК");
  if (EXPECTED_TITLE) expect(html).toContain(EXPECTED_TITLE);
});

/**
 * 004 EARS-3 — the event page carries EXACTLY ONE primary «Участвовать» CTA that
 * routes a guest into the registration flow (feature 005) through auth (003),
 * carrying the event context so it survives the round-trip. 004 owns only the CTA
 * and the context handoff; the registration mechanics + the guest→auth→registered
 * completion are 005/003, so the handoff target is stubbed here — this test
 * asserts the CTA ENTERS the flow carrying the event context, not that 005
 * completes it (design §8 seam). Requires the seeded `published`/upcoming event
 * (the CTA is absent for `ended`, EARS-3 invariant).
 */
test("EARS-3: a guest sees exactly one primary «Участвовать» CTA that enters the registration handoff carrying the event context", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto(`${BASE}/webinars/${SLUG}`, { waitUntil: "domcontentloaded" });

  // Exactly ONE primary participation CTA on the page.
  const cta = page.getByRole("link", { name: "Участвовать", exact: true });
  await expect(cta).toHaveCount(1);
  await expect(cta).toBeVisible();

  // Activating it (as a guest) enters the registration/auth flow carrying the
  // event context as a same-origin returnTo to this event's page.
  await cta.click();
  await page.waitForURL(/\/register\?/);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/register");
  expect(url.searchParams.get("returnTo")).toBe(`/webinars/${SLUG}`);
});
