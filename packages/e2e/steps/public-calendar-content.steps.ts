import { golden, isGoldenUuid } from "@ds/db/seed/golden";
import { expect, type Page } from "@playwright/test";

import { reachFeedCard } from "../lib/feed-card.js";
import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

type Entry = NonNullable<StepWorld["publicCalendar"]>["entries"][number];

function calendar(world: StepWorld) {
  if (!world.publicCalendar) throw new Error("004 calendar horizon not read");
  return world.publicCalendar;
}
function dayOf(entry: Entry) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(entry.startsAt));
}
function byDay(entries: Entry[]) {
  const days = new Map<string, Entry[]>();
  for (const entry of entries) {
    const day = dayOf(entry);
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return days;
}
async function settled(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
}
async function open(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "cookie-free public document").toBe(200);
  expect(
    response?.request().redirectedFrom(),
    "public view stays in place",
  ).toBeNull();
  await settled(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Расписание эфиров",
      exact: true,
    }),
  ).toBeVisible();
}
async function feedSnapshot(page: Page) {
  return {
    cards: await page
      .getByTestId("events-feed")
      .locator("[data-webinar-card]")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const title = card.querySelector("h3 a");
          return {
            href: title?.getAttribute("href") ?? null,
            title: title?.textContent ?? null,
          };
        }),
      ),
    groups: await page
      .getByTestId("events-feed")
      .locator('section[id^="day-"]')
      .evaluateAll((groups) =>
        groups.map((group) => ({
          id: group.id,
          text: (group.textContent ?? "").trim(),
        })),
      ),
  };
}
async function switchView(page: Page, month: boolean) {
  const link = page.getByTestId("events-view-switch");
  await expect(link).toHaveText(
    month ? "Календарь на месяц →" : "← Лента событий",
  );
  await link.click();
  await expect(page).toHaveURL(
    (url) => (url.searchParams.get("view") === "month") === month,
  );
  await settled(page);
  await expect(page.getByTestId("events-month-view")).toHaveCount(
    month ? 1 : 0,
  );
}

Given(
  "the guest reads the default public day-grouped feed",
  async ({ page, host, world }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, host.eventsPath);
    await expect(
      page
        .getByTestId("events-tense-tabs")
        .getByRole("tab", { name: "Будущие", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByTestId("events-feed").locator("[data-webinar-card]").first(),
    ).toBeVisible();
    world.publicCalendarFeed = await feedSnapshot(page);
    expect(
      world.publicCalendarFeed.cards.length,
      "populated feed prerequisite",
    ).toBeGreaterThan(0);
    expect(
      world.publicCalendarFeed.groups.length,
      "day-grouped feed prerequisite",
    ).toBeGreaterThan(0);
    expect(
      world.publicCalendarFeed.cards.every((card) => card.href && card.title),
    ).toBe(true);
  },
);

When(
  "the visitor follows the calendar and feed links in both directions",
  async ({ page, world }) => {
    await switchView(page, true);
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();
    const shown = page.getByTestId("month-toolbar").locator("summary");
    const date = new Date(`${calendar(world).month}-01T12:00:00Z`);
    const label = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    })
      .format(date)
      .replace(/\s*г\.$/u, "");
    await expect(shown).toContainText(new RegExp(label, "iu"));
    await switchView(page, false);
  },
);

