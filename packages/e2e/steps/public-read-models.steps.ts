import { golden } from "@ds/db/seed/golden";
import {
  expect,
  type APIRequestContext,
  type Response,
} from "@playwright/test";

import {
  RAZDEL_I_NAMES,
  SPECIALTY_OTHER_NAME,
} from "../../db/src/seed/specialties-minzdrav.data.js";
import { specialtyCodeFromName } from "../../db/src/seed/specialty-code.js";
import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

type Statistics = {
  computedAt: string;
  doctors: number;
  specialties: number;
  eventsPerYear: number;
  lessons?: number;
};
type Entry = { id: string; code: string; name: string; isOther: boolean };
type Book = { entries: Entry[]; total: number };
type Card = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  state: string;
  format: string;
  school: string;
  specialties: string[];
  speakers: { name: string }[];
};
type State = {
  statistics?: Statistics;
  statisticsResponse?: Promise<Response>;
  book?: Book;
  cards?: Card[];
  readAt?: number;
};
const states = new WeakMap<StepWorld, State>();
function state(world: StepWorld): State {
  let value = states.get(world);
  if (!value) {
    value = {};
    states.set(world, value);
  }
  return value;
}
async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  return response.json() as Promise<T>;
}

Given(
  "one of the four scale counters has no available source",
  async ({ request, page, world }) => {
    const statistics = await read<Statistics>(request, "/v1/public/statistics");
    expect(statistics).not.toHaveProperty("lessons");
    for (const key of ["doctors", "specialties", "eventsPerYear"] as const)
      expect(statistics[key]).toBeGreaterThan(0);
    state(world).statisticsResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/public/statistics",
    );
  },
);
Then(
  "that counter is absent from the rendered statistics row",
  async ({ page, world }) => {
    const response = await state(world).statisticsResponse;
    expect(response?.status()).toBe(200);
    const statistics = (await response!.json()) as Statistics;
    expect(statistics).not.toHaveProperty("lessons");
    state(world).statistics = statistics;
    await expect(page.getByTestId("hero-counters")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await expect(page.getByTestId("hero-counters")).toHaveAttribute(
      "data-computed-at",
      statistics.computedAt,
    );
    await expect(page.getByTestId("hero-counter-lessons")).toHaveCount(0);
    await expect(page.getByTestId("hero-counters")).not.toContainText("уроков");
  },
);
Then("the remaining counters render normally", async ({ page, world }) => {
  const statistics = state(world).statistics!;
  const labels = {
    doctors: "врачей уже с нами",
    specialties: "специальностей",
    eventsPerYear: "событий за год",
  };
  await expect(page.getByTestId("hero-counters").locator("dd")).toHaveCount(
    Object.keys(labels).length,
  );
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    const counter = page.getByTestId(`hero-counter-${key}`);
    await expect(counter).toBeVisible();
    await expect(counter.locator("dt")).toHaveText(labels[key]);
    await expect(counter.locator("dd")).toHaveText(
      new Intl.NumberFormat("ru-RU").format(statistics[key]),
    );
  }
});
Then("no counter renders as a zero", async ({ page }) => {
  for (const value of await page
    .getByTestId("hero-counters")
    .locator("dd")
    .allTextContents())
    expect(Number(value.replace(/\s/gu, ""))).toBeGreaterThan(0);
});

When("the public specialty book is read", async ({ request, world, page }) => {
  state(world).book = await read<Book>(request, "/v1/public/specialties");
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
    "data-state",
    "open",
  );
  await page.getByTestId("specialty-expand").click();
  await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
    "data-state",
    "expanded",
  );
});
Then(
  "it returns every seeded book entry plus the «Другое» entry",
  async ({ world, page }) => {
    const entries = state(world).book!.entries;
    const expected = [...RAZDEL_I_NAMES, SPECIALTY_OTHER_NAME].map((name) => ({
      name,
      code: specialtyCodeFromName(name),
      isOther: name === SPECIALTY_OTHER_NAME,
    }));
    const byCode = <T extends { code: string }>(values: T[]) =>
      [...values].sort((a, b) => a.code.localeCompare(b.code));
    expect(
      byCode(
        entries.map(({ name, code, isOther }) => ({ name, code, isOther })),
      ),
    ).toEqual(byCode(expected));
    const chips = page
      .getByTestId("specialty-catalog")
      .getByTestId("specialty-entry");
    await expect(chips).toHaveCount(entries.length);
    expect(
      await chips.evaluateAll((nodes) =>
        nodes.map((node) => ({
          code: node.getAttribute("data-code"),
          name: node.textContent?.trim(),
        })),
      ),
    ).toEqual(entries.map(({ code, name }) => ({ code, name })));
    await expect(chips.filter({ hasText: /^Другое$/u })).toBeVisible();
  },
);
Then(
  "the reported total equals the number of entries returned",
  async ({ world, page }) => {
    const book = state(world).book!;
    expect(book.total).toBe(book.entries.length);
    await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
      "data-total",
      String(book.total),
    );
  },
);
Then("each entry carries a stable id", async ({ world, request }) => {
  const entries = state(world).book!.entries;
  expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length);
  for (const entry of entries)
    expect(entry.id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  const repeated = await read<Book>(request, "/v1/public/specialties");
  expect(repeated.entries.map(({ code, id }) => ({ code, id }))).toEqual(
    entries.map(({ code, id }) => ({ code, id })),
  );
});
Then(
  "specialties, directions and schools are three distinct read models",
  async ({ world }) => {
    const book = state(world).book!;
    expect(Object.keys(book).sort()).toEqual(["entries", "total"]);
    for (const entry of book.entries)
      expect(Object.keys(entry).sort()).toEqual([
        "code",
        "id",
        "isOther",
        "name",
      ]);
  },
);

