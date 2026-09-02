import { expect, test } from "@playwright/test";

/**
 * 019 EARS-8 (#1523) — the URL is the single source of the screen.
 *
 * EARS-8 promises three things at once: a shared link reproduces the screen for
 * another reader, every control carries the whole state forward, and no feed
 * state lives only in client memory. This tier proves exactly those, and only
 * those — the browser BACK button, the shared-link entry route and the return
 * from feature 021 are #1516's, not this Issue's.
 *
 * Every assertion is on structure (`[data-events-feed]` attributes, the
 * `#day-<YYYY-MM-DD>` sections, link hrefs), never on copy: the defect being
 * guarded is a screen-local state store, which copy cannot reveal.
 *
 * The upstream is the fixed stand-in `e2e/support/doctor-events-api.mjs`; it
 * honours the `format` facet, so a facet that reached the SERVER is
 * distinguishable from one applied in the browser.
 */
const FULL_STATE =
  "/events?day=2026-09-04&tense=upcoming&from=2026-09-01&to=2026-09-29&format=webinar&specialty=all&nmo=false&q=%D1%81%D0%B5%D1%80%D0%B4%D1%86%D0%B5";

/** The «показать ещё» href, or `null` when the horizon is already maximal. */
const showMoreHrefOf = async (page: import("@playwright/test").Page) => {
  const control = page.getByTestId("events-feed-show-more");
  return (await control.count()) === 0 ? null : control.getAttribute("href");
};

/** The structural fingerprint of a rendered feed — what a shared link must reproduce. */
const fingerprint = async (page: import("@playwright/test").Page) => {
  const feed = page.locator("[data-events-feed]");
  await expect(feed).toHaveCount(1);
  return {
    from: await feed.getAttribute("data-feed-from"),
    to: await feed.getAttribute("data-feed-to"),
    days: await page.locator('section[id^="day-"]').evaluateAll((nodes) =>
      nodes.map((node) => node.id),
    ),
    showMore: await showMoreHrefOf(page),
  };
};

test("019 EARS-8: a pasted URL reproduces the same feed in a fresh browser context", async ({
  browser,
}) => {
  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await firstPage.goto(FULL_STATE);
  const original = await fingerprint(firstPage);

  // A genuinely fresh context: no cookies, no storage, nothing carried over —
  // the reader who received the link has only the URL.
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await secondPage.goto(FULL_STATE);
  const shared = await fingerprint(secondPage);

  expect(shared).toEqual(original);
  // The horizon in the URL is the horizon on the screen, not a default.
  expect(original.from).toBe("2026-09-01");
  expect(original.to).toBe("2026-09-29");
  expect(original.days).toEqual([
    "day-2026-09-02",
    "day-2026-09-04",
    "day-2026-09-20",
  ]);

  await first.close();
  await second.close();
});

test("019 EARS-8: the facet in the URL reaches the read rather than the browser", async ({
  page,
}) => {
  // Every fixture card is a `webinar`; asking for a format none of them has
  // must empty the feed. If the facet were applied client-side over a full
  // response, the day sections would still be in the DOM.
  await page.goto(
    "/events?from=2026-09-01&to=2026-09-29&format=podcast&specialty=all",
  );
  await expect(page.locator("[data-events-feed]")).toHaveCount(1);
  await expect(page.locator('section[id^="day-"]')).toHaveCount(0);

  await page.goto(
    "/events?from=2026-09-01&to=2026-09-29&format=webinar&specialty=all",
  );
  await expect(page.locator('section[id^="day-"]')).toHaveCount(3);
});

test("019 EARS-8: the forward control carries the whole state and drops nothing", async ({
  page,
}) => {
  // No `to` — the horizon is the default one, so «показать ещё» is present.
  await page.goto(
    "/events?day=2026-09-02&format=webinar&specialty=all&city=msk&nmo=true&q=%D1%81%D0%B5%D1%80%D0%B4%D1%86%D0%B5&sort=relevance&utm_source=mail",
  );

  const href = await page
    .getByTestId("events-feed-show-more")
    .getAttribute("href");
  expect(href).not.toBeNull();
  const params = new URL(href!, "http://127.0.0.1").searchParams;

  // Every understood parameter survives the widening — a control that dropped
  // one would hand the reader a link to a DIFFERENT screen.
  expect(params.get("day")).toBe("2026-09-02");
  expect(params.get("tense")).toBe("upcoming");
  expect(params.getAll("format")).toEqual(["webinar"]);
  expect(params.get("specialty")).toBe("all");
  expect(params.getAll("city")).toEqual(["msk"]);
  expect(params.get("nmo")).toBe("true");
  expect(params.get("q")).toBe("сердце");
  // Only the horizon moved.
  expect(params.get("to")).toBe("2026-09-29");

  // What the shared codec did not understand is dropped, never forwarded — a
  // ranking or campaign parameter cannot ride the feed's own links.
  expect(params.has("sort")).toBe(false);
  expect(params.has("utm_source")).toBe(false);
});

test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("019 EARS-8: the whole feed renders from the URL alone, with no client state", async ({
    page,
  }) => {
    // The strongest available statement of «no feed state in client memory»:
    // with no client runtime at all, the URL still produces the complete
    // screen. A component-state facet store would render an unfiltered or an
    // empty feed here.
    await page.goto(FULL_STATE);

    const feed = page.locator("[data-events-feed]");
    await expect(feed).toHaveAttribute("data-feed-from", "2026-09-01");
    await expect(feed).toHaveAttribute("data-feed-to", "2026-09-29");
    await expect(page.locator('section[id^="day-"]')).toHaveCount(3);
  });
});