Then(
  "the current month renders and the same day-grouped feed returns with nothing lost",
  async ({ page, world }) => {
    expect(world.publicCalendarFeed).toBeDefined();
    await expect
      .poll(() => feedSnapshot(page))
      .toEqual(world.publicCalendarFeed);
    await expect(
      page
        .getByTestId("events-tense-tabs")
        .getByRole("tab", { name: "Будущие", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  },
);

Then(
  "carried month, tense and facet state survive the public view round-trip",
  async ({ page, host, world }) => {
    const current = calendar(world).month;
    const carried = new Date(`${current}-01T12:00:00Z`);
    carried.setUTCMonth(carried.getUTCMonth() - 1);
    const month = carried.toISOString().slice(0, 7);
    await open(page, `${host.eventsPath}?view=month&month=${month}`);
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();
    await switchView(page, false);
    expect(new URL(page.url()).searchParams.get("month")).toBe(month);
    await switchView(page, true);
    expect(new URL(page.url()).searchParams.get("month")).toBe(month);
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();

    // 004 EARS-18, amendment 2026-10-05: the retained facet path is seed-independent.
    await open(page, `${host.eventsPath}?tense=past&topic=kardiologiya`);
    const past = page
      .getByTestId("events-tense-tabs")
      .getByRole("tab", { name: "Прошедшие", exact: true });
    await expect(past).toHaveAttribute("aria-selected", "true");
    await switchView(page, true);
    const next = page.getByTestId("month-next");
    const target = new URL(
      (await next.getAttribute("href"))!,
      page.url(),
    ).searchParams.get("month");
    expect(target).toMatch(/^\d{4}-\d{2}$/u);
    await next.click();
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("month") === target,
    );
    await settled(page);
    await switchView(page, false);
    const params = new URL(page.url()).searchParams;
    expect(params.get("month")).toBe(target);
    expect(params.get("topic")).toBe("kardiologiya");
    expect(params.get("tense")).toBe("past");
    await expect(past).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("events-view-switch")).toBeVisible();
  },
);

Given(
  "the current golden month contains published, live and past events",
  async ({ request, world }) => {
    const state = calendar(world);
    const response = await request.get(
      `/v1/public/events?month=${state.month}`,
    );
    expect(response.status()).toBe(200);
    state.entries = (await response.json()) as Entry[];
    expect(state.entries.length).toBeGreaterThan(0);
    for (const entry of state.entries) {
      expect(isGoldenUuid(entry.id), "only real golden calendar fixtures").toBe(
        true,
      );
      expect(dayOf(entry).slice(0, 7)).toBe(state.month);
    }
    for (const status of ["published", "live", "ended"])
      expect(
        state.entries.some((entry) => entry.state === status),
        `required ${status} control`,
      ).toBe(true);
    expect(state.entries).toContainEqual(
      expect.objectContaining({ ...golden.events.academyLive, state: "live" }),
    );
  },
);

Then(
  "the desktop seven-column calendar matches the published, live and past events",
  async ({ page, host, world }) => {
    const state = calendar(world);
    const grid = page.getByTestId("month-grid-desktop");
    const weeks = grid.locator(".grid-cols-7");
    expect(await weeks.count()).toBeGreaterThanOrEqual(5);
    await expect(weeks.first().locator(":scope > span")).toHaveText([
      "пн",
      "вт",
      "ср",
      "чт",
      "пт",
      "сб",
      "вс",
    ]);
    const cells = weeks.locator(":scope > div");
    const pills = grid.locator(`a[href^="${host.eventsPath}/"]`);
    const groups = byDay(state.entries);
    expect(await pills.count()).toBe(
      [...groups.values()].reduce(
        (sum, entries) => sum + Math.min(3, entries.length),
        0,
      ),
    );
    let planned = 0;
    let past = 0;
    for (const pill of await pills.all()) {
      const href = await pill.getAttribute("href");
      const entry = state.entries.find(
        (row) => href === `${host.eventsPath}/${row.slug}`,
      );
      expect(entry, "every pill is an actual public event").toBeDefined();
      await expect(pill).toContainText(entry!.title);
      if (entry!.state === "live") {
        await expect(pill).toHaveClass(/(?:^|\s)bg-live(?:\s|$)/u);
        await expect(pill).toContainText("Идёт сейчас");
      } else if (
        ["ended", "in_archive"].includes(entry!.state) ||
        dayOf(entry!) < state.today
      ) {
        past++;
        await expect(pill).toHaveClass(/bg-calendar-muted/u);
        await expect(pill).toHaveClass(/text-muted-foreground/u);
        await expect(pill).not.toHaveClass(/(?:^|\s)bg-live(?:\s|$)/u);
      } else {
        planned++;
        await expect(pill).toHaveClass(/(?:^|\s)bg-tint(?:\s|$)/u);
      }
    }
    expect(planned, "planned pills actually rendered").toBeGreaterThan(0);
    expect(past, "muted past linked pills actually rendered").toBeGreaterThan(
      0,
    );
    let overflow:
      | { day: string; href: string; count: number; entries: Entry[] }
      | undefined;
    for (const [day, entries] of groups) {
      const dayNumber = Number(day.slice(8));
      const cell = cells.filter({
        has: page.locator(`:scope > span`, {
          hasText: new RegExp(`^${dayNumber}(?: · сегодня)?$`, "u"),
        }),
      });
      // Neighbour-month fillers cannot carry event links.
      const dayPills = cell.locator(`a[href^="${host.eventsPath}/"]`);
      await expect(dayPills).toHaveCount(Math.min(3, entries.length));
      if (entries.length > 3) {
        const more = cell.getByRole("link", {
          name: `+${entries.length - 3} ещё`,
          exact: true,
        });
        await expect(more).toBeVisible();
        const href = await more.getAttribute("href");
        const target = new URL(href!, page.url());
        expect(target.pathname).toBe(host.eventsPath);
        expect(target.searchParams.get("day")).toBe(day);
        expect(target.searchParams.get("month")).toBe(day.slice(0, 7));
        expect(target.searchParams.has("view")).toBe(false);
        expect(target.searchParams.get("tense") ?? "upcoming").toBe(
          day < state.today ? "past" : "upcoming",
        );
        overflow ??= { day, href: href!, count: entries.length - 3, entries };
      }
    }
    await expect(
      grid.locator(
        `a[href="${host.eventsPath}/${golden.events.academyLive.slug}"]`,
      ),
    ).toHaveClass(/(?:^|\s)bg-live(?:\s|$)/u);
    expect(
      overflow,
      "golden month contains a real overflow-day control",
    ).toBeDefined();
    const original = page.url();
    const selectedOverflow = overflow!;
    await grid
      .getByRole("link", {
        name: `+${selectedOverflow.count} ещё`,
        exact: true,
      })
      .and(grid.locator(`a[href="${selectedOverflow.href}"]`))
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === host.eventsPath &&
        url.searchParams.get("day") === selectedOverflow.day &&
        url.searchParams.get("month") === selectedOverflow.day.slice(0, 7) &&
        !url.searchParams.has("view"),
    );
    // The feed splits Будущие/Прошедшие by lifecycle state (004 «Amendment —
    // 2026-10-05»): a past day lives wholly in the past feed's month group,
    // while today's already-ended entries leave the upcoming feed for the
    // past one — the seed marks a grid event ended when it started before
    // the seed instant, so their number depends on when stage was seeded.
    const isEnded = (entry: Entry) =>
      ["ended", "in_archive"].includes(entry.state);
    const pastDay = selectedOverflow.day < state.today;
    const upcoming = pastDay
      ? []
      : selectedOverflow.entries.filter((entry) => !isEnded(entry));
    const pastEntries = pastDay
      ? selectedOverflow.entries
      : selectedOverflow.entries.filter(isEnded);
    const expectInGroup = async (groupId: string, entries: Entry[]) => {
      const group = page
        .getByTestId("events-feed")
        .locator(`section[id="day-${groupId}"]`);
      await expect(group).toBeVisible();
      for (const entry of entries) {
        await expect(
          group
            .getByRole("link", { name: entry.title, exact: true })
            .and(group.locator(`a[href="${host.eventsPath}/${entry.slug}"]`)),
        ).toBeVisible();
      }
    };
    if (pastDay) {
      await expectInGroup(selectedOverflow.day.slice(0, 7), pastEntries);
    } else {
      await expectInGroup(selectedOverflow.day, upcoming);
      if (pastEntries.length > 0) {
        const pastFeed = new URL(selectedOverflow.href, page.url());
        pastFeed.searchParams.set("tense", "past");
        await open(page, `${pastFeed.pathname}${pastFeed.search}`);
        await expectInGroup(selectedOverflow.day.slice(0, 7), pastEntries);
      }
    }
    await open(page, original);
    await expect(grid).toBeVisible();
  },
);