Given(
  "several published events with future air dates and some past, draft, and archived events",
  async ({ request, page, host, world }) => {
    expect(host.id).toBe("academy");
    await page.context().clearCookies();
    const reading = await read<{ data: Card[] }>(
      request,
      "/v1/public/events?timeframe=upcoming",
    );
    expect(
      reading.data.filter(
        (card) =>
          card.state === "published" && Date.parse(card.startsAt) > Date.now(),
      ).length,
    ).toBeGreaterThan(1);
    const hidden = await read<Card>(
      request,
      `/v1/public/events/${golden.events.hidden.slug}`,
    );
    expect(hidden.state).toBe("hidden");
    const past = await read<Card>(
      request,
      `/v1/public/events/${golden.events.pastWithRecording.slug}`,
    );
    expect(past.state).toBe("ended");
    expect(Date.parse(past.startsAt)).toBeLessThan(Date.now());
    expect(
      (
        await request.get(`/v1/public/events/${golden.events.draft.slug}`)
      ).status(),
    ).toBe(404);
    state(world).cards = reading.data;
    state(world).readAt = Date.now();
  },
);
When(
  "a visitor opens the upcoming-broadcasts listing",
  async ({ page, host }) => {
    const response = await page.goto(host.eventsPath);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Расписание эфиров",
        exact: true,
      }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
  },
);
Then(
  "only published or live currently-airing or future events are listed, ordered nearest air date first",
  async ({ world, page, host }) => {
    const cards = state(world).cards!;
    for (const card of cards) {
      expect(["published", "live"]).toContain(card.state);
      expect(Date.parse(card.startsAt)).toBeGreaterThanOrEqual(
        state(world).readAt! - 6 * 60 * 60 * 1000,
      );
    }
    expect(cards.map(({ startsAt, id }) => `${startsAt}/${id}`)).toEqual(
      cards.map(({ startsAt, id }) => `${startsAt}/${id}`).sort(),
    );
    const rendered = page.locator("[data-webinar-card]");
    await expect(rendered).toHaveCount(cards.length);
    const links = await rendered.evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector("h3 a")?.getAttribute("href")),
    );
    expect(links).toEqual(
      cards.map((card) => `${host.eventsPath}/${card.slug}`),
    );
  },
);
Then(
  /^each card shows its displayed date, time and zone, title, school\/series, specialties, and speakers$/u,
  async ({ page, world }) => {
    const viewerZone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    for (const [index, card] of state(world).cards!.entries()) {
      const rendered = page.locator("[data-webinar-card]").nth(index);
      for (const value of [
        card.title,
        card.school,
        ...card.specialties,
        ...card.speakers.map(({ name }) => name),
      ])
        await expect(rendered).toContainText(value);
      const timeZone = card.format === "offline" ? "Europe/Moscow" : viewerZone;
      const instant = new Date(card.startsAt);
      await expect(rendered).toContainText(
        new Intl.DateTimeFormat("ru-RU", {
          timeZone,
          day: "numeric",
          month: "long",
        }).format(instant),
      );
      await expect(rendered).toContainText(
        new Intl.DateTimeFormat("ru-RU", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(instant),
      );
      const offset = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
      })
        .formatToParts(instant)
        .find((part) => part.type === "timeZoneName")!.value;
      const zone =
        offset === "GMT+03:00"
          ? "МСК"
          : offset
              .replace(/GMT([+-])0?(\d+):00$/u, "GMT$1$2")
              .replace(/^GMT$/u, "GMT+0");
      await expect(rendered).toContainText(zone);
    }
  },
);
Then(
  "past, draft, and archived events are absent",
  async ({ page, world, host }) => {
    for (const fixture of [
      golden.events.draft,
      golden.events.hidden,
      golden.events.pastWithRecording,
    ]) {
      expect(
        state(world).cards!.some(
          (card) => card.id === fixture.id || card.slug === fixture.slug,
        ),
      ).toBe(false);
      await expect(
        page.locator(
          `[data-webinar-card] a[href="${host.eventsPath}/${fixture.slug}"]`,
        ),
      ).toHaveCount(0);
    }
  },
);
