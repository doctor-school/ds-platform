import { expect, type Locator, type Page } from "@playwright/test";
import { golden } from "@ds/db/seed/golden";

import {
  ADMIN_ORIGIN,
  createPublishedEvent,
  createPublishedEventKind,
  retireEventFromStorefronts,
  retireEventKind,
  signInAsAdmin,
} from "../admin/index.js";
import { baseUrlFor, hostById, type HostConfig } from "../hosts.js";
import {
  After,
  Before,
  Given,
  Then,
  When,
  type EditorWrites,
  type EventsFeedWorld,
  type StepWorld,
} from "./support/fixtures.js";

/**
 * 019 — the doctor events feed (`/events`) on the golden slot (Issue #2256,
 * #1530). The scenarios live in `019-scenarios.feature` → «The doctor events
 * journeys on the golden dataset». Every count, date and title the feed shows is
 * read from the slot; the only named facts are the golden live doctors'
 * broadcast and the Academy-audience golden upcoming broadcast (EARS-16).
 */
const LIVE = {
  slug: golden.events.live.slug,
  title: "Идущий сейчас эфир (эталон)",
};
const EXPERTS_UPCOMING = {
  slug: golden.events.upcoming.slug,
  title: "Предстоящий эфир (эталон)",
};
const FORMAT_IDS: Readonly<Record<string, string>> = {
  Онлайн: "online",
  Офлайн: "offline",
  Гибрид: "hybrid",
};
const DAY_WITH_EVENTS = /, \d+ событи[йея]$/u;
/** The facet parameters of the doctor set (019 LD-1). */
const FACET_PARAMS = ["format", "kind", "city", "specialty", "q", "nmo"];

function feedOf(world: StepWorld): EventsFeedWorld {
  world.eventsFeed ??= { history: [] };
  return world.eventsFeed;
}

function pathAndQuery(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

function params(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

/** Server-rendered links are live before their client handlers (#2253). */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
}

async function openFeed(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await settle(page);
  await expect(page.getByTestId("events-feed")).toBeVisible();
}

function filterPanel(page: Page): Locator {
  return page.getByTestId("events-column").getByRole("region", {
    name: "Фильтры",
  });
}

function feedCards(page: Page): Locator {
  return page.getByTestId("events-feed").locator("[data-webinar-card]");
}

function liveStrip(page: Page): Locator {
  return page
    .getByTestId("events-live-block")
    .getByTestId("live-event-strip")
    .filter({
      has: page.locator(`a[href="/events/${LIVE.slug}"]`, {
        hasText: LIVE.title,
      }),
    });
}

/** Activate «Показать ещё» and wait until the wider reading has rendered. */
async function showMore(page: Page, world: StepWorld): Promise<string> {
  const more = page.getByTestId("events-feed-show-more");
  await expect(more).toBeVisible();
  const href = await more.getAttribute("href");
  expect(href, "«Показать ещё» carries the wider extent").toBeTruthy();
  feedOf(world).history.push(pathAndQuery(page));
  await more.click();
  await page.waitForURL((url) => `${url.pathname}${url.search}` === href);
  await expect(page.getByTestId("events-feed")).toBeVisible();
  return href!;
}

async function expectFacetsApplied(
  page: Page,
  tense: "past" | null,
  formats: string[],
): Promise<void> {
  const query = params(page);
  expect(query.get("tense")).toBe(tense);
  expect(query.getAll("format").sort()).toEqual(
    formats.map((label) => FORMAT_IDS[label]).sort(),
  );
  await expect(filterPanel(page)).toContainText(`Применено: ${formats.length}`);
}

async function expectNoProjectOrCommerce(page: Page): Promise<void> {
  const text = await page.locator("main").innerText();
  expect(text, "«проект» in a doctor-facing string").not.toMatch(/проект/iu);
  // Same pattern as apps/doctor/e2e/events-purity.spec.ts ("rouble price"); a
  // copy because packages/e2e must not import from an app. No `\b`: it is an
  // ASCII word boundary and never matches before a Cyrillic letter.
  expect(text, "a price in roubles").not.toMatch(
    /₽|руб(\.|л|ей|ля)|(^|[^a-z])rub([^a-z]|$)/i,
  );
  expect(text, "a cart, subscription or payment affordance").not.toMatch(
    /корзин|подписк|оплат|купить/iu,
  );
}

async function expectLanding(
  page: Page,
  path: string,
  title: string,
): Promise<void> {
  await page.waitForURL((url) => url.pathname === path);
  await expect(
    page.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
}

function eventPathOf(host: HostConfig, slug: string): string {
  return `${host.eventsPath}/${slug}`;
}

// ── Arrangement ─────────────────────────────────────────────────────────────

Given("a visitor with no account", async ({ context }) => {
  await context.clearCookies();
  expect(await context.cookies()).toHaveLength(0);
});

Given("the viewport is {int} wide", async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 900 });
});

When("the {word} opens «События»", async ({ page, host }, _actor: string) => {
  await openFeed(page, host.eventsPath);
});

When(
  "the {word} opens «События» on «Прошедшие» with the format «Онлайн» applied",
  async ({ page, host }, _actor: string) => {
    await openFeed(page, `${host.eventsPath}?tense=past&format=online`);
  },
);

When(
  "the {word} opens «События» with the formats «Онлайн» and «Гибрид» applied",
  async ({ page, host }, _actor: string) => {
    await openFeed(page, `${host.eventsPath}?format=online&format=hybrid`);
  },
);

// ── EARS-1 / EARS-3: the head, the block order, the day groups ───────────────

Then(
  "the page head reads «События» with the tense tabs «Прошедшие | Будущие» and «Будущие» selected",
  async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "События", exact: true }),
    ).toHaveCount(1);
    const tabs = page.getByTestId("events-tense-tabs");
    await expect(tabs.getByRole("tab")).toHaveText(["Прошедшие", "Будущие"]);
    await expect(
      tabs.getByRole("tab", { name: "Будущие", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      params(page).has("tense"),
      "the default tense states no `tense`",
    ).toBe(false);
  },
);

