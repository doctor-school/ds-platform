import { randomUUID } from "node:crypto";
import { expect, type Page, type BrowserContext } from "@playwright/test";
import { Given, When, Then, After } from "./support/fixtures.js";
import { signInAsAdmin } from "../admin/sign-in.js";
import {
  createCalendarGroupingFixture,
  createReadonlyOperator,
} from "../lib/public-readonly-fixture.js";
import {
  feedEntryLog,
  verifyOwnedFeedEntryListeners,
} from "../lib/feed-entry.js";
import { publicReadonlyOriginals } from "../lib/public-readonly-originals.js";
import { waitForClientReady } from "../lib/page-ready.js";

type Book = {
  entries: { id: string; code: string; name: string; isOther: boolean }[];
  total: number;
};
type State = {
  calendar?: Awaited<ReturnType<typeof createCalendarGroupingFixture>>;
  operator?: Awaited<ReturnType<typeof createReadonlyOperator>>;
  context?: BrowserContext;
  admin?: Page;
  book?: Book;
};
const states = new WeakMap<Page, State>();
function state(page: Page) {
  let value = states.get(page);
  if (!value) {
    value = {};
    states.set(page, value);
  }
  return value;
}
async function readBook(page: Page) {
  const response = await page.request.get(
    new URL("/v1/public/specialties", process.env.E2E_API_URL).href,
  );
  expect(response.status()).toBe(200);
  return response.json() as Promise<Book>;
}
async function noBookControls(page: Page) {
  await expect(page.getByTestId("specialties-create")).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Действия" }),
  ).toHaveCount(0);
  for (const role of ["button", "link"] as const)
    await expect(
      page.getByRole("main").getByRole(role, {
        name: /создать|добавить|редактировать|изменить|удалить|импорт/i,
      }),
    ).toHaveCount(0);
  await expect(
    page.getByRole("main").locator('input[type="file"]'),
  ).toHaveCount(0);
}

