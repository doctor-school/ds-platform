import { isGoldenUuid } from "@ds/db/seed/golden";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

type CalendarRow = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  state: string;
};
type Count = { month: number; count: number };

function state(world: StepWorld) {
  if (!world.publicCalendar) throw new Error("004 calendar horizon not read");
  return world.publicCalendar;
}
function shift(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, number! - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}
function title(month: string): string {
  const text = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(`${month}-01T12:00:00Z`))
    .replace(/\s*г\.$/u, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  return response.json() as Promise<T>;
}
async function hydrated(page: Page) {
  // 004 month-fidelity: server markup precedes the picker/day handlers.
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
}
async function selected(page: Page, month: string) {
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("view") === "month" &&
      url.searchParams.get("month") === month,
  );
  await expect(
    page.getByTestId("month-toolbar").locator("summary"),
  ).toContainText(title(month));
  await expect(page.getByTestId("month-grid-desktop")).toBeVisible();
  await expect(page.getByTestId("events-month-error")).toHaveCount(0);
}
async function counts(request: APIRequestContext, year: string) {
  const rows = await read<Count[]>(
    request,
    `/v1/public/events/month-counts?year=${year}`,
  );
  expect(rows.map((row) => row.month)).toEqual(
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  for (const row of rows) {
    expect(Number.isInteger(row.count)).toBe(true);
    expect(row.count).toBeGreaterThanOrEqual(0);
  }
  return rows;
}
async function inspectPicker(
  page: Page,
  rows: Count[],
  year: string,
  today: string,
  displayed: string,
) {
  const toolbar = page.getByTestId("month-toolbar");
  await expect(toolbar.getByTestId("month-picker-year")).toHaveText(year);
  const cells = toolbar.locator(
    'details .grid > a, details .grid > span[aria-current="true"]',
  );
  await expect(cells).toHaveCount(12);
  for (const [i, row] of rows.entries()) {
    const month = `${year}-${String(row.month).padStart(2, "0")}`;
    const cell = cells.nth(i);
    const label = new Intl.DateTimeFormat("ru-RU", {
      month: "short",
      timeZone: "UTC",
    })
      .format(new Date(`${month}-01T12:00:00Z`))
      .replace(/\.$/u, "");
    await expect(cell).toContainText(new RegExp(label, "iu"));
    if (row.count > 0)
      await expect(cell.locator("span").last()).toHaveText(
        new RegExp(`^${row.count} эф(?:ир|ира|иров)$`, "u"),
      );
    else
      await expect(cell).toContainText(
        month < today.slice(0, 7) ? "архив" : "нет эфиров",
      );
    if (month === displayed) {
      await expect(cell).toHaveAttribute("aria-current", "true");
      expect(await cell.evaluate((el) => el.tagName)).toBe("SPAN");
      await expect(cell).not.toHaveAttribute("href");
    } else {
      await expect(cell).toHaveAttribute(
        "href",
        new RegExp(`month=${month}`, "u"),
      );
      if (row.count === 0)
        await expect(cell).toHaveClass(/text-muted-foreground/u);
      else await expect(cell).not.toHaveClass(/text-muted-foreground/u);
    }
  }
}

Given(
  "the public calendar uses the supported horizon clock",
  async ({ request, page, world }) => {
    await page.context().clearCookies();
    const listing = await read<{ horizon: { today: string } }>(
      request,
      "/v1/public/events?timeframe=upcoming",
    );
    expect(listing.horizon.today).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    world.publicCalendar = {
      today: listing.horizon.today,
      month: listing.horizon.today.slice(0, 7),
      entries: [],
    };
  },
);

Given(
  "a golden historical month whose events have already ended",
  async ({ request, world }) => {
    const s = state(world);
    s.month = shift(s.today.slice(0, 7), -2);
    s.entries = await read<CalendarRow[]>(
      request,
      `/v1/public/events?month=${s.month}`,
    );
    expect(
      s.entries.length,
      "historical fixture prerequisite is nonempty",
    ).toBeGreaterThan(0);
    for (const row of s.entries) {
      expect(
        isGoldenUuid(row.id),
        "historical identity belongs to golden data",
      ).toBe(true);
      expect(["ended", "in_archive"]).toContain(row.state);
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(row.startsAt));
      expect(day < s.today).toBe(true);
      expect(day.slice(0, 7)).toBe(s.month);
    }
  },
);