Then(
  "the blocks read in the order: the head, «Идёт сейчас», the day feed",
  async ({ page }) => {
    const order = await page
      .locator("[data-feed-block]")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.feedBlock),
      );
    expect(order).toEqual(["head", "live", "feed"]);
  },
);

Then(
  "the events are grouped under their day headings, nearest first",
  async ({ page }) => {
    const groups = page
      .getByTestId("events-feed")
      .locator('section[id^="day-"]');
    await expect(groups.first()).toBeVisible();
    const ids = await groups.evaluateAll((nodes) =>
      nodes.map((node) => node.id),
    );
    for (const id of ids) expect(id).toMatch(/^day-\d{4}-\d{2}-\d{2}$/);
    expect(ids, "day groups nearest first, one per day").toEqual(
      [...new Set(ids)].sort(),
    );
    for (const id of ids) {
      await expect(
        page.locator(`section[id="${id}"] [data-webinar-card]`).first(),
      ).toBeVisible();
    }
  },
);

When(
  "the {word} activates «Показать ещё»",
  async ({ page, world }, _actor: string) => {
    const days = await page.locator('section[id^="day-"]').count();
    feedOf(world).horizonBefore = { to: params(page).get("to"), days };
    await showMore(page, world);
  },
);

Then(
  "the feed extends its horizon and the new range is visible in the URL",
  async ({ page, world }) => {
    const before = feedOf(world).horizonBefore;
    if (!before) throw new Error("«Показать ещё» was not activated before");
    const to = params(page).get("to");
    expect(to, "the wider horizon is URL state").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (before.to) expect(to! > before.to).toBe(true);
    expect(await page.locator('section[id^="day-"]').count()).toBeGreaterThan(
      before.days,
    );
  },
);

// ── EARS-12 / EARS-11: the guest reading ────────────────────────────────────

Then(
  "the day feed, the compact month and the facet panel are readable",
  async ({ page }) => {
    await expect(page.getByTestId("events-feed")).toBeVisible();
    await expect(feedCards(page).first()).toBeVisible();
    await expect(page.getByTestId("events-compact-month")).toBeVisible();
    await expect(filterPanel(page)).toBeVisible();
    await expect(
      filterPanel(page).getByRole("group", { name: "Формат" }),
    ).toBeVisible();
  },
);

Then(
  "no band under the feed states that an account is needed",
  async ({ page }) => {
    await expect(page.getByTestId("events-guest-gate")).toHaveCount(0);
    await expect(page.getByText(/нужна регистрация/iu)).toHaveCount(0);
  },
);

Then("no «Мои события» block exists in the DOM", async ({ page }) => {
  await expect(page.getByTestId("events-my-events")).toHaveCount(0);
  await expect(page.locator('[data-feed-block="my-events"]')).toHaveCount(0);
});

Then(
  "an upcoming card is one link to its event page with no action of its own",
  async ({ page, host, world }) => {
    await expect(
      page.getByTestId("events-feed").getByText("Участвовать"),
    ).toHaveCount(0);
    await expect(page.locator('a[href^="/register"]')).toHaveCount(0);
    await expect(page.getByTestId("events-my-events-skeleton")).toHaveCount(0);
    // A live card keeps its strip action (019 «Amendment — 2026-10-06»).
    const cards = feedCards(page).filter({ hasNotText: "В эфире" });
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const links = card.getByRole("link");
      await expect(links).toHaveCount(1);
      await expect(card.getByRole("button")).toHaveCount(0);
      const href = await links.getAttribute("href");
      expect(href).toMatch(new RegExp(`^${host.eventsPath}/[^/?#]+$`));
      await expect(links, "the card link is labelled").toHaveAccessibleName(
        /\S/u,
      );
      const title = (await links.innerText()).trim();
      expect(title.length, "the card link has a title").toBeGreaterThan(0);
      feedOf(world).card ??= { title, href: href! };
    }
  },
);

When(
  "the {word} opens that upcoming card",
  async ({ page, world }, _actor: string) => {
    const card = feedOf(world).card;
    if (!card) throw new Error("No upcoming card was read before");
    await page
      .getByTestId("events-feed")
      .locator(`a[href="${card.href}"]`)
      .first()
      .click();
  },
);

Then(
  "the {word} lands on that event's page showing its title",
  async ({ page, world }, _actor: string) => {
    const card = feedOf(world).card;
    if (!card) throw new Error("No card was read before");
    await expectLanding(page, card.href, card.title);
  },
);

// ── EARS-6: the live block ──────────────────────────────────────────────────