Then(
  "today is outlined and the three-state calendar legend is readable",
  async ({ page, world }) => {
    const grid = page.getByTestId("month-grid-desktop");
    const today = grid.getByText(
      `${Number(calendar(world).today.slice(8))} · сегодня`,
      { exact: true },
    );
    await expect(today).toBeVisible();
    await expect(today.locator("..")).toHaveClass(/outline-primary-action/u);
    const legend = grid.getByTestId("grid-legend");
    for (const label of ["Идёт сейчас", "Запланировано", "Прошло"])
      await expect(legend.getByText(label, { exact: true })).toBeVisible();
  },
);

Then(
  "the mobile dots and selected-day agenda match those same events",
  async ({ page, host, world }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await settled(page);
    const mobile = page.getByTestId("month-calendar-mobile");
    await expect(mobile).toBeVisible();
    const days = mobile.locator("button[aria-pressed]");
    expect(await days.count()).toBeGreaterThanOrEqual(28);
    const unchanged = page.url();
    for (const [day, entries] of byDay(calendar(world).entries)) {
      const button = days.nth(Number(day.slice(8)) - 1);
      await expect(button.locator("span.rounded-full")).toHaveCount(
        Math.min(3, entries.length),
      );
      // 004 EARS-19 caps the live-first day summary at three status dots.
      const summary = [...entries]
        .sort((a, b) => Number(b.state === "live") - Number(a.state === "live"))
        .slice(0, 3);
      const liveCount = summary.filter(
        (entry) => entry.state === "live",
      ).length;
      const pastCount = summary.filter(
        (entry) =>
          entry.state !== "live" &&
          (["ended", "in_archive"].includes(entry.state) ||
            day < calendar(world).today),
      ).length;
      await expect(button.locator("span.bg-live")).toHaveCount(liveCount);
      await expect(button.locator("span.bg-muted-2")).toHaveCount(pastCount);
      await expect(
        button.locator("span.bg-info, span.bg-primary-foreground"),
      ).toHaveCount(summary.length - liveCount - pastCount);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      expect(page.url()).toBe(unchanged);
      const agenda = mobile.getByTestId("day-agenda");
      await expect(agenda.getByRole("link")).toHaveCount(entries.length);
      for (const entry of entries) {
        const row = agenda.locator(
          `a[href="${host.eventsPath}/${entry.slug}"]`,
        );
        await expect(row).toBeVisible();
        await expect(row).toContainText(entry.title);
        if (entry.state === "live") {
          await expect(row).toHaveClass(/border-live/u);
          await expect(row).toContainText("В эфире");
        } else {
          await expect(row).not.toHaveClass(/border-live/u);
          await expect(row).not.toContainText("В эфире");
        }
      }
    }
  },
);

