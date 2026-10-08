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
 * Every assertion is on structure (the `#day-<YYYY-MM-DD>` sections, the cards,
 * link hrefs), never on copy: the defect being guarded is a screen-local state
 * store, which copy cannot reveal.
 *
 * The upstream is the fixed stand-in `e2e/support/doctor-events-api.mjs`; it
 * honours the `format` facet, so a facet that reached the SERVER is
 * distinguishable from one applied in the browser.
 */
const FULL_STATE =
  "/events?day=2026-09-04&tense=upcoming&from=2026-09-01&to=2026-09-29&format=online&specialty=all&nmo=false&q=%D1%81%D0%B5%D1%80%D0%B4%D1%86%D0%B5";

/** The «показать ещё» href, or `null` when the horizon is already maximal. */
const showMoreHrefOf = async (page: import("@playwright/test").Page) => {
  const control = page.getByTestId("events-feed-show-more");
  return (await control.count()) === 0 ? null : control.getAttribute("href");
};

/** The structural fingerprint of a rendered feed — what a shared link must reproduce. */
const fingerprint = async (page: import("@playwright/test").Page) => {
  const feed = page.getByTestId("events-feed");
  await expect(feed).toHaveCount(1);
  return {
    days: await page.locator('section[id^="day-"]').evaluateAll((nodes) =>
      nodes.map((node) => node.id),
    ),
    cards: await feed
      .locator("[data-webinar-card] h3 a")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))),
    tense: await page
      .getByTestId("events-tense-tabs")
      .getByRole("tab", { selected: true })
      .textContent(),
    showMore: await showMoreHrefOf(page),
  };
};

test("019 EARS-8.18: a pasted URL reproduces the same feed in a fresh browser context", async ({
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
  // The horizon in the URL is the horizon on the screen, not a default: the
  // widened extent serves the day beyond the default window, and nothing lies
  // beyond it any more.
  expect(original.tense).toBe("Будущие");
  expect(original.showMore).toBeNull();
  expect(original.days).toEqual([
    "day-2026-09-02",
    "day-2026-09-04",
    "day-2026-09-20",
  ]);

  await first.close();
  await second.close();
});

test("019 EARS-8.19: the facet in the URL reaches the read rather than the browser", async ({
  page,
}) => {
  // Every fixture card is `online`; asking for a format none of them has
  // must empty the feed. If the facet were applied client-side over a full
  // response, the day sections would still be in the DOM.
  await page.goto(
    "/events?from=2026-09-01&to=2026-09-29&format=offline&specialty=all",
  );
  await expect(page.getByTestId("events-feed-empty")).toHaveCount(1);
  await expect(page.locator('section[id^="day-"]')).toHaveCount(0);

  await page.goto(
    "/events?from=2026-09-01&to=2026-09-29&format=online&specialty=all",
  );
  await expect(page.locator('section[id^="day-"]')).toHaveCount(3);
});

test("019 EARS-8.20: the forward control carries the whole state and drops nothing", async ({
  page,
}) => {
  // No `to` — the horizon is the default one, so «показать ещё» is present.
  await page.goto(
    "/events?day=2026-09-02&format=online&specialty=all&city=msk&nmo=true&q=%D1%81%D0%B5%D1%80%D0%B4%D1%86%D0%B5&sort=relevance&utm_source=mail",
  );

  const href = await page
    .getByTestId("events-feed-show-more")
    .getAttribute("href");
  expect(href).not.toBeNull();
  const params = new URL(href!, "http://127.0.0.1").searchParams;

  // Every understood parameter survives the widening — a control that dropped
  // one would hand the reader a link to a DIFFERENT screen. The default reading
  // («Будущие») is stated by the absence of `tense` (the canonical URL states
  // only what differs from the default).
  expect(params.get("day")).toBe("2026-09-02");
  expect(params.has("tense")).toBe(false);
  expect(params.getAll("format")).toEqual(["online"]);
  expect(params.get("specialty")).toBe("all");
  expect(params.getAll("city")).toEqual(["msk"]);
  expect(params.get("nmo")).toBe("true");
  expect(params.get("q")).toBe("сердце");
  // Only the horizon moved.
  expect(params.get("to")).toBe("2026-09-29");

  // …and it moved THROUGH the codec: the widened link is in field-table order,
  // with `from`/`to` in positions 3-4, not appended after the facets. The same
  // state must always yield the same, comparable URL — including this one, the
  // only link the feature itself writes.
  expect([...params.keys()]).toEqual([
    "day",
    "from",
    "to",
    "format",
    "specialty",
    "city",
    "nmo",
    "q",
  ]);

  // What the shared codec did not understand is dropped, never forwarded — a
  // ranking or campaign parameter cannot ride the feed's own links.
  expect(params.has("sort")).toBe(false);
  expect(params.has("utm_source")).toBe(false);
});

test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("019 EARS-8.21: the whole feed renders from the URL alone, with no client state", async ({
    page,
  }) => {
    // The strongest available statement of «no feed state in client memory»:
    // with no client runtime at all, the URL still produces the complete
    // screen. A component-state facet store would render an unfiltered or an
    // empty feed here.
    await page.goto(FULL_STATE);

    await expect(page.getByTestId("events-feed")).toHaveCount(1);
    await expect(page.locator('section[id^="day-"]')).toHaveCount(3);
    await expect(page.locator("#day-2026-09-20")).toHaveCount(1);
  });
});

test("gate row 28: a tense tab keeps the facets and resets the horizon", async ({
  page,
}) => {
  await page.goto(
    "/events?day=2026-09-04&from=2026-09-01&to=2026-09-29&format=online&specialty=all",
  );
  const past = page
    .getByTestId("events-tense-tabs")
    .getByRole("tab", { name: "Прошедшие" });
  await past.click();

  // The horizon is the extent of one tense's reading and means nothing in the
  // other: `from`, `to` and `day` leave, the facets stay, `tense=past` is written.
  await expect(page).toHaveURL(
    /\/events\?tense=past&format=online&specialty=all$/,
  );
  await expect(past).toHaveAttribute("aria-selected", "true");
});