Then(
  "the «Идёт сейчас» block above the feed carries the golden doctors' broadcast with its live marker and title",
  async ({ page }) => {
    const block = page.getByTestId("events-live-block");
    await expect(block).toBeVisible();
    await expect(block.getByRole("status")).toHaveText("Идёт сейчас");
    await expect(liveStrip(page)).toHaveCount(1);
    await expect(
      liveStrip(page).getByTestId("live-event-strip-title"),
    ).toHaveText(LIVE.title);
    const feed = page.getByTestId("events-feed");
    expect(
      await block.evaluate(
        (node, feedNode) =>
          Boolean(
            node.compareDocumentPosition(feedNode!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        await feed.elementHandle(),
      ),
      "the block sits above the feed",
    ).toBe(true);
  },
);

Then("the live block offers no route into a room", async ({ page, host }) => {
  const block = page.getByTestId("events-live-block");
  await expect(block.locator('a[href$="/room"]')).toHaveCount(0);
  await expect(
    liveStrip(page).getByTestId("live-event-strip-action"),
  ).toHaveAttribute("href", eventPathOf(host, LIVE.slug));
});

When(
  "the {word} follows the live block's action on that broadcast",
  async ({ page }, _actor: string) => {
    await liveStrip(page).getByTestId("live-event-strip-action").click();
  },
);

Then(
  "the doctor lands in the room of the golden doctors' broadcast",
  async ({ page, host }) => {
    const room = `${eventPathOf(host, LIVE.slug)}/room`;
    await page.waitForURL((url) => url.pathname === room);
    // The room names the broadcast and its exit leads back to
    // the event page — the room of THIS broadcast, not a fallback page.
    await expect(page.getByRole("main")).toContainText(LIVE.title);
    await expect(
      page.getByRole("link", { name: "Выйти из комнаты", exact: true }),
    ).toHaveAttribute("href", eventPathOf(host, LIVE.slug));
  },
);

Then(
  "the visitor lands on the event page of the golden doctors' broadcast",
  async ({ page, host }) => {
    await expectLanding(page, eventPathOf(host, LIVE.slug), LIVE.title);
  },
);

// ── EARS-4 / EARS-8: the compact month ──────────────────────────────────────

Then(
  "the compact month stands in the side column above the facet panel, beside the day feed",
  async ({ page }) => {
    const column = page.getByTestId("events-column");
    const compact = column.getByTestId("events-compact-month");
    await expect(compact).toBeVisible();
    await expect(filterPanel(page)).toBeVisible();
    const compactBox = (await compact.boundingBox())!;
    const panelBox = (await filterPanel(page).boundingBox())!;
    const feedBox = (await page.getByTestId("events-feed").boundingBox())!;
    expect(compactBox.y, "the compact month above the facets").toBeLessThan(
      panelBox.y,
    );
    expect(feedBox.x, "the feed beside the column").toBeGreaterThan(
      compactBox.x + compactBox.width - 1,
    );
  },
);

When(
  "the {word} picks a day carrying events in the compact month",
  async ({ page, world }, _actor: string) => {
    const compact = page.getByTestId("events-compact-month");
    const days = compact.getByRole("button", { name: DAY_WITH_EVENTS });
    // Late in a month the remaining event days may all lie in the next one.
    for (let paged = 0; (await days.count()) === 0 && paged < 2; paged += 1) {
      const month = await compact.getAttribute("data-month");
      await compact.getByTestId("events-compact-month-next").click();
      await expect(compact).not.toHaveAttribute("data-month", month!);
    }
    expect(await days.count(), "a day carrying events").toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as unknown as { __shellSentinel?: string }).__shellSentinel =
        "kept";
    });
    feedOf(world).history.push(pathAndQuery(page));
    feedOf(world).groupsBeforeDay = await page
      .locator('section[id^="day-"]')
      .count();
    feedOf(world).scrollBeforeDay = await page.evaluate(() => window.scrollY);
    feedOf(world).groupTopsBeforeDay = await page
      .locator('section[id^="day-"]')
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => [node.id, node.getBoundingClientRect().top]),
        ),
      );
    const picked = days.last();
    const label = (await picked.getAttribute("aria-label")) ?? "";
    await picked.click();
    await page.waitForURL((url) => url.searchParams.has("day"));
    feedOf(world).pickedDay = params(page).get("day")!;
    feedOf(world).pickedLabel = label;
  },
);

