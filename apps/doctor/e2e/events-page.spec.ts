import { expect, test, type Page } from "@playwright/test";

/**
 * Wave-2 entry gate §2.5 rows 51–55 and 58–61 on the doctor host — the one
 * events page of `@ds/events-storefront` mounted with the doctor host config:
 * the month view as a `view` state of the same page, the 1024 px breakpoint,
 * the month grid / picker / dot grid, the host facet set in the column and
 * the sheet. The upstream is the fixed stand-in
 * `e2e/support/doctor-events-api.mjs` (September 2026 fixtures).
 */
const api = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const MONTH = "/events?view=month&month=2026-09";

function panel(page: Page) {
  return page.getByTestId("events-column").getByRole("region", { name: "Фильтры" });
}

test.describe("at 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("NEW: the round-trip keeps tense and facets on both hosts (row 51, doctor)", async ({
    page,
  }) => {
    await page.goto("/events?tense=past&kind=vebinar");
    const toMonth = page.getByTestId("events-view-switch");
    await expect(toMonth).toHaveText("Календарь на месяц →");
    await toMonth.click();
    await expect(page.getByTestId("events-month-view")).toBeVisible();
    await expect(page).toHaveURL(/view=month/);
    await expect(page).toHaveURL(/tense=past/);
    await expect(page).toHaveURL(/kind=vebinar/);

    const toFeed = page.getByTestId("events-view-switch");
    await expect(toFeed).toHaveText("← Лента событий");
    await toFeed.click();
    await expect(page).not.toHaveURL(/view=month/);
    await expect(page).toHaveURL(/tense=past/);
    await expect(page).toHaveURL(/kind=vebinar/);
    await expect(page.getByTestId("events-month-view")).toHaveCount(0);
  });

  test("NEW: month pills and agenda rows state the time in the viewer's zone (row 53)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      timezoneId: "Asia/Yekaterinburg",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(MONTH);
    const grid = page.getByTestId("month-grid-desktop");
    // evt-3 starts 2026-09-04T15:00Z: 18:00 МСК, 20:00 in Yekaterinburg.
    await expect(
      grid.getByRole("link", { name: "20:00 GMT+5 · Событие evt-3" }),
    ).toBeVisible();
    await context.close();
  });

  test("NEW: the month grid — ≤3 pills, the live pill «Идёт сейчас», the legend, no day action (row 53, doctor)", async ({
    page,
  }) => {
    await page.goto(MONTH);
    const grid = page.getByTestId("month-grid-desktop");
    await expect(grid).toBeVisible();
    await expect(
      grid.getByRole("link", { name: /^Идёт сейчас \d\d:\d\d \S+ · Событие evt-1$/ }),
    ).toHaveAttribute("href", "/events/evt-1");
    await expect(grid.getByText("Запланировано")).toBeVisible();
    await expect(grid.getByText("Прошло")).toBeVisible();
    // A day cell has no action of its own: the only controls are the pills
    // and the next-month link.
    await expect(grid.getByRole("button")).toHaveCount(0);
  });

  test("NEW: the picker, ‹ › and «Сегодня» page the month view and keep the facets (row 54, doctor)", async ({
    page,
  }) => {
    await page.goto(`${MONTH}&kind=vebinar`);
    const toolbar = page.getByTestId("month-toolbar");
    await expect(toolbar.getByRole("group")).toContainText("Сентябрь 2026");
    await expect(page.getByTestId("month-next")).toHaveAttribute(
      "href",
      "/events?view=month&month=2026-10&kind=vebinar",
    );
    await expect(page.getByTestId("month-prev")).toHaveAttribute(
      "href",
      "/events?view=month&month=2026-08&kind=vebinar",
    );
    await expect(page.getByTestId("month-today")).toHaveAttribute(
      "href",
      "/events?view=month&kind=vebinar",
    );

    // The picker states each month's count under the facets.
    await toolbar.locator("summary").click();
    await expect(toolbar.getByText("4 события").first()).toBeVisible();
    await toolbar.getByRole("link", { name: /Нояб/ }).click();
    await expect(page).toHaveURL(/month=2026-11/);
    await expect(page).toHaveURL(/kind=vebinar/);
  });

  test("NEW: a failed month read states its cause, the column keeps working (month · ошибка)", async ({
    page,
    request,
  }) => {
    expect((await request.post(`${api}/__e2e/month`, { data: { failing: true } })).ok()).toBe(true);
    try {
      await page.goto(MONTH);
      await expect(page.getByTestId("events-month-error")).toContainText(
        "Не удалось загрузить календарь",
      );
      await expect(panel(page)).toBeVisible();
    } finally {
      await request.post(`${api}/__e2e/month`, { data: { failing: false } });
    }
  });

  test("NEW: an empty month under a facet offers to weaken it (month · пусто по фильтрам)", async ({
    page,
  }) => {
    await page.goto(`${MONTH}&kind=master-klass`);
    const empty = page.getByTestId("events-month-empty");
    await expect(empty).toBeVisible();
    await expect(page.getByTestId("month-grid-desktop")).toHaveCount(0);
  });

  test("NEW: each host renders exactly its set; an applied facet shows as a chip, counts in «Применено: N» and is cleared by «Сбросить» (row 58, doctor)", async ({
    page,
  }) => {
    await page.goto("/events?month=2026-09");
    const facets = panel(page);
    for (const group of ["Специальность", "Формат", "Вид события"]) {
      await expect(facets.getByRole("group", { name: group })).toBeVisible();
    }
    // No event carries a city or an НМО flag (007): those controls do not render.
    await expect(facets.getByRole("group", { name: "Город" })).toHaveCount(0);
    await expect(facets.getByText("Только с НМО")).toHaveCount(0);
    await expect(facets.getByRole("group", { name: "Проект" })).toHaveCount(0);
    await expect(facets.getByText(/Применено/)).toHaveCount(0);

    await facets.getByRole("group", { name: "Формат" }).getByRole("button", { name: "Онлайн" }).click();
    await expect(page).toHaveURL(/format=online/);
    await expect(facets.getByText("Применено: 1")).toBeVisible();
    await expect(
      facets.getByRole("group", { name: "Формат" }).getByRole("button", { name: "Онлайн" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The facet reached the read: the server narrowed the feed.
    await expect(page.locator('section[id^="day-"]')).toHaveCount(2);

    await facets.getByRole("link", { name: "Сбросить" }).click();
    await expect(page).not.toHaveURL(/format=/);
    await expect(facets.getByText(/Применено/)).toHaveCount(0);
  });

  test("NEW: the three specialty states round-trip through the URL; the empty-by-specialty offer widens to adjacent (row 59)", async ({
    page,
  }) => {
    await page.goto("/events?month=2026-09");
    const specialty = panel(page).getByRole("group", { name: "Специальность" });
    await expect(specialty.getByRole("button", { name: "Моя и смежные" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await specialty.getByRole("button", { name: "Все специальности" }).click();
    await expect(page).toHaveURL(/specialty=all/);
    await expect(specialty.getByRole("button", { name: "Все специальности" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await specialty.getByRole("combobox").click();
    await page.getByRole("option", { name: "Неврология" }).click();
    await expect(page).toHaveURL(/specialty=nevrologiya/);
    const offer = page.getByTestId("events-feed-empty").getByRole("link", {
      name: "Показать смежные специальности",
    });
    await expect(offer).toBeVisible();

    // Removing the last picked specialty returns to «Моя и смежные».
    await specialty.getByRole("button", { name: "Убрать: Неврология" }).click();
    await expect(page).not.toHaveURL(/specialty=/);
    await expect(specialty.getByRole("button", { name: "Моя и смежные" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto("/events?month=2026-09&specialty=nevrologiya");
    await page
      .getByTestId("events-feed-empty")
      .getByRole("link", { name: "Показать смежные специальности" })
      .click();
    await expect(page).not.toHaveURL(/specialty=/);
    await expect(page.locator('section[id^="day-"]')).toHaveCount(2);
  });

  test("NEW: tense tabs keyboard-operable (row 61)", async ({ page }) => {
    await page.goto("/events");
    const tabs = page.getByTestId("events-tense-tabs");
    const upcoming = tabs.getByRole("tab", { name: "Будущие" });
    await upcoming.focus();
    await page.keyboard.press("ArrowLeft");
    const past = tabs.getByRole("tab", { name: "Прошедшие" });
    await expect(past).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/tense=past/);
  });
});

test.describe("the 1024 px breakpoint (row 52)", () => {
  test("NEW: at 1023 px the sheet + dot grid render, at 1024 px the column + pill grid", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1023, height: 900 });
    await page.goto(MONTH);
    await expect(page.getByTestId("events-filter-open")).toBeVisible();
    await expect(page.getByTestId("events-column")).toBeHidden();
    await expect(page.getByTestId("month-calendar-mobile")).toBeVisible();
    await expect(page.getByTestId("month-grid-desktop")).toBeHidden();

    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(page.getByTestId("events-column")).toBeVisible();
    await expect(page.getByTestId("events-filter-open")).toBeHidden();
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();
    await expect(page.getByTestId("month-calendar-mobile")).toBeHidden();
  });
});

test.describe("at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("NEW: below 1024 the month view is the dot grid with the agenda of the tapped day (row 55, doctor)", async ({
    page,
  }) => {
    await page.goto(MONTH);
    const mobile = page.getByTestId("month-calendar-mobile");
    await mobile.getByRole("button", { name: /^4 сентября/ }).click();
    const agenda = page.getByTestId("day-agenda");
    await expect(agenda).toContainText("4 сентября");
    await expect(agenda.getByRole("link", { name: /Событие evt-3/ })).toHaveAttribute(
      "href",
      "/events/evt-3",
    );
    await mobile.getByRole("button", { name: /^3 сентября/ }).click();
    await expect(agenda).toContainText("В этот день событий нет");
  });

  test("NEW: the sheet opens from «Фильтры (2)», applies, and «Показать N …» states the live count (row 60)", async ({
    page,
  }) => {
    await page.goto("/events?month=2026-09&format=online&kind=vebinar");
    const open = page.getByTestId("events-filter-open");
    await expect(open).toHaveText("Фильтры (2)");
    await open.click();
    const sheet = page.getByTestId("events-filter-sheet");
    await expect(sheet.getByRole("heading", { name: "Фильтры" })).toBeVisible();
    await expect(page.getByTestId("events-filter-show")).toHaveText("Показать 4 события");

    await sheet.getByRole("group", { name: "Формат" }).getByRole("button", { name: "Офлайн" }).click();
    await expect(page).toHaveURL(/format=online&format=offline|format=offline&format=online/);
    await page.getByTestId("events-filter-show").click();
    await expect(sheet).toBeHidden();

    await page.getByTestId("events-filter-open").click();
    await page.getByTestId("events-filter-sheet").getByRole("link", { name: "Сбросить" }).click();
    await expect(page).not.toHaveURL(/format=|kind=/);
    await expect(page.getByTestId("events-filter-open")).toHaveText("Фильтры");
  });
});
