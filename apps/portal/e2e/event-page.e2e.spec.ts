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
// EARS-4 lifecycle renders need a seeded event per state (the 004↔007 fixture
// seam). The upcoming/published event is `SLUG`; live + ended are their own seeds.
const SLUG_LIVE = process.env.E2E_WEBINAR_SLUG_LIVE;
const SLUG_ENDED = process.env.E2E_WEBINAR_SLUG_ENDED;
// EARS-5 — the archived direct-link notice needs its own seeded `archived` event.
const SLUG_ARCHIVED = process.env.E2E_WEBINAR_SLUG_ARCHIVED;

test.skip(
  !process.env.E2E_PORTAL_URL || !SLUG,
  "requires a live portal + a seeded event slug",
);

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
  await expect(page.locator("body")).not.toContainText(
    /авторизуйтесь|войдите для просмотра/i,
  );
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
  await page.goto(`${BASE}/webinars/${SLUG}`, {
    waitUntil: "domcontentloaded",
  });

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

/**
 * 004 EARS-4 — the event page reflects the current lifecycle state from the
 * single `EventLifecycleState`, swapping the hero badge, the status-card time
 * plate, and the CTA affordance per the canvas `status` enum — never a signal
 * contradicting the machine. Three renders are driven on three seeded fixtures:
 *   • upcoming (`published`) — «Скоро» badge + «Участвовать» → registration.
 *   • live — «В эфире» live signal + «Участвовать» → registration TOO (005
 *     EARS-1/EARS-9: register-during-live is a normal path). The room and its
 *     navigation are 006 (#584) — no render links to `/room` until it ships
 *     (a `/room` link would 404, the #673 Stage-B rework finding).
 *   • ended — «Эфир завершён» + NO participation CTA (no dead link).
 * The registration flow is a seam (005) — asserted by route, not driven here.
 */
test.describe("004 EARS-4 lifecycle render swap (e2e)", () => {
  test("EARS-4: the upcoming render shows the «Скоро» hero badge, the status-card time plate, and a register-routing «Участвовать» CTA", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    // Hero lifecycle badge = «Скоро»; the time plate carries an explicit «МСК».
    await expect(
      page.getByText("Скоро", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText("МСК");

    // Exactly one primary «Участвовать» CTA, routing into the registration handoff.
    const cta = page.getByRole("link", { name: "Участвовать", exact: true });
    await expect(cta).toHaveCount(1);
    await expect(cta).toHaveAttribute(
      "href",
      `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG}`)}`,
    );
  });

  test("EARS-4: the live render shows the «В эфире» signal and routes the «Участвовать» CTA into the registration handoff (005 register-during-live)", async ({
    page,
    context,
  }) => {
    test.skip(!SLUG_LIVE, "requires a seeded live event slug");
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}`, {
      waitUntil: "domcontentloaded",
    });

    // The "live now" signal is present (hero badge + mobile time-plate tag).
    await expect(page.getByText("В эфире").first()).toBeVisible();

    // The single «Участвовать» CTA routes into the registration handoff — a
    // guest registers first (005 EARS-2/EARS-9); it must NEVER point at the
    // not-yet-built 006 room (`/webinars/:slug/room` → 404, the #673 finding).
    const cta = page.getByRole("link", { name: "Участвовать", exact: true });
    await expect(cta).toHaveCount(1);
    await expect(cta).toHaveAttribute(
      "href",
      `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG_LIVE}`)}`,
    );
  });

  test("EARS-4: the ended render shows the ended affordance and carries NO participation CTA (no dead link)", async ({
    page,
    context,
  }) => {
    test.skip(!SLUG_ENDED, "requires a seeded ended event slug");
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG_ENDED}`, {
      waitUntil: "domcontentloaded",
    });

    // The ended lifecycle signal is present…
    await expect(page.getByText("Эфир завершён").first()).toBeVisible();
    // …and there is NO participation CTA anywhere (no dead link — EARS-4 invariant).
    await expect(
      page.getByRole("link", { name: "Участвовать", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Записаться", exact: true }),
    ).toHaveCount(0);
  });
});

/**
 * 004 EARS-5 — an archived event reached via a previously-distributed direct
 * link renders a public «мероприятие в архиве» notice with NO participation CTA
 * (owner decision, variant «а»): the sponsor link degrades gracefully in place
 * instead of dead-ending on a 404 or bouncing to the listing. The archived
 * notice is the FOURTH render mode on the same page shell (beyond the canvas's
 * upcoming/live/ended), a text notice replacing the status card's CTA column —
 * no new geometry (design §5.1). Requires a seeded `archived` event slug (the
 * 004↔007 fixture seam, parent #549).
 */
test.describe("004 EARS-5 archived direct-link notice (e2e)", () => {
  test("EARS-5: an archived direct link renders the «в архиве» notice on the page (a reachable 200, not a 404 or a redirect)", async ({
    page,
    context,
  }) => {
    test.skip(!SLUG_ARCHIVED, "requires a seeded archived event slug");
    await context.clearCookies();

    // The distributed link degrades to a reachable page, never a 404 dead-end
    // and never a 3xx bounce to the listing (owner variant «а»).
    const response = await page.goto(`${BASE}/webinars/${SLUG_ARCHIVED}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    // It stayed on the event URL — not redirected to the listing.
    expect(new URL(page.url()).pathname).toBe(`/webinars/${SLUG_ARCHIVED}`);

    // The «в архиве» hero badge + the archived notice are present.
    await expect(page.getByText("В архиве", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Мероприятие в архиве").first()).toBeVisible();
  });

  test("EARS-5: the archived render carries NO participation CTA (no dead link)", async ({
    page,
    context,
  }) => {
    test.skip(!SLUG_ARCHIVED, "requires a seeded archived event slug");
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG_ARCHIVED}`, {
      waitUntil: "domcontentloaded",
    });

    // No participation affordance in any of its verbs — the archived notice is
    // the fourth CTA-less render mode (EARS-5, mirroring the `ended` invariant).
    await expect(
      page.getByRole("link", { name: "Участвовать", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Записаться", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Смотреть эфир", exact: true }),
    ).toHaveCount(0);
  });
});
