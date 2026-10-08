import { expect, test } from "@playwright/test";

/**
 * The Academy mount of the one feed view of both storefronts (wave-2 entry gate
 * §2.4, the #2076 canvas) at `academy.doctor.school/webinars`. The doctor mount
 * is pinned by `apps/doctor/e2e/events-*.spec.ts` over an upstream double; this
 * tier drives the live portal over the seeded branch DB, guest only (the
 * signed-in «Мои события» block needs a real session — the doctor tier owns it).
 *
 *   row 28 — the head's tense tabs, «Будущие» by default, the tense in the URL;
 *   rows 29–30 — «Прошедшие» groups by month newest first, no archive block;
 *   row 32 — «Показать ещё N из M» is offered from the bare `/webinars` and
 *            `?tense=past` and widens the extent in the URL (seeded
 *            `seed-005-upcoming-3` at +14 d, `seed-014-ended-month-ago` at
 *            −30 d, `seed-006-legacy-archived` at −400 d — no age floor);
 *   row 31 — a published recording reads «Запись · <length>» + «Смотреть запись»;
 *   row 43 — the live block renders an experts-audience live event
 *            (`E2E_WEBINAR_SLUG_LIVE`, default `seed-005-live`);
 *   row 50 — head → «Идёт сейчас» → day feed («Мои события» is absent for a guest);
 *   §4.3 D1 — a legacy listing URL answers a permanent redirect to its
 *            canonical feed URL.
 *
 * `test.skip`s on a bare CI run (no `E2E_PORTAL_URL`), like the sibling
 * live-stand specs.
 */
const SLUG_LIVE = process.env.E2E_WEBINAR_SLUG_LIVE ?? "seed-005-live";

test.describe("the Academy feed view (wave-2 entry gate §2.4)", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual dev-stand gate",
  );

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("gate row 28: the head carries «Прошедшие | Будущие», «Будущие» by default, and the tense is URL state", async ({
    page,
  }) => {
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });

    const tabs = page.getByTestId("events-tense-tabs");
    await expect(tabs.getByRole("tab")).toHaveText(["Прошедшие", "Будущие"]);
    await expect(tabs.getByRole("tab", { name: "Будущие" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URL(page.url()).searchParams.has("tense")).toBe(false);

    await tabs.getByRole("tab", { name: "Прошедшие" }).click();
    await expect(page).toHaveURL(/\/webinars\?tense=past$/);
    await expect(tabs.getByRole("tab", { name: "Прошедшие" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await tabs.getByRole("tab", { name: "Будущие" }).click();
    await expect(page).toHaveURL(/\/webinars$/);
  });

  test("gate rows 29–30: «Прошедшие» groups by month newest first and renders no archive block", async ({
    page,
  }) => {
    await page.goto("/webinars?tense=past", { waitUntil: "domcontentloaded" });

    const groups = page
      .getByTestId("events-feed")
      .locator('section[id^="day-"]');
    await expect(groups.first()).toBeVisible();
    const keys = await groups.evaluateAll((nodes) =>
      nodes.map((node) => node.id.slice("day-".length)),
    );
    // Month keys (`YYYY-MM`), strictly newest first.
    for (const key of keys) expect(key).toMatch(/^\d{4}-\d{2}$/);
    expect(keys).toEqual([...keys].sort().reverse());
    expect(new Set(keys).size).toBe(keys.length);

    await expect(page.getByText("Архив записей")).toHaveCount(0);
    // The live block belongs to «Будущие».
    await expect(page.locator('[data-feed-block="live"]')).toHaveCount(0);
  });

  test("gate rows 31–32: the bare `?tense=past` offers «Показать ещё», which reaches a month-old recorded эфир and, step by step, the legacy archive", async ({
    page,
  }) => {
    await page.goto("/webinars?tense=past", { waitUntil: "domcontentloaded" });
    const cards = page.locator("[data-webinar-card]");
    const monthAgo = cards.filter({
      hasText: "Итоги: остеоартрит коленного сустава",
    });
    await expect(page.getByTestId("events-feed")).toBeVisible();
    await expect(monthAgo).toHaveCount(0);

    const more = page.getByTestId("events-feed-show-more");
    await expect(more).toHaveText(/^Показать ещё \d+ из \d+$/);
    await more.click();
    await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}-\d{2}/);
    await expect(page).toHaveURL(/[?&]to=\d{4}-\d{2}-\d{2}/);
    await expect(monthAgo).toHaveCount(1);
    await expect(monthAgo).toContainText("Запись · 1 ч 12 мин");
    await expect(
      monthAgo.getByRole("link", { name: "Смотреть запись" }),
    ).toBeVisible();

    // No age floor: repeated «Показать ещё» reaches the 400-day-old legacy эфир.
    const legacy = cards.filter({
      hasText: "Архивный эфир: инсулинотерапия (до платформы)",
    });
    for (let step = 0; step < 40; step += 1) {
      if ((await legacy.count()) > 0) break;
      await expect(more).toBeVisible();
      const before = page.url();
      await more.click();
      await expect(page).not.toHaveURL(before);
    }
    await expect(legacy).toHaveCount(1);
    await expect(legacy).toContainText("Запись · 1 ч 20 мин");
  });

  test("gate row 32: the bare `/webinars` offers «Показать ещё», which reaches the эфир just past the 14-day default", async ({
    page,
  }) => {
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    const later = page
      .locator("[data-webinar-card]")
      .filter({ hasText: "Ревматология: ранняя диагностика" });
    await expect(page.getByTestId("events-feed")).toBeVisible();
    await expect(later).toHaveCount(0);

    const more = page.getByTestId("events-feed-show-more");
    await expect(more).toHaveText(/^Показать ещё \d+ из \d+$/);
    await more.click();
    await expect(page).toHaveURL(/[?&]to=\d{4}-\d{2}-\d{2}/);
    await expect(later).toHaveCount(1);
  });

  test("gate rows 43, 50: the live block renders the experts-audience live event, between the head and the day feed", async ({
    page,
  }) => {
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });

    const block = page.getByTestId("events-live-block");
    await expect(block).toBeVisible();
    const strip = block
      .getByTestId("live-event-strip")
      .filter({
        has: page.locator(`a[href="/webinars/${SLUG_LIVE}"]`),
      });
    await expect(strip).toHaveCount(1);
    await expect(strip.getByTestId("live-event-strip-title")).toHaveAttribute(
      "href",
      `/webinars/${SLUG_LIVE}`,
    );
    // A guest's action leads to the event page, never into the room.
    await expect(strip.getByTestId("live-event-strip-action")).toHaveText(
      "Открыть страницу события",
    );
    await expect(block.locator('a[href$="/room"]')).toHaveCount(0);

    await expect(page.getByTestId("events-feed")).toBeVisible();
    const order = await page
      .locator("[data-feed-block]")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.feedBlock),
      );
    // «Мои события» is a signed-in reader's block; a guest reads the rest.
    expect(order).toEqual(["head", "live", "feed"]);
  });

  test("§4.3 D1: a legacy listing URL permanently redirects to its canonical feed URL", async ({
    page,
    request,
  }) => {
    const response = await request.get("/webinars?tab=past&cursor=x", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(308);
    const location = new URL(response.headers()["location"]!, "http://portal.test");
    expect(`${location.pathname}${location.search}`).toBe("/webinars?tense=past");

    await page.goto("/webinars?tab=past&cursor=x", {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(/\/webinars\?tense=past$/);
    await expect(
      page.getByTestId("events-tense-tabs").getByRole("tab", { name: "Прошедшие" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