Given(
  "the golden Academy live event is publicly readable",
  async ({ request, world }) => {
    const response = await request.get(
      `/v1/public/events/${golden.events.academyLive.slug}`,
    );
    expect(response.status()).toBe(200);
    const event = (await response.json()) as {
      id: string;
      slug: string;
      title: string;
      state: string;
    };
    expect(event).toMatchObject({
      ...golden.events.academyLive,
      state: "live",
    });
    expect(event.title).toMatch(/\S/u);
    world.publicEvent = { slug: event.slug, title: event.title };
  },
);

When(
  "the visitor opens that live event from its listing card",
  async ({ page, host, world }) => {
    if (!world.publicEvent) throw new Error("004 live fixture not read");
    await open(page, host.eventsPath);
    const path = `${host.eventsPath}/${world.publicEvent.slug}`;
    const link = page
      .getByRole("link", { name: world.publicEvent.title, exact: true })
      .and(page.locator(`a[href="${path}"]`));
    const card = await reachFeedCard(page, link);
    await expect(card).toContainText("В эфире");
    await expect(card).not.toContainText(/Эфир завершён|^Скоро$/u);
    await card
      .getByRole("link", { name: world.publicEvent.title, exact: true })
      .and(card.locator(`a[href="${path}"]`))
      .click();
    await expect(page).toHaveURL((url) => url.pathname === path);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: world.publicEvent.title,
        exact: true,
      }),
    ).toBeVisible();
  },
);

Then(
  "the live event page shows the same live signal without contradictory lifecycle copy",
  async ({ page, world }) => {
    if (!world.publicEvent) throw new Error("004 live fixture not read");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: world.publicEvent.title,
        exact: true,
      }),
    ).toBeVisible();
    const hero = page.getByTestId("event-page-hero");
    await expect(hero.getByText("В эфире", { exact: true })).toBeVisible();
    await expect(hero).not.toContainText(
      /Эфир завершён|Скоро|Мероприятие скрыто/u,
    );
  },
);
