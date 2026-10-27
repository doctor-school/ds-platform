import { test, expect, type Page } from "@playwright/test";

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
// EARS-5 — the hidden direct-link notice needs its own seeded `hidden` event.
const SLUG_HIDDEN = process.env.E2E_WEBINAR_SLUG_HIDDEN;
// `in_archive` is the fourth PUBLIC lifecycle render (a legacy эфир whose only
// signal is its recording, 014-design §3.1) — its own seed.
const SLUG_ARCHIVE = process.env.E2E_WEBINAR_SLUG_ARCHIVE;

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
 * 004 EARS-4: the ended/no-CTA case moved to the shared public-event-page
 * steps (#3383); these app-local checks retain the upcoming/live seam.
 */

// Gate row 30 (D9, 004 «Amendment — 2026-10-02»): the browser runs in Asia/Yekaterinburg.
// After hydration an online or hybrid event states its time in that zone with
// its label; an offline event stays МСК. The server bytes stay МСК.
async function expectedZoneLabel(page: Page): Promise<string> {
  const kicker =
    (await page.getByTestId("event-page-kicker").textContent()) ?? "";
  return /Очно/u.test(kicker) ? "МСК" : "GMT+5";
}

test.describe("004 EARS-4 lifecycle render swap (e2e)", () => {
  test.use({ timezoneId: "Asia/Yekaterinburg" });
  test("EARS-4: the upcoming render shows the «Скоро» hero badge, the status-card time plate, and a register-routing «Участвовать» CTA", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`${BASE}/webinars/${SLUG}`, {
      waitUntil: "domcontentloaded",
    });

    // Hero lifecycle badge = «Скоро»; the time plate carries an explicit zone label.
    await expect(
      // The plate carries the Stage-B countdown suffix «Скоро · через N дней»
      // (#1779), so the badge is matched by prefix, not by exact text.
      page.getByText(/^Скоро(\s·\s.+)?$/).first(),
    ).toBeVisible();
    await expect(page.getByTestId("event-page-hero")).toContainText(
      `(${await expectedZoneLabel(page)})`,
    );

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
});

/**
 * 004 EARS-4 (mobile geometry regression, #1810) — the hero lifecycle plate is a
 * STATUS SIGNAL: a chip whose label is half off-screen («СК» of «СКРЫТО») tells a
 * phone visitor nothing. The plate sits in the hero's `statusPlate` slot next to
 * the title column, so its geometry is owned by `EventPageHero`
 * (`@ds/design-system`) — this pin measures the rendered chip, per public
 * lifecycle state, at the three narrow widths the audience actually carries
 * (390 = iPhone 14/15, 360 = the common Android floor, 320 = the smallest
 * phone viewport still in use, where the overflow measured worst). `live` is excluded: it is
 * a different plate (single `variant="live"` badge, EARS-4 swap).
 *
 * The assertion is a bounding box, not a class: `boundingBox()` resolves the real
 * post-transform rect, so the plate's `rotate-3` overflow counts as overflow.
 */
test.describe("004 EARS-4 hero status plate — mobile viewport containment (e2e)", () => {
  const NARROW_WIDTHS = [390, 360, 320] as const;

  for (const [state, slugEnv] of [
    ["published", () => SLUG],
    ["ended", () => SLUG_ENDED],
    ["hidden", () => SLUG_HIDDEN],
    ["in_archive", () => SLUG_ARCHIVE],
  ] as const) {
    for (const width of NARROW_WIDTHS) {
      test(`004 EARS-4: hero status chip bounding box lies inside a ${width}px viewport for the ${state} lifecycle state`, async ({
        page,
        context,
      }) => {
        const slug = slugEnv();
        test.skip(!slug, `requires a seeded ${state} event slug`);

        await context.clearCookies();
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${BASE}/webinars/${slug}`, {
          waitUntil: "domcontentloaded",
        });

        const plate = page.getByTestId("event-page-hero-status");
        await expect(plate).toBeVisible();

        const box = await plate.boundingBox();
        expect(
          box,
          "the hero status plate must have a layout box",
        ).not.toBeNull();
        // Left edge inside the viewport…
        expect(
          Math.round(box!.x),
          `plate left edge (${state} @ ${width}px)`,
        ).toBeGreaterThanOrEqual(0);
        // …and the whole chip, rotation included, inside the right edge.
        expect(
          Math.round(box!.x + box!.width),
          `plate right edge (${state} @ ${width}px)`,
        ).toBeLessThanOrEqual(width);

        // The page itself must not gain a horizontal scroll because of it.
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(
          overflow,
          `document horizontal overflow @ ${width}px`,
        ).toBeLessThanOrEqual(0);
      });
    }
  }
});