Given(
  "a far calendar month with no events and a zero year count",
  async ({ request, world }) => {
    const s = state(world);
    s.month = shift(s.today.slice(0, 7), 24);
    s.entries = await read<CalendarRow[]>(
      request,
      `/v1/public/events?month=${s.month}`,
    );
    expect(s.entries).toEqual([]);
    const year = await counts(request, s.month.slice(0, 4));
    expect(year[Number(s.month.slice(5)) - 1]!.count).toBe(0);
  },
);

Given(
  "the public calendar month containing the horizon day",
  async ({ world }) => {
    state(world).month = state(world).today.slice(0, 7);
  },
);

When(
  "the visitor opens that public calendar month",
  async ({ page, host, world }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const response = await page.goto(
      `${host.eventsPath}?view=month&month=${state(world).month}`,
      { waitUntil: "domcontentloaded" },
    );
    expect(response?.status()).toBe(200);
    await hydrated(page);
    await selected(page, state(world).month);
  },
);

Then(
  "the historical grid renders muted linked past pills without participation states",
  async ({ page, host, world }) => {
    const grid = page.getByTestId("month-grid-desktop");
    const pills = grid.locator(`a[href^="${host.eventsPath}/"]`);
    expect(await pills.count(), "historical pills are present").toBeGreaterThan(
      0,
    );
    // 004 amendment 2026-10-05 caps each day at three pills plus overflow.
    for (const pill of await pills.all()) {
      const href = await pill.getAttribute("href");
      const row = state(world).entries.find(
        (entry) => href === `${host.eventsPath}/${entry.slug}`,
      );
      expect(
        row,
        "every rendered pill matches a real historical API row",
      ).toBeDefined();
      await expect(pill).toContainText(row!.title);
      await expect(pill).toHaveClass(/bg-calendar-muted/u);
      await expect(pill).toHaveClass(/text-muted-foreground/u);
      await expect(pill).toHaveClass(/border-hairline/u);
      await expect(pill).not.toHaveClass(
        /(?:^|\s)bg-live(?:\s|$)|(?:^|\s)bg-tint(?:\s|$)/u,
      );
    }
    await expect(grid.locator("a.bg-live, a.bg-tint")).toHaveCount(0);
    await expect(
      grid.getByRole("link", { name: /участвовать|регистрац|в эфире/iu }),
    ).toHaveCount(0);
  },
);

Then(
  "the empty desktop calendar is readable without event pills or notes",
  async ({ page, host }) => {
    const grid = page.getByTestId("month-grid-desktop");
    await expect(grid).toBeVisible();
    await expect(grid.locator(`a[href^="${host.eventsPath}/"]`)).toHaveCount(0);
    await expect(grid.locator(".grid-cols-7").first()).toContainText("пн");
    expect(await grid.locator(".grid-cols-7").count()).toBeGreaterThanOrEqual(
      5,
    );
    await expect(grid).not.toContainText(/прошли|прошёл|ещё/iu);
    await expect(grid.locator(".grid-cols-7 > div > div > span")).toHaveCount(
      0,
    );
  },
);