Then(
  "the URL names that day and the feed body moves to that day without reloading the shell",
  async ({ page, world }) => {
    const day = feedOf(world).pickedDay;
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const group = page.locator(`section[id="day-${day}"]`);
    await expect(group).toBeInViewport();
    // The feed body actually moved: the picked group rose, or (a group that
    // was not rendered before) the page scrolled down to it.
    const topBefore = feedOf(world).groupTopsBeforeDay?.[`day-${day}`];
    if (topBefore === undefined) {
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(feedOf(world).scrollBeforeDay ?? 0);
    } else {
      await expect
        .poll(async () => (await group.boundingBox())?.y ?? topBefore)
        .toBeLessThan(topBefore);
    }
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __shellSentinel?: string }).__shellSentinel,
      ),
      "the shell was not reloaded",
    ).toBe("kept");
    const compact = page.getByTestId("events-compact-month");
    await expect(compact).toHaveAttribute(
      "data-selected-day",
      String(Number(day!.slice(8))),
    );
    const label = feedOf(world).pickedLabel;
    if (label) {
      await expect(
        compact.getByRole("button", { name: label, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    // The pick moves the feed; it never narrows the read to that day.
    expect(
      await page.locator('section[id^="day-"]').count(),
      "the day groups around the picked day stay",
    ).toBeGreaterThanOrEqual(feedOf(world).groupsBeforeDay ?? 1);
  },
);

// ── EARS-5: the month view of the same page ─────────────────────────────────

When(
  "the {word} follows «Календарь на месяц →»",
  async ({ page, world }, _actor: string) => {
    feedOf(world).history.push(pathAndQuery(page));
    await page
      .getByRole("link", { name: "Календарь на месяц →", exact: true })
      .filter({ visible: true })
      .click();
    await page.waitForURL((url) => url.searchParams.get("view") === "month");
  },
);

When(
  "the {word} follows «← Лента событий»",
  async ({ page, world }, _actor: string) => {
    feedOf(world).history.push(pathAndQuery(page));
    await page
      .getByRole("link", { name: "← Лента событий", exact: true })
      .filter({ visible: true })
      .click();
    await page.waitForURL((url) => url.searchParams.get("view") !== "month");
  },
);

Then(
  "the month grid renders on the same route with the facet panel beside it",
  async ({ page, host }) => {
    expect(new URL(page.url()).pathname).toBe(host.eventsPath);
    await expect(page.getByTestId("events-month-view")).toBeVisible();
    await expect(page.getByTestId("month-grid-desktop")).toBeVisible();
    await expect(filterPanel(page)).toBeVisible();
    await expect(
      page.getByTestId("events-column").getByTestId("events-compact-month"),
    ).toHaveCount(0);
  },
);

Then("the day feed renders on the same route", async ({ page, host }) => {
  expect(new URL(page.url()).pathname).toBe(host.eventsPath);
  await expect(page.getByTestId("events-feed")).toBeVisible();
  await expect(page.getByTestId("month-grid-desktop")).toHaveCount(0);
});

Then(
  "the tense «Прошедшие» and the format «Онлайн» are still applied",
  async ({ page }) => {
    await expectFacetsApplied(page, "past", ["Онлайн"]);
  },
);

// ── EARS-7: the facet panel ─────────────────────────────────────────────────

When(
  "the {word} applies the format «Онлайн» in the facet panel",
  async ({ page, world }, _actor: string) => {
    feedOf(world).history.push(pathAndQuery(page));
    await filterPanel(page)
      .getByRole("group", { name: "Формат" })
      .getByRole("button", { name: "Онлайн", exact: true })
      .click();
    await page.waitForURL((url) =>
      url.searchParams.getAll("format").includes("online"),
    );
    await expect(page.getByTestId("events-feed")).toBeVisible();
  },
);

Then(
  "the panel states «Применено: 1» with «Сбросить» and the format «Онлайн» selected",
  async ({ page }) => {
    await expectFacetsApplied(page, null, ["Онлайн"]);
    await expect(
      filterPanel(page).getByRole("link", { name: "Сбросить", exact: true }),
    ).toBeVisible();
    await expect(
      filterPanel(page)
        .getByRole("group", { name: "Формат" })
        .getByRole("button", { name: "Онлайн", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  },
);

Then("every card in the feed reads the format «Онлайн»", async ({ page }) => {
  const cards = feedCards(page);
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    await expect(cards.nth(index)).toContainText("Онлайн");
  }
  for (const other of ["Офлайн", "Гибрид"]) {
    await expect(cards.filter({ hasText: other })).toHaveCount(0);
  }
});

When("the {word} resets the facets", async ({ page }, _actor: string) => {
  await filterPanel(page)
    .getByRole("link", { name: "Сбросить", exact: true })
    .click();
  await page.waitForURL((url) => !url.searchParams.has("format"));
});

Then("no facet is applied and the URL carries none", async ({ page }) => {
  const query = params(page);
  for (const name of FACET_PARAMS) expect(query.has(name), name).toBe(false);
  await expect(filterPanel(page)).not.toContainText("Применено");
  await expect(feedCards(page).first()).toBeVisible();
});

// ── EARS-8: the URL is the state ────────────────────────────────────────────

When(
  "the {word} opens the same URL in a fresh browser context",
  async (
    { page, browser, baseURL, httpCredentials, locale, world },
    _actor: string,
  ) => {
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      ...(httpCredentials ? { httpCredentials } : {}),
      ...(locale ? { locale } : {}),
      viewport: page.viewportSize(),
    });
    const fresh = await context.newPage();
    await openFeed(fresh, pathAndQuery(page));
    feedOf(world).freshPage = fresh;
  },
);

Then(
  "the same facets, the same selected day and the same horizon are rendered",
  async ({ page, world }) => {
    const fresh = feedOf(world).freshPage;
    if (!fresh) throw new Error("No fresh browser context was opened");
    try {
      expect(pathAndQuery(fresh)).toBe(pathAndQuery(page));
      await expectFacetsApplied(fresh, null, ["Онлайн"]);
      await expect(fresh.getByTestId("events-compact-month")).toHaveAttribute(
        "data-selected-day",
        String(Number(feedOf(world).pickedDay!.slice(8))),
      );
      const groupsOf = (target: Page) =>
        target
          .locator('section[id^="day-"]')
          .evaluateAll((nodes) => nodes.map((node) => node.id));
      expect(await groupsOf(fresh)).toEqual(await groupsOf(page));
      const cardsOf = (target: Page) =>
        feedCards(target)
          .locator("h3 a")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("href")),
          );
      expect(await cardsOf(fresh)).toEqual(await cardsOf(page));
      const tenseOf = (target: Page) =>
        target
          .getByTestId("events-tense-tabs")
          .getByRole("tab", { selected: true })
          .textContent();
      expect(await tenseOf(fresh)).toBe(await tenseOf(page));
      const moreOf = (target: Page) =>
        target
          .getByTestId("events-feed-show-more")
          .getAttribute("href", {
            timeout: 1_000,
          })
          .catch(() => null);
      expect(await moreOf(fresh)).toBe(await moreOf(page));
    } finally {
      await fresh.context().close();
      delete feedOf(world).freshPage;
    }
  },
);

When(
  "the {word} presses the browser back button",
  async ({ page }, _actor: string) => {
    await page.goBack();
  },
);

Then(
  "the previous feed state is rendered rather than the {word} leaving the feed",
  async ({ page, world }, _actor: string) => {
    const previous = feedOf(world).history.at(-1);
    if (!previous) throw new Error("The journey left no previous feed state");
    await page.waitForURL((url) => `${url.pathname}${url.search}` === previous);
    await expect(page.getByTestId("events-feed")).toBeVisible();
    await expectFacetsApplied(page, null, ["Онлайн"]);
  },
);

// ── EARS-10 / EARS-2: «Прошедшие» ───────────────────────────────────────────

When(
  "the {word} switches the tense to «Прошедшие»",
  async ({ page, world }, _actor: string) => {
    feedOf(world).history.push(pathAndQuery(page));
    await page
      .getByTestId("events-tense-tabs")
      .getByRole("tab", { name: "Прошедшие", exact: true })
      .click();
    await page.waitForURL((url) => url.searchParams.get("tense") === "past");
  },
);