Given(
  "an online event and an offline event, both starting at 01:00 МСК on 15 October",
  async ({ page, host, world }) => {
    expect(host.id).toBe("academy");
    verifyOwnedFeedEntryListeners();
    const response = await page.request.get(
      new URL("/v1/public/events?timeframe=upcoming", world.hostBaseUrl).href,
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { horizon: { today: string } };
    expect(body.horizon.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    state(page).calendar = await createCalendarGroupingFixture(
      body.horizon.today,
    );
  },
);
Given(
  /^a viewer whose browser timezone is Europe\/London$/,
  async ({ page }) => {
    expect(
      await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe("Europe/London");
  },
);
When("the viewer opens the week list", async ({ page, host }) => {
  const { year, events } = state(page).calendar!;
  const query = `from=${year}-10-14&to=${year}-10-16`;
  const api = await page.request.get(
    new URL(
      `/v1/public/events?timeframe=upcoming&${query}`,
      process.env.E2E_API_URL,
    ).href,
  );
  expect(api.status()).toBe(200);
  const body = (await api.json()) as { items: { id: string }[] };
  for (const event of events)
    expect(body.items.map(({ id }) => id)).toContain(event.id);
  expect((await page.goto(`${host.eventsPath}?${query}`))?.status()).toBe(200);
  await waitForClientReady(page);
});
async function calendarCard(
  page: Page,
  format: "online" | "offline",
  day: string,
  time: string,
) {
  const event = state(page).calendar!.events.find(
    (item) => item.format === format,
  )!;
  const card = page
    .getByTestId("events-feed")
    .locator("[data-webinar-card]")
    .filter({ has: page.locator(`a[href$="/${event.slug}"]`) });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(time);
  const group = card.locator("xpath=ancestor::section[1]");
  await expect(group.locator("[data-event-list-group-header]")).toContainText(
    day,
  );
  const other = format === "online" ? "15 октября" : "14 октября";
  await expect(
    group.locator("[data-event-list-group-header]"),
  ).not.toContainText(other);
}
Then(
  'the online event is grouped under 14 October and reads "23:00 GMT+1"',
  async ({ page }) => {
    await calendarCard(page, "online", "14 октября", "23:00 GMT+1");
  },
);
Then(
  'the offline event is grouped under 15 October and reads "01:00 МСК"',
  async ({ page }) => {
    await calendarCard(page, "offline", "15 октября", "01:00 МСК");
  },
);

Then("no Academy content block is rendered", async ({ page }) => {
  const feed = page.getByTestId("specialty-feed");
  await expect(
    feed.locator(
      '[data-feed-block-slot*="academy" i], [data-testid*="academy" i]',
    ),
  ).toHaveCount(0);
  await expect(feed).not.toContainText(/академи[яию]|закулисье/i);
});
Then(
  "no Academy link exists on the feed — 017's footer link remains the only crossing",
  async ({ page }) => {
    const academy = new URL(process.env.E2E_PORTAL_URL!).origin;
    const crossing = await page.getByRole("link").evaluateAll(
      (links, origin) =>
        links
          .filter(
            (node) =>
              new URL((node as HTMLAnchorElement).href).origin === origin,
          )
          .map((node) => ({
            href: (node as HTMLAnchorElement).href,
            inFooter: !!node.closest('[data-testid="storefront-footer"]'),
          })),
      academy,
    );
    expect(crossing).toHaveLength(1);
    expect(crossing[0]!.inFooter).toBe(true);
    expect(new URL(crossing[0]!.href).pathname).toBe("/");
  },
);
Then("no backstage navigation entry is present", async ({ page }) => {
  for (const root of [
    page.getByTestId("storefront-header"),
    page.getByTestId("specialty-feed"),
  ]) {
    await expect(
      root.getByRole("link", { name: /закулисье|проекты|эксперты|партнёры/i }),
    ).toHaveCount(0);
    await expect(
      root.locator(
        'a[href*="/backstage"], a[href*="/projects"], a[href*="/experts"], a[href*="/partners"]',
      ),
    ).toHaveCount(0);
  }
});

Given(
  "an operator opens the Минздрав specialty book in the admin application",
  async ({ page, browser }) => {
    const value = state(page);
    value.book = await readBook(page);
    value.operator = await createReadonlyOperator();
    value.context = await browser.newContext({
      baseURL: process.env.E2E_ADMIN_URL!,
      locale: "ru-RU",
      viewport: { width: 1440, height: 1000 },
    });
    const admin = (value.admin = await value.context.newPage());
    await signInAsAdmin(admin, value.operator.credentials);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await admin.route("**/v1/public/specialties", async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await admin.getByTestId("nav-specialties").click();
      await expect(admin.getByTestId("specialties-notice")).toBeVisible();
      await expect(admin.locator('[data-testid^="row-"]:visible')).toHaveCount(
        0,
      );
      await noBookControls(admin);
      feedEntryLog({
        command:
          "checked read-only controls while the actual book request was pending",
      });
    } finally {
      release();
    }
    await expect(
      admin.locator('[data-testid^="row-"]:visible').first(),
    ).toBeVisible();
    await admin.unroute("**/v1/public/specialties");
  },
);
Then(
  "every seeded entry of the book is listed with the same record patterns",
  async ({ page }) => {
    const value = state(page),
      admin = value.admin!;
    const seen = new Set<string>();
    const expected = new Map(
      value.book!.entries.map((entry) => [entry.id, entry]),
    );
    for (let index = 0; index < value.book!.total; index++) {
      const rows = admin.locator('[data-testid^="row-"]:visible');
      for (const row of await rows.all()) {
        const id = (await row.getAttribute("data-testid"))!.slice(4),
          entry = expected.get(id);
        expect(entry, id).toBeDefined();
        expect(seen.has(id), "A book row must not repeat across pages").toBe(
          false,
        );
        await expect(row).toHaveText(entry!.name);
        await expect(row.locator("xpath=ancestor::tr")).toContainText(
          entry!.code,
        );
        seen.add(id);
      }
      await noBookControls(admin);
      if (seen.size === expected.size) break;
      const first = await rows.first().getAttribute("data-testid");
      await admin
        .getByRole("navigation", { name: "Страницы списка" })
        .getByRole("button", { name: "Вперёд", exact: true })
        .click();
      await expect(rows.first()).not.toHaveAttribute("data-testid", first!);
    }
    expect([...seen].sort()).toEqual([...expected.keys()].sort());
    feedEntryLog({
      command: "verified every seeded closed-book record across all pages",
      count: seen.size,
    });
  },
);
Then(
  "no create, edit, delete or import control is present in any state",
  async ({ page }) => {
    const value = state(page),
      admin = value.admin!,
      search = admin.getByRole("searchbox", { name: "Поиск специальности" });
    await noBookControls(admin);
    await search.fill(value.book!.entries[0]!.code);
    await expect(
      admin.locator('[data-testid^="row-"]:visible').first(),
    ).toBeVisible();
    await noBookControls(admin);
    await search.fill(`no-such-specialty-${randomUUID()}`);
    await expect(admin.locator('[data-testid^="row-"]:visible')).toHaveCount(0);
    await noBookControls(admin);
    await admin.getByRole("button", { name: "Сбросить всё" }).click();
    const row = admin.locator('[data-testid^="row-"]:visible').first();
    await expect(row).toBeVisible();
    const url = admin.url();
    await row.click();
    await expect(admin).toHaveURL(url);
    await noBookControls(admin);
  },
);
Then(
  "a write request against the book is refused by the API",
  async ({ page }) => {
    const value = state(page),
      admin = value.admin!,
      before = await readBook(page);
    expect(before).toEqual(value.book);
    for (const path of [
      "/v1/public/specialties",
      "/v1/admin/specialties",
      `/v1/admin/specialties/${before.entries[0]!.id}`,
    ]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await admin.request.fetch(
          new URL(path, process.env.E2E_ADMIN_URL).href,
          {
            method,
            data: { code: "not-a-specialty", name: "Не специальность" },
          },
        );
        expect(response.status()).toBeGreaterThanOrEqual(400);
        expect(response.status()).toBeLessThan(500);
        feedEntryLog({
          command: "real authenticated closed-book write refused",
          path,
          method,
          status: response.status(),
        });
      }
    }
    expect(await readBook(page)).toEqual(before);
  },
);

After(async ({ page, $testInfo }) => {
  if (
    !publicReadonlyOriginals.some(
      ({ title }) =>
        $testInfo.title === title || $testInfo.title.startsWith(title + " @"),
    )
  )
    return;
  const value = states.get(page);
  try {
    await value?.calendar?.cleanup();
  } finally {
    try {
      await value?.context?.close();
      await value?.operator?.cleanup();
    } finally {
      states.delete(page);
    }
  }
});
