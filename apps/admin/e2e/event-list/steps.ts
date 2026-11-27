import { signInAsAdmin } from "@ds/e2e/admin-events";
import { EVENT_LIFECYCLE_STATES } from "@ds/schemas";
import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import {
  adminRead,
  eventListSeeds,
  expectListRows,
  listAddress,
  seedListEvent,
  sortHeader,
  type EventListSeed,
} from "../support/events-list";
import { adminOrigin, test, type AdminWorld } from "../support/fixtures";

/**
 * 007 EARS-14 (#4305) — the `@event-list-journey` original of
 * `007-scenarios.feature` on the real Admin: an operator finds events in the
 * list by sorting and filtering, and a reload keeps the view. Every When and
 * Then runs in the browser against the running admin app and api.
 *
 * The run authors its own five events through the admin create form, each in a
 * school carrying the run marker, and narrows the list to them by that marker
 * (the search covers the school), so the orders asserted never depend on what
 * else the shared stand holds (`support/events-list.ts` documents the orders).
 *
 * The 007 Background is executed, not echoed: the admin step signs a
 * platform_admin in and reads the session's roles; the storage step authors the
 * run's first event with its program PDF and reads the stored reference back;
 * the lifecycle step reads the closed state set off the list's status facet;
 * the МСК step reads the first event's start back as the one canonical instant
 * of the МСК wall time the form was given; the consumer step reads the
 * published first event through the public event page.
 */
const { Given, When, Then } = createBdd(test);

const DATE = "Дата и время (МСК)";
const TITLE = "Название";
const PERIOD = { from: "2027-01-01", to: "2027-03-31" } as const;
const PERIOD_CHIP = "Убрать фильтр: Дата проведения: 01.01.2027 – 31.03.2027";
const STATE_CHIP = "Убрать фильтр: Опубликовано";
const INVERTED_TO = "2026-12-20";

const filters = (page: Page) => page.getByTestId("events-filters");
const chips = (page: Page) =>
  filters(page).getByRole("button", { name: /^Убрать фильтр/ });

function journey(world: AdminWorld): NonNullable<AdminWorld["eventList"]> {
  expect(
    world.eventList,
    "the run's events are authored by the 007 Background storage step",
  ).toBeDefined();
  return world.eventList!;
}

const seedsOf = (world: AdminWorld) => eventListSeeds(journey(world).marker);

const expectRows = (
  page: Page,
  world: AdminWorld,
  keys: EventListSeed["key"][],
) => expectListRows(page, seedsOf(world), keys);

/** The address's query as ordered pairs, so a stray parameter fails it. */
const query = (page: Page) => [...new URL(page.url()).searchParams.entries()];

// ── 007 Background ─────────────────────────────────────────────────────────

Given(
  /^the admin app is served on its configured origin with a platform_admin session \(feature 003\)$/,
  async ({ page }) => {
    await signInAsAdmin(page);
    expect(new URL(page.url()).origin).toBe(new URL(adminOrigin()).origin);
    const session = await page.evaluate(async () => {
      const answer = await fetch("/v1/admin/auth/session");
      return { status: answer.status, body: await answer.json() };
    });
    expect(session.status).toBe(200);
    expect((session.body as { roles: string[] }).roles).toContain(
      "platform_admin",
    );
  },
);

Given(
  /^the object storage \(MinIO\/Timeweb\) is available for the program PDF$/,
  async ({ page, world }) => {
    const marker = Date.now().toString(36);
    const [first] = eventListSeeds(marker);
    const id = await seedListEvent(page, first!);
    const event = await adminRead<{ programPdfRef: string | null }>(
      page,
      `/v1/admin/events/${id}`,
    );
    expect(event.programPdfRef, "the program PDF is stored").toBeTruthy();
    world.eventList = { marker, ids: { [first!.key]: id } };
  },
);

Given(
  "EventLifecycleState has the closed set draft, published, live, ended, hidden, in_archive with origin selecting the disjoint platform lifecycle draft → published → live → ended → hidden or legacy lifecycle in_archive ⇄ hidden",
  async ({ page }) => {
    expect([...EVENT_LIFECYCLE_STATES]).toEqual([
      "draft",
      "published",
      "live",
      "ended",
      "hidden",
      "in_archive",
    ]);
    await page.goto("/events");
    const facet = filters(page).getByTestId("events-status");
    await expect(facet).toBeVisible();
    await expect
      .poll(() =>
        facet
          .locator("option")
          .evaluateAll((options) =>
            options
              .map((option) => (option as HTMLOptionElement).value)
              .filter(Boolean),
          ),
      )
      .toEqual([...EVENT_LIFECYCLE_STATES]);
  },
);

Given(
  "all absolute times are entered as МСК and stored as one canonical instant",
  async ({ page, world }) => {
    const [first] = seedsOf(world);
    const id = journey(world).ids[first!.key]!;
    const { startsAt } = await adminRead<{ startsAt: string }>(
      page,
      `/v1/admin/events/${id}`,
    );
    expect(new Date(startsAt).toISOString()).toBe(
      new Date(`${first!.startsAtMsk}:00+03:00`).toISOString(),
    );
    await expect(page.getByRole("columnheader", { name: DATE })).toBeVisible();
  },
);

Given(
  /^the public event page and listing \(feature 004\), registration \(feature 005\), and the room \(feature 006\) read the state 007 writes$/,
  async ({ page, world }) => {
    const [first] = seedsOf(world);
    expect(first!.publish, "the run's first event is published").toBe(true);
    const id = journey(world).ids[first!.key]!;
    const read = await page.request.get(`/v1/public/events/${id}`);
    expect(read.status(), `GET /v1/public/events/${id}`).toBe(200);
    expect(((await read.json()) as { state: string }).state).toBe(
      "published",
    );
  },
);