Then(
  "the URL carries the past tense and the past events are grouped by month, newest first",
  async ({ page }) => {
    await expect(
      page
        .getByTestId("events-tense-tabs")
        .getByRole("tab", { name: "Прошедшие", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const groups = page
      .getByTestId("events-feed")
      .locator('section[id^="day-"]');
    await expect(groups.first()).toBeVisible();
    const ids = await groups.evaluateAll((nodes) =>
      nodes.map((node) => node.id),
    );
    for (const id of ids) expect(id).toMatch(/^day-\d{4}-\d{2}$/);
    expect(ids, "month groups newest first, one per month").toEqual(
      [...new Set(ids)].sort().reverse(),
    );
  },
);

Then(
  "no «Идёт сейчас» block, «Мои события» block or archive block renders in the tense",
  async ({ page }) => {
    await expect(page.getByTestId("events-live-block")).toHaveCount(0);
    await expect(page.getByTestId("events-my-events")).toHaveCount(0);
    await expect(page.getByText("Архив записей")).toHaveCount(0);
  },
);

Then("no past card shows the sign-up count of colleagues", async ({ page }) => {
  await expect(feedCards(page).first()).toBeVisible();
  await expect(
    feedCards(page).filter({ hasText: "Коллег записались" }),
  ).toHaveCount(0);
});

When(
  "the {word} activates «Показать ещё» on «Прошедшие»",
  async ({ page, world }, _actor: string) => {
    const more = page.getByTestId("events-feed-show-more");
    await expect(more).toHaveText(/^Показать ещё \d+ \(осталось \d+\)$/u);
    const step = Number(/\d+/u.exec((await more.innerText()).trim())![0]);
    const cards = await feedCards(page).count();
    // 019 «Amendment — 2026-10-12»: the screen holds the 10 most recent past
    // events, a day shared with older ones shown whole.
    expect(cards, "the default past screen").toBeGreaterThanOrEqual(10);
    feedOf(world).pastBefore = { cards, step, from: params(page).get("from") };
    await showMore(page, world);
  },
);

Then(
  "the next older past events are added and the extent in the URL reaches further back",
  async ({ page, world }) => {
    const before = feedOf(world).pastBefore;
    if (!before)
      throw new Error("«Показать ещё» was not activated on «Прошедшие»");
    const from = params(page).get("from");
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (before.from) expect(from! < before.from).toBe(true);
    // The first number of «Показать ещё K (осталось N)» is what the step adds.
    expect(await feedCards(page).count()).toBe(before.cards + before.step);
  },
);

When(
  "the {word} follows «Смотреть запись» on a past card",
  async ({ page, world }, _actor: string) => {
    const watch = feedCards(page).getByRole("link", {
      name: "Смотреть запись",
      exact: true,
    });
    for (let step = 0; (await watch.count()) === 0 && step < 10; step += 1) {
      await showMore(page, world);
    }
    const card = feedCards(page)
      .filter({
        has: page.getByRole("link", { name: "Смотреть запись", exact: true }),
      })
      .first();
    const link = card.getByRole("link", {
      name: "Смотреть запись",
      exact: true,
    });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    const title = (await card.locator("h3").first().innerText()).trim();
    feedOf(world).card = { title, href };
    await link.click();
  },
);

// ── EARS-11: «Мои события» ──────────────────────────────────────────────────

Then(
  "the «Мои события» cut lists at most three upcoming events and none of them live",
  async ({ page, host }) => {
    const block = page.getByTestId("events-my-events");
    await expect(block).toBeVisible();
    const rows = block.locator(`a[href^="${host.eventsPath}/"]`);
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(3);
    await expect(
      block.locator(`a[href="${eventPathOf(host, LIVE.slug)}"]`),
    ).toHaveCount(0);
  },
);

When(
  "the {word} follows «Все мои события →»",
  async ({ page }, _actor: string) => {
    await page
      .getByTestId("events-my-events")
      .getByRole("link", { name: "Все мои события →", exact: true })
      .click();
  },
);

// ── EARS-13: the 390 sheet ──────────────────────────────────────────────────

Then(
  "the facet panel is collapsed behind a «Фильтры» control showing the count {int}",
  async ({ page }, count: number) => {
    const open = page.getByTestId("events-filter-open");
    await expect(open).toBeVisible();
    await expect(open).toHaveText(`Фильтры (${count})`);
    await expect(page.getByTestId("events-column")).toBeHidden();
  },
);

When("the {word} opens that control", async ({ page }, _actor: string) => {
  await page.getByTestId("events-filter-open").click();
});

Then(
  "the panel opens as a sheet whose facets are operable, closing on «Показать N событий»",
  async ({ page }) => {
    const sheet = page.getByTestId("events-filter-sheet");
    await expect(sheet).toBeVisible();
    const hybrid = sheet
      .getByRole("group", { name: "Формат" })
      .getByRole("button", { name: "Гибрид", exact: true });
    await expect(hybrid).toHaveAttribute("aria-pressed", "true");
    await hybrid.click();
    await expect(hybrid).toHaveAttribute("aria-pressed", "false");
    const show = sheet.getByTestId("events-filter-show");
    await expect(show).toHaveText(/^Показать \d+ событи[йея]$/u);
    await show.click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("events-filter-open")).toHaveText(
      "Фильтры (1)",
    );
    expect(params(page).getAll("format")).toEqual(["online"]);
  },
);

// ── EARS-14: events and only events ─────────────────────────────────────────

Then(
  "the screen names no project and carries no price in roubles, cart, subscription or payment affordance",
  async ({ page }) => {
    await expectNoProjectOrCommerce(page);
  },
);

// ── EARS-16: the doctors audience only ──────────────────────────────────────

When(
  "the {word} widens the horizon until it reaches the golden upcoming broadcast's day",
  async ({ page, world }, _actor: string) => {
    if (!world.upcomingStartsAt)
      throw new Error("The golden upcoming broadcast was not read before");
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
    }).format(new Date(world.upcomingStartsAt));
    for (let step = 0; step < 20; step += 1) {
      const to = params(page).get("to");
      if (to && to >= day) return;
      await showMore(page, world);
    }
    throw new Error(`The feed horizon never reached ${day}`);
  },
);

Then(
  "the golden upcoming broadcast addressed to experts is not listed in the doctor feed",
  async ({ page, host }) => {
    await expect(feedCards(page).first()).toBeVisible();
    await expect(
      page.locator(`a[href="${eventPathOf(host, EXPERTS_UPCOMING.slug)}"]`),
    ).toHaveCount(0);
    await expect(
      page.getByText(EXPERTS_UPCOMING.title, { exact: true }),
    ).toHaveCount(0);
  },
);

// ── EARS-9: the empty and the failed reading ────────────────────────────────

/** The empty reading of the feed block (019 EARS-9, canvas `emptyOf`). */
function emptyFeed(page: Page): Locator {
  return page.getByTestId("events-feed-empty");
}

/** `Поиск: «…»` — the name-search facet as the empty state names it. */
function searchFacetLabel(query: string): string {
  return `Поиск: «${query}»`;
}

When(
  "the {word} opens «События» with the format «Онлайн» and a name search that no event matches",
  async ({ page, host, world }, _actor: string) => {
    // A token no event title carries; the screen says which facet emptied it.
    const query = `нет-такого-события-${Date.now().toString(36)}`;
    feedOf(world).noMatchQuery = query;
    const search = new URLSearchParams({ format: "online", q: query });
    await page.goto(`${host.eventsPath}?${search}`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page);
    await expect(emptyFeed(page)).toBeVisible();
  },
);

