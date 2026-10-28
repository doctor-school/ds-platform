import { golden } from "@ds/db/seed/golden";
import { expect, type APIRequestContext } from "@playwright/test";

import { reachFeedCard } from "../lib/feed-card.js";
import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

type PublicRow = Record<string, unknown>;
const UPCOMING_TITLE = "Предстоящий эфир (эталон)";
const DRAFT_TITLE = "Черновик эфира (эталон)";
const HIDDEN_TITLE = "Скрытый эфир (эталон)";
const UNKNOWN_SLUG = "public-visibility-3391-does-not-exist";
const DAY_MS = 86_400_000;

function fixtureState(world: StepWorld) {
  if (!world.publicVisibility)
    throw new Error("004 visibility fixtures not read");
  return world.publicVisibility;
}

function moscowMonth(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(instant));
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

async function publicRead(
  request: APIRequestContext,
  path: string,
): Promise<unknown> {
  const response = await request.get(path);
  expect(response.status(), "publish-safe public read succeeds").toBe(200);
  return response.json();
}

function row(value: unknown): PublicRow {
  expect(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "public object shape",
  ).toBe(true);
  return value as PublicRow;
}

function rows(value: unknown): PublicRow[] {
  expect(Array.isArray(value), "public read returns an array").toBe(true);
  return (value as unknown[]).map(row);
}

function exactKeys(
  value: unknown,
  required: string[],
  optional: string[] = [],
) {
  const keys = Object.keys(row(value)).sort();
  expect(
    keys.filter((key) => !optional.includes(key)),
    "independent public field allowlist",
  ).toEqual([...required].sort());
}

function expectExcluded(entries: PublicRow[]) {
  expect(
    entries.some(
      (entry) =>
        entry.id === golden.events.draft.id ||
        entry.slug === golden.events.draft.slug,
    ),
    "known draft is absent",
  ).toBe(false);
  expect(
    entries.some(
      (entry) =>
        entry.id === golden.events.hidden.id ||
        entry.slug === golden.events.hidden.slug,
    ),
    "known hidden event is absent",
  ).toBe(false);
}

Given(
  "the golden public-visibility fixtures are available",
  async ({ request, world, page }) => {
    await page.context().clearCookies();
    const upcoming = row(
      await publicRead(
        request,
        `/v1/public/events/${golden.events.upcoming.slug}`,
      ),
    );
    const hidden = row(
      await publicRead(
        request,
        `/v1/public/events/${golden.events.hidden.slug}`,
      ),
    );
    expect(upcoming).toMatchObject({
      ...golden.events.upcoming,
      state: "published",
      title: UPCOMING_TITLE,
    });
    expect(hidden).toMatchObject({
      ...golden.events.hidden,
      state: "hidden",
      title: HIDDEN_TITLE,
    });
    expect(typeof upcoming.startsAt).toBe("string");
    expect(typeof hidden.startsAt).toBe("string");
    expect(Date.parse(String(upcoming.startsAt))).toBeGreaterThan(Date.now());
    // Golden dataset.ts pins upcoming at +14d and the draft at +30d.
    // The lead verifies the actual draft row on the exact slot before acceptance.
    const draftStartsAt = new Date(
      Date.parse(String(upcoming.startsAt)) + 16 * DAY_MS,
    ).toISOString();
    world.publicVisibility = {
      upcoming,
      hidden,
      draftStartsAt,
      months: [
        ...new Set(
          [
            String(upcoming.startsAt),
            String(hidden.startsAt),
            draftStartsAt,
          ].map(moscowMonth),
        ),
      ],
    };
  },
);

When(
  "the visitor requests the draft and an unknown public event URL",
  async ({ request, page, host }) => {
    const draft = await request.get(
      `/v1/public/events/${golden.events.draft.slug}`,
    );
    const unknown = await request.get(`/v1/public/events/${UNKNOWN_SLUG}`);
    expect(draft.status()).toBe(404);
    expect(unknown.status()).toBe(404);
    expect(
      await draft.json(),
      "draft has the same not-found public body",
    ).toEqual(await unknown.json());
    const notFoundText: string[] = [];
    let documentStatus: number | undefined;
    for (const slug of [golden.events.draft.slug, UNKNOWN_SLUG]) {
      const path = `${host.eventsPath}/${slug}`;
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      const status = response?.status();
      expect([200, 404], "streamed or unstreamed not-found document").toContain(
        status,
      );
      if (documentStatus === undefined) documentStatus = status;
      else
        expect(status, "draft and unknown document status match").toBe(
          documentStatus,
        );
      expect(
        response?.request().redirectedFrom(),
        "not-found stays in place",
      ).toBeNull();
      await expect(page).toHaveURL((url) => url.pathname === path);
      await expect(
        page.getByRole("heading", { name: "404", exact: true }),
      ).toBeVisible();
      await expect(page.locator("body")).not.toContainText(DRAFT_TITLE);
      await expect(
        page.locator('meta[name="robots"][content*="noindex"]').first(),
      ).toHaveAttribute("content", /noindex/u);
      notFoundText.push(
        await page
          .getByRole("heading", { name: "404", exact: true })
          .locator("..")
          .innerText(),
      );
    }
    expect(notFoundText[0]).toMatch(/\S/u);
    expect(notFoundText[0]).toBe(notFoundText[1]);
  },
);