// ── The journey ────────────────────────────────────────────────────────────

Given(
  "a platform_admin operator with events of several schools, states and start dates",
  async ({ page, world }) => {
    const list = journey(world);
    for (const seed of seedsOf(world)) {
      list.ids[seed.key] ??= await seedListEvent(page, seed);
    }
  },
);

When(
  "the operator opens the event list narrowed to those events by the search",
  async ({ page, world }) => {
    await page.goto(`/events?q=${journey(world).marker}`);
  },
);

Then(
  "the events are listed newest start date first and the default order is not in the address",
  async ({ page, world }) => {
    await expectRows(page, world, ["htn", "migraine", "dm", "back", "af"]);
    expect(query(page)).toEqual([["q", journey(world).marker]]);
    await expect(
      page.getByRole("columnheader", { name: DATE }),
    ).toHaveAttribute("aria-sort", "descending");
  },
);

When("the operator sorts the list by title", async ({ page }) => {
  await sortHeader(page, TITLE).click();
});

Then(
  "the events are listed by title from А to Я and the sort is in the address",
  async ({ page, world }) => {
    await expect.poll(() => query(page)).toEqual([
      ["q", journey(world).marker],
      ["sort", "title"],
      ["dir", "asc"],
    ]);
    await expectRows(page, world, ["htn", "back", "migraine", "dm", "af"]);
    await expect(
      page.getByRole("columnheader", { name: TITLE }),
    ).toHaveAttribute("aria-sort", "ascending");
  },
);

When(
  "the operator narrows the list to published events starting in a period of Moscow days",
  async ({ page }) => {
    await filters(page).getByTestId("events-status").selectOption("published");
    await page.getByTestId("events-period-from").fill(PERIOD.from);
    await page.getByTestId("events-period-to").fill(PERIOD.to);
  },
);

Then(
  "only those events are listed and each filter is shown as a removable chip",
  async ({ page, world }) => {
    const { marker } = journey(world);
    await expect.poll(() => query(page)).toEqual([
      ["q", marker],
      ["state", "published"],
      ["startsFrom", PERIOD.from],
      ["startsTo", PERIOD.to],
      ["sort", "title"],
      ["dir", "asc"],
    ]);
    await expectRows(page, world, ["htn", "dm"]);
    await expect(chips(page)).toHaveCount(3);
    await expect(
      filters(page).getByRole("button", {
        name: `Убрать фильтр: Поиск: ${marker}`,
      }),
    ).toBeVisible();
    await expect(
      filters(page).getByRole("button", { name: STATE_CHIP }),
    ).toBeVisible();
    await expect(
      filters(page).getByRole("button", { name: PERIOD_CHIP }),
    ).toBeVisible();
  },
);

When("the operator reloads the page", async ({ page, world }) => {
  journey(world).addressBeforeReload = listAddress(page);
  await page.reload();
});

Then("the same sorted and filtered view is shown", async ({ page, world }) => {
  expect(listAddress(page)).toBe(journey(world).addressBeforeReload);
  await expectRows(page, world, ["htn", "dm"]);
  await expect(filters(page).getByRole("searchbox")).toHaveValue(
    journey(world).marker,
  );
  await expect(filters(page).getByTestId("events-status")).toHaveValue(
    "published",
  );
  await expect(page.getByTestId("events-period-from")).toHaveValue(
    PERIOD.from,
  );
  await expect(page.getByTestId("events-period-to")).toHaveValue(PERIOD.to);
  await expect(chips(page)).toHaveCount(3);
  await expect(page.getByRole("columnheader", { name: TITLE })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
});

When("the operator picks a «по» day before the «с» day", async ({ page }) => {
  await page.getByTestId("events-period-to").fill(INVERTED_TO);
});

Then(
  "the «по» day is refused in place and is not applied",
  async ({ page, world }) => {
    // The DS FormError leads with its warning glyph.
    await expect(page.getByTestId("events-period-inverted")).toHaveText(
      /Дата «по» раньше даты «с»$/,
    );
    const to = page.getByTestId("events-period-to");
    await expect(to).toHaveValue(INVERTED_TO);
    await expect(to).toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => query(page)).toEqual([
      ["q", journey(world).marker],
      ["state", "published"],
      ["startsFrom", PERIOD.from],
      ["sort", "title"],
      ["dir", "asc"],
    ]);
    await expectRows(page, world, ["htn", "dm"]);
  },
);

When(
  "the operator resets every filter with «Сбросить всё»",
  async ({ page }) => {
    await filters(page).getByRole("button", { name: "Сбросить всё" }).click();
  },
);

Then(
  "no filter chip remains and the list keeps only its sort",
  async ({ page }) => {
    await expect.poll(() => query(page)).toEqual([
      ["sort", "title"],
      ["dir", "asc"],
    ]);
    await expect(chips(page)).toHaveCount(0);
    await expect(filters(page).getByRole("searchbox")).toHaveValue("");
    await expect(filters(page).getByTestId("events-status")).toHaveValue("");
    await expect(page.getByTestId("events-period-from")).toHaveValue("");
    await expect(page.getByTestId("events-period-to")).toHaveValue("");
    await expect(page.getByTestId("events-period-inverted")).toHaveCount(0);
    await expect(
      page.getByRole("columnheader", { name: TITLE }),
    ).toHaveAttribute("aria-sort", "ascending");
  },
);