function noMatchQueryOf(world: StepWorld): string {
  const query = feedOf(world).noMatchQuery;
  if (!query) throw new Error("No name search was applied before");
  return query;
}

Then(
  "the feed states that no event matches the name-search facet and names that facet",
  async ({ page, world }) => {
    const label = searchFacetLabel(noMatchQueryOf(world));
    await expect(
      emptyFeed(page).getByText(`Нет событий по фильтру «${label}»`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("events-feed")).toHaveCount(0);
  },
);

Then(
  "it states how many events the feed holds without that facet and offers to remove exactly that facet beside «Сбросить фильтры»",
  async ({ page, world }) => {
    const label = searchFacetLabel(noMatchQueryOf(world));
    await expect(emptyFeed(page)).toContainText(
      /Без этого фильтра найдётся \d+ событи[йея]\./u,
    );
    const widen = emptyFeed(page).getByRole("link", {
      name: `Убрать фильтр «${label}»`,
      exact: true,
    });
    await expect(widen).toBeVisible();
    // Exactly that facet: the widening keeps the format and drops the search.
    const target = new URL(
      (await widen.getAttribute("href"))!,
      "http://feed.invalid",
    ).searchParams;
    expect(target.getAll("format")).toEqual(["online"]);
    expect(target.has("q")).toBe(false);
    await expect(
      emptyFeed(page).getByRole("link", {
        name: "Сбросить фильтры",
        exact: true,
      }),
    ).toBeVisible();
  },
);

Then(
  "the applied facets and the reset stay visible in the facet panel",
  async ({ page }) => {
    await expect(filterPanel(page)).toContainText(/Применено: \d+/u);
    await expect(
      filterPanel(page).getByRole("link", { name: "Сбросить", exact: true }),
    ).toBeVisible();
    await expect(
      filterPanel(page)
        .getByRole("group", { name: "Формат" })
        .getByRole("button", { name: "Онлайн", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  },
);

When(
  "the {word} removes that facet from the empty state",
  async ({ page, world }, _actor: string) => {
    const label = searchFacetLabel(noMatchQueryOf(world));
    await emptyFeed(page)
      .getByRole("link", { name: `Убрать фильтр «${label}»`, exact: true })
      .click();
    await page.waitForURL((url) => !url.searchParams.has("q"));
  },
);

Then(
  "the feed lists events again with the format «Онлайн» still applied and no name search in the URL",
  async ({ page }) => {
    await expect(feedCards(page).first()).toBeVisible();
    expect(params(page).getAll("format")).toEqual(["online"]);
    expect(params(page).has("q")).toBe(false);
    await expect(emptyFeed(page)).toHaveCount(0);
  },
);

When(
  "the {word} opens «События» from a horizon start that the events read refuses",
  async ({ page, host }, _actor: string) => {
    // A real refusal of the feed read alone: the live, month and facet reads
    // carry no `from`, so only the feed block can fail.
    await page.goto(`${host.eventsPath}?from=0001-01-01`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page);
  },
);

Then(
  "the day feed states the cause in Russian and offers «Повторить»",
  async ({ page }) => {
    const error = page.getByTestId("events-feed-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Не удалось загрузить ленту событий");
    await expect(
      error.getByRole("button", { name: "Повторить", exact: true }),
    ).toBeEnabled();
    await expect(page.getByTestId("events-feed")).toHaveCount(0);
  },
);

Then(
  "the «Идёт сейчас» block, the compact month and the facet panel stay usable",
  async ({ page }) => {
    await expect(liveStrip(page)).toBeVisible();
    await expect(
      liveStrip(page).getByTestId("live-event-strip-action"),
    ).toBeEnabled();

    const month = page.getByTestId("events-compact-month");
    const shown = await month.getAttribute("data-month");
    await page.getByTestId("events-compact-month-next").click();
    await expect(month).not.toHaveAttribute("data-month", shown ?? "");

    const online = filterPanel(page)
      .getByRole("group", { name: "Формат" })
      .getByRole("button", { name: "Онлайн", exact: true });
    await expect(online).toBeEnabled();
    await expect(online).toHaveAttribute("aria-pressed", "false");
  },
);

Then("no page-level error screen replaces the feed", async ({ page }) => {
  await expect(page.getByTestId("storefront-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "События", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("events-tense-tabs")).toBeVisible();
  await expect(
    page.getByText(/Application error|Internal Server Error/iu),
  ).toHaveCount(0);
});

When(
  "the {word} activates «Повторить»",
  async ({ page, world }, _actor: string) => {
    feedOf(world).history.push(pathAndQuery(page));
    let documentLoads = 0;
    page.on("load", () => (documentLoads += 1));
    const reread = page.waitForResponse(
      (res) => res.request().headers()["rsc"] === "1",
    );
    await page
      .getByTestId("events-feed-error")
      .getByRole("button", { name: "Повторить", exact: true })
      .click();
    await reread;
    await settle(page);
    expect(documentLoads, "the retry re-reads in place, no reload").toBe(0);
  },
);

Then(
  "the page re-reads in place, keeping the URL and the shell, and the day feed states the cause again",
  async ({ page, world }) => {
    expect(pathAndQuery(page)).toBe(feedOf(world).history.at(-1));
    await expect(page.getByTestId("storefront-shell")).toBeVisible();
    await expect(page.getByTestId("events-feed-error")).toContainText(
      "Не удалось загрузить ленту событий",
    );
    await expect(liveStrip(page)).toBeVisible();
  },
);

// ── EARS-15: one shared build in every rendering ────────────────────────────

/** The first opaque background the first card paints. */
async function cardBackground(page: Page): Promise<string> {
  return feedCards(page)
    .first()
    .evaluate((card) => {
      for (const node of [card, ...Array.from(card.querySelectorAll("*"))]) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
          return color;
        }
      }
      return "";
    });
}

function isDarkClass(value: string | null): boolean {
  return (value ?? "").split(/\s+/u).includes("dark");
}

/** Switch the theme the way a visitor does — the shell's own toggle. */
async function setTheme(page: Page, dark: boolean): Promise<void> {
  const html = page.locator("html");
  if (isDarkClass(await html.getAttribute("class")) === dark) return;
  await page.getByTestId("theme-toggle").filter({ visible: true }).first().click();
  await expect
    .poll(async () => isDarkClass(await html.getAttribute("class")))
    .toBe(dark);
}

async function expectSharedComposition(page: Page): Promise<void> {
  const order = await page
    .locator("[data-feed-block]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.feedBlock),
    );
  expect(order).toEqual(["head", "live", "feed"]);
  await expect(feedCards(page).first()).toBeVisible();
  // Every event link of the feed sits inside the design-system card unit.
  const outside = await page
    .getByTestId("events-feed")
    .locator(`a[href^="/events/"]`)
    .evaluateAll(
      (links) =>
        links.filter((link) => link.closest("[data-webinar-card]") === null)
          .length,
    );
  expect(outside, "an event link outside the design-system card").toBe(0);
}

When(
  "the {word} opens «События» at 1440 and at 390 wide, in the light and in the dark theme",
  async ({ page, host }, _actor: string) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFeed(page, host.eventsPath);
  },
);

Then(
  "every rendering composes the shared events module, its cards being the design-system event card",
  async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const dark of [false, true]) {
        await setTheme(page, dark);
        await expectSharedComposition(page);
      }
    }
    await setTheme(page, false);
    await page.setViewportSize({ width: 1440, height: 900 });
  },
);