Then(
  "the mobile dot grid and selected-day agenda show no broadcasts",
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await hydrated(page);
    const mobile = page.getByTestId("month-calendar-mobile");
    await expect(mobile).toBeVisible();
    const days = mobile.locator("button[aria-pressed]");
    expect(await days.count()).toBeGreaterThanOrEqual(28);
    await expect(mobile.locator("button span.rounded-full")).toHaveCount(0);
    await days.last().click();
    await expect(days.last()).toHaveAttribute("aria-pressed", "true");
    await expect(mobile.getByTestId("day-agenda")).toContainText(
      "В этот день эфиров нет",
    );
    await expect(
      mobile.getByTestId("day-agenda").getByRole("link"),
    ).toHaveCount(0);
  },
);

When(
  "the visitor pages next and previous twice in the calendar",
  async ({ page, host, world }) => {
    const s = state(world);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(
      (
        await page.goto(`${host.eventsPath}?view=month&month=${s.month}`, {
          waitUntil: "domcontentloaded",
        })
      )?.status(),
    ).toBe(200);
    await hydrated(page);
    await selected(page, s.month);
    for (const delta of [1, -1, -1]) {
      await page
        .getByTestId("month-toolbar")
        .getByTestId(delta === 1 ? "month-next" : "month-prev")
        .click();
      s.month = shift(s.month, delta);
      await selected(page, s.month);
      await hydrated(page);
    }
  },
);

Then(
  "every selection retains the month URL, heading and grid",
  async ({ page, world }) => {
    await selected(page, state(world).month);
  },
);

Then(
  "the month picker shows all twelve API counts and a noninteractive selected marker",
  async ({ page, request, world }) => {
    const s = state(world);
    await page.getByTestId("month-toolbar").locator("summary").click();
    await inspectPicker(
      page,
      await counts(request, s.month.slice(0, 4)),
      s.month.slice(0, 4),
      s.today,
      s.month,
    );
  },
);

Then(
  "the picker distinguishes populated months, empty future months and empty archived months",
  async ({ page, request, world }) => {
    const s = state(world);
    const toolbar = page.getByTestId("month-toolbar");
    const year = s.month.slice(0, 4);
    const initial = await counts(request, year);
    expect(
      initial.some((row) => row.count > 0),
      "populated picker control",
    ).toBe(true);
    if (
      !initial.some(
        (row) =>
          row.count === 0 &&
          `${year}-${String(row.month).padStart(2, "0")}` < s.today.slice(0, 7),
      )
    ) {
      await toolbar
        .getByRole("button", { name: "Предыдущий год", exact: true })
        .click();
      const previous = String(Number(year) - 1);
      const rows = await counts(request, previous);
      expect(rows.some((row) => row.count === 0)).toBe(true);
      await inspectPicker(page, rows, previous, s.today, s.month);
      await toolbar
        .getByRole("button", { name: "Следующий год", exact: true })
        .click();
    }
    // Beyond the golden season, a future year provides an actual zero-count control.
    await toolbar
      .getByRole("button", { name: "Следующий год", exact: true })
      .click();
    const future = String(Number(year) + 1);
    const rows = await counts(request, future);
    expect(rows.some((row) => row.count === 0)).toBe(true);
    await inspectPicker(page, rows, future, s.today, s.month);
    await toolbar
      .getByRole("button", { name: "Предыдущий год", exact: true })
      .click();
    await expect(toolbar.getByTestId("month-picker-year")).toHaveText(year);
  },
);

When(
  "the visitor selects another month from the calendar picker",
  async ({ page, world }) => {
    const s = state(world);
    const target = shift(s.month, 2);
    if (target.slice(0, 4) !== s.month.slice(0, 4)) {
      await page
        .getByTestId("month-toolbar")
        .getByRole("button", { name: "Следующий год", exact: true })
        .click();
      await expect(
        page.getByTestId("month-toolbar").getByTestId("month-picker-year"),
      ).toHaveText(target.slice(0, 4));
    }
    await page
      .getByTestId("month-toolbar")
      .locator(`details .grid a[href*="month=${target}"]`)
      .click();
    s.month = target;
    await selected(page, target);
  },
);