Then(
  "both event pages render the same not-found response without draft content",
  async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "404", exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(DRAFT_TITLE);
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]').first(),
    ).toHaveAttribute("content", /noindex/u);
  },
);

Then(
  "the draft is absent from the public upcoming listing",
  async ({ request, page, host }) => {
    const entries = rows(await publicRead(request, "/v1/public/events"));
    expect(entries).toContainEqual(
      expect.objectContaining({
        ...golden.events.upcoming,
        state: "published",
        title: UPCOMING_TITLE,
      }),
    );
    expectExcluded(entries);
    const response = await page.goto(host.eventsPath, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Расписание эфиров",
        exact: true,
      }),
    ).toBeVisible();
    const positive = page
      .getByRole("link", { name: UPCOMING_TITLE, exact: true })
      .and(
        page.locator(
          `a[href="${host.eventsPath}/${golden.events.upcoming.slug}"]`,
        ),
      );
    await expect(await reachFeedCard(page, positive)).toBeVisible();
    await expect(
      page.locator(`a[href="${host.eventsPath}/${golden.events.draft.slug}"]`),
    ).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(DRAFT_TITLE);
  },
);

When(
  "the visitor reads the golden fixtures' calendar months",
  async ({ request, world }) => {
    const state = fixtureState(world);
    state.projections = [];
    for (const month of state.months) {
      state.projections.push(
        rows(await publicRead(request, `/v1/public/events?month=${month}`)),
      );
    }
  },
);

Then(
  "those month projections contain only publicly listed lifecycle states",
  async ({ world }) => {
    const state = fixtureState(world);
    expect(state.projections?.flat()).toContainEqual(
      expect.objectContaining({
        ...golden.events.upcoming,
        state: "published",
        title: UPCOMING_TITLE,
      }),
    );
    for (const [index, entries] of state.projections!.entries()) {
      expectExcluded(entries);
      for (const entry of entries) {
        expect(["published", "live", "ended", "in_archive"]).toContain(
          entry.state,
        );
        expect(moscowMonth(String(entry.startsAt))).toBe(state.months[index]);
      }
    }
  },
);

Then(
  "their counts equal the visible month entries without drafts or hidden events",
  async ({ request, world }) => {
    const state = fixtureState(world);
    for (const [index, month] of state.months.entries()) {
      const counts = rows(
        await publicRead(
          request,
          `/v1/public/events/month-counts?year=${month.slice(0, 4)}`,
        ),
      );
      expect(counts).toHaveLength(12);
      expect(counts.map((item) => item.month)).toEqual(
        Array.from({ length: 12 }, (_, i) => i + 1),
      );
      for (const item of counts) exactKeys(item, ["month", "count"]);
      const count = counts.find(
        (item) => item.month === Number(month.slice(5)),
      )!;
      expect(
        count.count,
        "picker count equals the complete publish-visible month projection",
      ).toBe(state.projections![index]!.length);
    }
  },
);

Then(
  "the rendered month grids show the published control without the draft or hidden event",
  async ({ page, host, world }) => {
    const state = fixtureState(world);
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const month of state.months) {
      const response = await page.goto(
        `${host.eventsPath}?view=month&month=${month}`,
        { waitUntil: "domcontentloaded" },
      );
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get("view") === "month" &&
          url.searchParams.get("month") === month,
      );
      const grid = page.getByTestId("month-grid-desktop");
      await expect(grid).toBeVisible();
      if (month === moscowMonth(String(state.upcoming.startsAt))) {
        const positive = grid.locator(
          `a[href="${host.eventsPath}/${golden.events.upcoming.slug}"]`,
        );
        await expect(positive).toBeVisible();
        await expect(positive).toContainText(UPCOMING_TITLE);
      }
      for (const fixture of [golden.events.draft, golden.events.hidden]) {
        await expect(
          grid.locator(`a[href="${host.eventsPath}/${fixture.slug}"]`),
        ).toHaveCount(0);
      }
      await expect(grid).not.toContainText(DRAFT_TITLE);
      await expect(grid).not.toContainText(HIDDEN_TITLE);
    }
  },
);