Then(
  "the facet panel is the shared panel: a side column at 1440 and a counted «Фильтры» sheet at 390",
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      filterPanel(page).getByRole("group", { name: "Формат" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(page.getByTestId("events-column")).toBeHidden();
    const open = page.getByTestId("events-filter-open");
    await expect(open).toHaveText(/^Фильтры( \(\d+\))?$/u);
    await open.click();
    const sheet = page.getByTestId("events-filter-sheet");
    await expect(sheet.getByRole("group", { name: "Формат" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
  },
);

Then(
  "the dark theme repaints the cards through the theme tokens",
  async ({ page }) => {
    await setTheme(page, false);
    const light = await cardBackground(page);
    await setTheme(page, true);
    const dark = await cardBackground(page);
    expect(light, "the card paints a surface").not.toBe("");
    expect(dark, "the dark theme changes the card surface").not.toBe(light);
    await setTheme(page, false);
  },
);

// ── EARS-17: the kind dictionary, written by an editor ──────────────────────

Before({ tags: "@editor-write" }, async ({ $testInfo }) => {
  // An editor write needs a stand whose data the run owns; the read-only slot
  // run names the skip instead of writing into the shared golden slot.
  $testInfo.skip(
    !process.env.E2E_ADMIN_URL,
    "@editor-write: E2E_ADMIN_URL names no admin origin this run owns",
  );
});

After({ tags: "@editor-write" }, async ({ world }) => {
  const editor = world.eventsFeed?.editor;
  if (!editor) return;
  try {
    if (editor.event) {
      await retireEventFromStorefronts(editor.page, editor.event.id);
    }
    if (editor.kind && !editor.kind.retired) {
      await retireEventKind(editor.page, editor.kind.detailUrl);
    }
  } finally {
    await editor.page.context().close();
  }
});

interface PublishedKind {
  page: Page;
  kind: NonNullable<EditorWrites["kind"]>;
  editor: EditorWrites;
}

function editorKindOf(world: StepWorld): PublishedKind {
  const editor = feedOf(world).editor;
  if (!editor?.kind) throw new Error("No kind was published by an editor");
  return { page: editor.page, kind: editor.kind, editor };
}

Given(
  "an editor publishes a new event kind with a long title in the admin",
  async ({ browser, world }) => {
    const context = await browser.newContext({
      baseURL: ADMIN_ORIGIN,
      locale: "ru-RU",
    });
    const page = await context.newPage();
    const editor: EditorWrites = { page };
    feedOf(world).editor = editor;
    await signInAsAdmin(page);
    // A long title, unique per run, so it wraps on the card and in the panel.
    const title = `Клинический разбор с пациентом ${Date.now().toString(36)}`;
    const detailUrl = await createPublishedEventKind(page, title, ["online"]);
    editor.kind = { title, detailUrl, retired: false };
  },
);

Given(
  "the editor publishes a doctors-audience event of that kind starting within the hour",
  async ({ world }) => {
    const { page, kind, editor } = editorKindOf(world);
    const title = `Разбор по новому типу ${Date.now().toString(36)}`;
    const id = await createPublishedEvent(page, title, {
      startsInMs: 45 * 60 * 1000,
      kindTitle: kind.title,
      audience: "doctors",
    });
    editor.event = { id, title };
  },
);

Given("the editor retires that kind in the admin", async ({ world }) => {
  const { page, kind } = editorKindOf(world);
  await retireEventKind(page, kind.detailUrl);
  kind.retired = true;
});

function kindFacet(page: Page): Locator {
  return filterPanel(page).getByRole("group", { name: "Вид события" });
}

function editorEventOf(world: StepWorld): { title: string } {
  const event = feedOf(world).editor?.event;
  if (!event) throw new Error("No event was published by the editor");
  return event;
}

Then("the kind facet offers the new kind", async ({ page, world }) => {
  const { kind } = editorKindOf(world);
  await expect(
    kindFacet(page).getByRole("button", { name: kind.title, exact: true }),
  ).toBeVisible();
});

/** No horizontal overflow: the box holds its own content. */
async function expectNoOverflow(locator: Locator, what: string): Promise<void> {
  const box = await locator.evaluate((node) => ({
    scroll: node.scrollWidth,
    client: node.clientWidth,
  }));
  expect(box.scroll, `${what} overflows horizontally`).toBeLessThanOrEqual(
    box.client,
  );
}

Then(
  "that event's card carries the new kind's label without overflowing the card, the panel or the screen grid",
  async ({ page, world }) => {
    const { kind } = editorKindOf(world);
    const card = feedCards(page).filter({ hasText: editorEventOf(world).title });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(kind.title);
    await expectNoOverflow(card, "the card");
    await expectNoOverflow(filterPanel(page), "the facet panel");
    await expectNoOverflow(page.locator("html"), "the screen grid");
  },
);

When(
  "the {word} applies the new kind in the facet panel",
  async ({ page, world }, _actor: string) => {
    const { kind } = editorKindOf(world);
    await kindFacet(page)
      .getByRole("button", { name: kind.title, exact: true })
      .click();
    await page.waitForURL((url) => url.searchParams.has("kind"));
    await expect(page.getByTestId("events-feed")).toBeVisible();
  },
);

Then(
  "the feed lists that event under the applied kind",
  async ({ page, world }) => {
    const { kind } = editorKindOf(world);
    const cards = feedCards(page);
    await expect(
      cards.filter({ hasText: editorEventOf(world).title }),
    ).toHaveCount(1);
    const count = await cards.count();
    for (let index = 0; index < count; index += 1) {
      await expect(cards.nth(index)).toContainText(kind.title);
    }
  },
);

Then(
  "the kind facet does not offer the retired kind",
  async ({ page, world }) => {
    const { kind } = editorKindOf(world);
    await expect(kindFacet(page)).toBeVisible();
    await expect(
      filterPanel(page).getByRole("button", { name: kind.title, exact: true }),
    ).toHaveCount(0);
  },
);

// ── EARS-18: one module on both storefronts ─────────────────────────────────

/** The accessible names of the facet groups a host's panel renders. */
async function facetGroups(page: Page): Promise<string[]> {
  const groups = filterPanel(page).getByRole("group");
  const names: string[] = [];
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    const group = groups.nth(index);
    const label = await group.getAttribute("aria-label");
    const labelledBy = await group.getAttribute("aria-labelledby");
    const name =
      label ??
      (labelledBy
        ? await page.locator(`[id="${labelledBy}"]`).first().innerText()
        : "");
    if (name.trim()) names.push(name.trim());
  }
  return names;
}

/** The event slugs a host's feed lists. */
async function feedSlugs(page: Page, host: HostConfig): Promise<string[]> {
  const prefix = `${host.eventsPath}/`;
  const hrefs = await page
    .getByTestId("events-feed")
    .locator(`a[href^="${prefix}"]`)
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  return hrefs.map((href) => href.slice(prefix.length));
}

/** The shared module's structure, read the same way on either host. */
async function moduleShape(page: Page) {
  await expect(page.getByTestId("events-feed")).toBeVisible();
  return {
    tabs: await page
      .getByTestId("events-tense-tabs")
      .getByRole("tab")
      .allInnerTexts(),
    blocks: await page
      .locator("[data-feed-block]")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.feedBlock),
      ),
    dayGroupsHoldCards: await page
      .getByTestId("events-feed")
      .locator('section[id^="day-"]')
      .evaluateAll(
        (sections) =>
          sections.length > 0 &&
          sections.every(
            (section) => section.querySelector("[data-webinar-card]") !== null,
          ),
      ),
    compactMonthInColumn: await page
      .getByTestId("events-column")
      .getByTestId("events-compact-month")
      .isVisible(),
    panelInColumn: await filterPanel(page).isVisible(),
  };
}

When(
  "the {word} opens the events screen on the doctor storefront and on the Academy",
  async ({ page, context, host, world }, _actor: string) => {
    await openFeed(page, host.eventsPath);
    const academy = hostById("academy");
    const academyPage = await context.newPage();
    await academyPage.setViewportSize({ width: 1440, height: 900 });
    await openFeed(academyPage, `${baseUrlFor(academy)}${academy.eventsPath}`);
    feedOf(world).academyPage = academyPage;
  },
);

function academyPageOf(world: StepWorld): Page {
  const academyPage = feedOf(world).academyPage;
  if (!academyPage) throw new Error("The Academy events screen was not opened");
  return academyPage;
}

Then(
  "both render the same shared module: the head with the tense tabs, the block order, day groups of design-system cards, the compact month and the facet panel in the column",
  async ({ page, world }) => {
    const doctor = await moduleShape(page);
    const academy = await moduleShape(academyPageOf(world));
    expect(doctor).toEqual({
      tabs: ["Прошедшие", "Будущие"],
      blocks: ["head", "live", "feed"],
      dayGroupsHoldCards: true,
      compactMonthInColumn: true,
      panelInColumn: true,
    });
    expect(academy).toEqual(doctor);
  },
);

Then(
  "the head copy differs only as the «headerCopy» row cites",
  async ({ page, world }) => {
    const academyPage = academyPageOf(world);
    await expect(
      page.getByRole("heading", { level: 1, name: "События", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("События по вашей специальности и смежным", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      academyPage.getByRole("heading", {
        level: 1,
        name: "Расписание эфиров",
        exact: true,
      }),
    ).toBeVisible();
    // The Academy line is its counts line (эфиры · школы); the doctor head has none.
    await expect(
      academyPage.getByTestId("events-feed-subline-counts"),
    ).toBeVisible();
    await expect(page.getByTestId("events-feed-subline-counts")).toHaveCount(0);
  },
);

Then(
  "the facet sets differ only as the «filterSet» row cites",
  async ({ page, world }) => {
    const doctorSet = ["Специальность", "Формат", "Вид события", "Город"];
    const academySet = ["Проект", "Эксперт", "Тема"];
    const doctor = await facetGroups(page);
    const academy = await facetGroups(academyPageOf(world));
    expect(doctor).toEqual(expect.arrayContaining(["Формат", "Вид события"]));
    for (const name of doctor) expect(doctorSet, name).toContain(name);
    expect(academy.length).toBeGreaterThan(0);
    for (const name of academy) expect(academySet, name).toContain(name);
  },
);

Then(
  "the content sets differ as the «contentSet» row cites: no event is listed on both storefronts",
  async ({ page, host, world }) => {
    const doctor = await feedSlugs(page, host);
    const academy = await feedSlugs(academyPageOf(world), hostById("academy"));
    expect(doctor.length).toBeGreaterThan(0);
    expect(academy.length).toBeGreaterThan(0);
    expect(doctor.filter((slug) => academy.includes(slug))).toEqual([]);
  },
);
