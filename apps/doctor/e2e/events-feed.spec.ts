import { expect, test } from "@playwright/test";

/**
 * 019 EARS-3 (#1518) + the wave-2 feed view (entry gate §2.4, the #2076
 * canvas) — the doctor mount of the one feed view of both storefronts.
 *
 * Every assertion is about the URL and the DOM structure: the failure guarded
 * is a screen-local listing engine (EARS-15) — a control that pages in memory
 * would leave the address bar unchanged, and a screen-local grouping would not
 * emit the shared unit's `#day-<key>` sections. The upstream is a fixed
 * stand-in (`e2e/support/doctor-events-api.mjs`); targeting and adjacency are
 * proven against the real database in the api e2e spec, not here.
 */
const API = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const DEFAULT_FROM = "2026-09-01";
const WIDENED_TO = "2026-09-29";
const SESSION = { cookie: "__Host-ds_session=e2e-doctor" };

test.afterEach(async ({ request }) => {
  await request.post(`${API}/__e2e/feed`, { data: { failing: false } });
  await request.post(`${API}/__e2e/live`, { data: { scenario: "none" } });
});

test("EARS-3: the feed renders its days as groups over the served horizon", async ({
  page,
}) => {
  await page.goto("/events");

  await expect(page.getByTestId("events-feed")).toBeVisible();
  // One section per day, nearest first — the grouping is the shared unit's,
  // keyed by the calendar day of the time shown on the card (gate row 33).
  const groups = page.locator('section[id^="day-"]');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute("id", "day-2026-09-02");
  await expect(groups.nth(1)).toHaveAttribute("id", "day-2026-09-04");
  await expect(groups.nth(0).getByText("Событие evt-1")).toBeVisible();
});

test("gate row 32: «Показать ещё N из M» states the batch and the remainder and writes the extent to the URL", async ({
  page,
}) => {
  await page.goto("/events");

  const more = page.getByTestId("events-feed-show-more");
  // One fixture event lies beyond the default horizon: the next batch is it.
  await expect(more).toHaveText("Показать ещё 1 из 1");
  await more.click();

  await expect(page).toHaveURL(
    new RegExp(`/events\\?from=${DEFAULT_FROM}&to=${WIDENED_TO}$`),
  );
  await expect(page.locator('section[id^="day-"]')).toHaveCount(3);
  await expect(page.locator('section[id="day-2026-09-20"]')).toBeVisible();

  // Nothing lies beyond any more (`nextTo: null`), so the control is gone
  // rather than disabled — there is no paging state left to hold.
  await expect(page.getByTestId("events-feed-show-more")).toHaveCount(0);
});

test("gate row 28: the head carries «Прошедшие | Будущие», «Будущие» by default, and the tense is URL state", async ({
  page,
}) => {
  await page.goto("/events");

  const tabs = page.getByTestId("events-tense-tabs");
  await expect(tabs.getByRole("tab")).toHaveText(["Прошедшие", "Будущие"]);
  await expect(tabs.getByRole("tab", { name: "Будущие" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // The default reading states no `tense` in the URL.
  expect(new URL(page.url()).searchParams.has("tense")).toBe(false);

  await tabs.getByRole("tab", { name: "Прошедшие" }).click();
  await expect(page).toHaveURL(/\/events\?tense=past$/);
  await expect(tabs.getByRole("tab", { name: "Прошедшие" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('section[id="day-2026-08"]')).toBeVisible();

  await tabs.getByRole("tab", { name: "Будущие" }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.locator('section[id="day-2026-09-02"]')).toBeVisible();
});

test("gate rows 29–31: «Прошедшие» groups by month newest first, with no archive block, and offers a recording only when one is published", async ({
  page,
}) => {
  await page.goto("/events?tense=past");

  // Row 30: one month group for the two ended events of the window, newest first.
  const groups = page.locator('section[id^="day-"]');
  await expect(groups).toHaveCount(1);
  await expect(groups.nth(0)).toHaveAttribute("id", "day-2026-08");
  await expect(groups.nth(0)).toContainText("Август 2026");
  const titles = groups.nth(0).locator("[data-webinar-card] h3");
  await expect(titles).toHaveText(["Событие past-recorded", "Событие past-no-cut"]);

  // Row 29: the past reading is the tense — no archive subtitle, tab or block.
  await expect(page.getByText("Архив записей")).toHaveCount(0);

  // Row 31: a published cut ⇒ «Смотреть запись»; nothing published ⇒ no action.
  const recorded = page
    .locator("[data-webinar-card]")
    .filter({ hasText: "Событие past-recorded" });
  await expect(
    recorded.getByRole("link", { name: "Смотреть запись" }),
  ).toHaveAttribute("href", "/events/past-recorded");
  const noCut = page
    .locator("[data-webinar-card]")
    .filter({ hasText: "Событие past-no-cut" });
  await expect(noCut.getByRole("link")).toHaveCount(1);
  await expect(noCut.getByText("Смотреть запись")).toHaveCount(0);

  // The live block and «Мои события» belong to «Будущие».
  await expect(page.locator('[data-feed-block="live"]')).toHaveCount(0);
  await expect(page.locator('[data-feed-block="my-events"]')).toHaveCount(0);

  // «Показать ещё» widens the past extent BACKWARD: `from` moves, `to` stays.
  await page.getByTestId("events-feed-show-more").click();
  await expect(page).toHaveURL(
    /\/events\?tense=past&from=2026-07-21&to=2026-09-01$/,
  );
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(1)).toHaveAttribute("id", "day-2026-07");
});

test("gate row 50: the blocks read head → «Идёт сейчас» → «Мои события» → day feed", async ({
  page,
  request,
}) => {
  await request.post(`${API}/__e2e/live`, {
    data: { scenario: "unregistered" },
  });
  await page.setExtraHTTPHeaders(SESSION);
  await page.goto("/events");

  await expect(page.getByTestId("events-feed")).toBeVisible();
  await expect(page.getByTestId("events-live-block")).toBeVisible();
  await expect(page.getByTestId("events-my-events")).toBeVisible();
  const order = await page
    .locator("[data-feed-block]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.feedBlock),
    );
  expect(order).toEqual(["head", "live", "my-events", "feed"]);
  // The head holds the doctor storefront's page title, once.
  await expect(
    page.getByRole("heading", { level: 1, name: "События", exact: true }),
  ).toHaveCount(1);
});

test("gate row 48: a failed feed read states its cause with «Повторить» while «Идёт сейчас» and «Мои события» still render", async ({
  page,
  request,
}) => {
  await request.post(`${API}/__e2e/feed`, { data: { failing: true } });
  await request.post(`${API}/__e2e/live`, {
    data: { scenario: "unregistered" },
  });
  await page.setExtraHTTPHeaders(SESSION);
  await page.goto("/events");

  const error = page.getByTestId("events-feed-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Не удалось загрузить ленту событий");
  await expect(page.getByTestId("events-feed")).toHaveCount(0);
  // The other blocks stay usable.
  await expect(page.getByTestId("events-live-block")).toBeVisible();
  await expect(page.getByTestId("events-my-events")).toBeVisible();
  await expect(page.getByTestId("events-tense-tabs")).toBeVisible();

  // The retry re-issues the feed read only — no reload, the URL unchanged.
  await request.post(`${API}/__e2e/feed`, { data: { failing: false } });
  await error.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByTestId("events-feed")).toBeVisible();
  await expect(page.locator('section[id^="day-"]')).toHaveCount(2);
  await expect(page.getByTestId("events-feed-error")).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/);
});