When(
  "the visitor reads the public event, upcoming and month projections",
  async ({ request, page, host, world }) => {
    const state = fixtureState(world);
    state.upcomingCards = rows(await publicRead(request, "/v1/public/events"));
    state.projections = [];
    for (const month of state.months)
      state.projections.push(
        rows(await publicRead(request, `/v1/public/events?month=${month}`)),
      );
    const response = await page.goto(
      `${host.eventsPath}/${golden.events.upcoming.slug}`,
      { waitUntil: "domcontentloaded" },
    );
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: UPCOMING_TITLE,
        exact: true,
      }),
    ).toBeVisible();
  },
);

Then(
  "the draft has no public body and the hidden event is never listed as active",
  async ({ request, world }) => {
    expect(
      (
        await request.get(`/v1/public/events/${golden.events.draft.slug}`)
      ).status(),
    ).toBe(404);
    const state = fixtureState(world);
    expect(state.hidden).toMatchObject({
      ...golden.events.hidden,
      state: "hidden",
    });
    expect(state.upcomingCards).toContainEqual(
      expect.objectContaining({
        ...golden.events.upcoming,
        state: "published",
        title: UPCOMING_TITLE,
      }),
    );
    expectExcluded(state.upcomingCards!);
    for (const entries of state.projections!) expectExcluded(entries);
  },
);

function expectPageAllowlist(event: PublicRow) {
  exactKeys(
    event,
    [
      "id",
      "slug",
      "title",
      "school",
      "startsAt",
      "durationMin",
      "nmo",
      "pulCost",
      "description",
      "speakers",
      "specialties",
      "partners",
      "state",
      "recording",
      "format",
      "seatsLeft",
      "signUps",
      "viewers",
      "links",
    ],
    ["programPdfUrl"],
  );
  expect(Array.isArray(event.specialties)).toBe(true);
  for (const speaker of rows(event.speakers))
    exactKeys(speaker, [
      "source",
      "expertId",
      "expertSlug",
      "name",
      "credentials",
      "photoUrl",
      "role",
    ]);
  for (const partner of rows(event.partners)) exactKeys(partner, ["label"]);
  exactKeys(event.recording, [
    "state",
    "primaryKind",
    "secondaryKind",
    "posterUrl",
    "expectedBy",
    "durationSec",
  ]);
  expect(["preparing", "montage", "raw-only"]).toContain(
    row(event.recording).state,
  );
  exactKeys(event.links, ["speakerPages"], ["school", "communityHref"]);
  const links = row(event.links);
  for (const speaker of rows(links.speakerPages))
    exactKeys(speaker, ["speakerKey", "href"]);
  if (links.school !== undefined) exactKeys(links.school, ["label", "href"]);
  if (event.signUps !== null)
    exactKeys(event.signUps, ["total", "sameSpecialty", "adjacentSpecialties"]);
}

Then(
  "the projections contain only publish-safe fields and source-free recording facts",
  async ({ world }) => {
    const state = fixtureState(world);
    expectPageAllowlist(state.upcoming);
    expectPageAllowlist(state.hidden);
    expect(
      rows(state.upcoming.speakers).length,
      "positive nested expert control",
    ).toBeGreaterThan(0);
    for (const card of state.upcomingCards!) {
      exactKeys(card, [
        "id",
        "slug",
        "title",
        "school",
        "startsAt",
        "specialties",
        "speakers",
        "state",
        "kind",
        "format",
        "signUpCount",
      ]);
      expect(["published", "live"]).toContain(card.state);
      exactKeys(card.kind, ["id", "slug", "title"]);
      for (const speaker of rows(card.speakers)) exactKeys(speaker, ["name"]);
    }
    for (const entry of state.projections!.flat()) {
      exactKeys(entry, [
        "id",
        "slug",
        "title",
        "school",
        "startsAt",
        "state",
        "participationFormat",
      ]);
      expect(["published", "live", "ended", "in_archive"]).toContain(
        entry.state,
      );
    }
  },
);
