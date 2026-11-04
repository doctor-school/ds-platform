import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * 018 EARS-4 (#1499) — the nearest-events block of the specialty feed. The
 * stand-in `e2e/support/doctor-events-api.mjs` answers three nearest events: a
 * counter shown (48), a counter hidden by its event's «Скрыть число
 * записавшихся» option (`signUpCount: null`) and an НМО-accredited offline
 * meet-up; `POST /__e2e/specialty-feed` fails the block's read.
 *
 * With `FEED_EVIDENCE_DIR` set, each state is also captured there.
 */
const API = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const CODE = "travmatologiya-i-ortopediya";
const FEED = `/feed/${CODE}`;
const EVIDENCE = process.env.FEED_EVIDENCE_DIR;

async function failEvents(request: APIRequestContext, failing: boolean) {
  await request.post(`${API}/__e2e/specialty-feed`, { data: { failing } });
}

test.afterEach(async ({ request }) => {
  await failEvents(request, false);
});

test("EARS-4: the nearest-events block stands first, every card from the shared event card, the counter on every card whose option is off", async ({
  page,
}) => {
  await page.goto(FEED);
  const first = page.locator("[data-feed-block-slot]").first();
  await expect(first).toHaveAttribute("data-feed-block-slot", "events");
  const block = page.getByTestId("specialty-feed-events");
  await expect(
    block.getByRole("heading", { level: 2, name: "Ближайшие события" }),
  ).toBeVisible();

  const cards = block.locator("[data-webinar-card]");
  await expect(cards).toHaveCount(3);
  const shown = cards.filter({ hasText: "Разрыв ПКС: тактика" });
  await expect(shown.locator("[data-signup-count]")).toHaveCount(1);
  await expect(shown.locator("[data-signup-count]")).toContainText("48");
  if (EVIDENCE)
    await page.screenshot({
      path: `${EVIDENCE}/feed-events.png`,
      fullPage: true,
    });
});

test("EARS-4: an event whose option hides the counter renders no counter line, no «0» and no empty slot — its neighbours keep theirs", async ({
  page,
}) => {
  await page.goto(FEED);
  const cards = page
    .getByTestId("specialty-feed-events")
    .locator("[data-webinar-card]");
  const hidden = cards.filter({ hasText: "Остеоартроз: что нового" });
  await expect(hidden).toHaveCount(1);
  await expect(hidden.locator("[data-signup-count]")).toHaveCount(0);
  await expect(hidden).not.toContainText(/записал/i);
  await expect(cards.locator("[data-signup-count]")).toHaveCount(2);
});

test("EARS-4: an offline meet-up is a format of the same event card, and НМО is only its attribute — never a heading or a filter of the screen", async ({
  page,
}) => {
  await page.goto(FEED);
  const block = page.getByTestId("specialty-feed-events");
  const meetUp = block
    .locator("[data-webinar-card]")
    .filter({ hasText: "Встреча травматологов" });
  await expect(meetUp).toHaveCount(1);
  await expect(meetUp.locator("[data-event-format-label]")).toBeVisible();
  await expect(meetUp.locator("[data-event-nmo]")).toHaveCount(1);

  const feed = page.getByTestId("specialty-feed");
  await expect(feed.getByRole("heading", { name: /НМО/ })).toHaveCount(0);
  await expect(feed.getByRole("checkbox", { name: /НМО/ })).toHaveCount(0);
  await expect(feed.getByRole("switch", { name: /НМО/ })).toHaveCount(0);
});

test("EARS-4: «Все события по специальности →» leads into 019's events feed for this specialty", async ({
  page,
}) => {
  await page.goto(FEED);
  const link = page.getByTestId("specialty-feed-all-events");
  await expect(link).toHaveText("Все события по специальности →");
  await expect(link).toHaveAttribute("href", `/events?specialty=${CODE}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/events\\?specialty=${CODE}$`));
  // 019's one events page, opened on this specialty.
  await expect(
    page.getByRole("heading", { level: 1, name: "События" }),
  ).toBeVisible();
});

test("EARS-4: a failed events read states its reason in place, the heading stays, and «Повторить» re-runs that read alone", async ({
  page,
  request,
}) => {
  await failEvents(request, true);
  await page.goto(FEED);
  const block = page.getByTestId("specialty-feed-events");
  await expect(block.getByTestId("events-feed-error")).toContainText(
    "Не удалось загрузить ленту событий",
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (EVIDENCE)
    await page.screenshot({
      path: `${EVIDENCE}/feed-events-error.png`,
      fullPage: true,
    });

  await failEvents(request, false);
  await block.getByRole("button", { name: "Повторить" }).click();
  await expect(block.locator("[data-webinar-card]")).toHaveCount(3);
});

test("EARS-4: the feed route is axe-clean with the events block", async ({
  page,
}) => {
  await page.goto(FEED);
  await expect(
    page.getByTestId("specialty-feed-events").locator("[data-webinar-card]"),
  ).toHaveCount(3);
  // Scoped to the feed, the home-events idiom: the shell's own chrome is 017's
  // and carries its own axe coverage (`e2e/a11y-axe.e2e.spec.ts`).
  const results = await new AxeBuilder({ page })
    .include('[data-testid="specialty-feed"]')
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
});
