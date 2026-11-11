import { expect, type Page } from "@playwright/test";
import { test as base, createBdd } from "playwright-bdd";
import {
  startMaterialPages,
  type MaterialPages,
} from "../lib/material-pages.js";
import { maskNotFoundVariant } from "../lib/not-found-page.js";
import { waitForClientReady } from "../lib/page-ready.js";

/** Per-scenario rail state: seeded titles (oldest first) and held feed reads. */
type FeedState = {
  titles: string[];
  held: (() => void)[];
  scrollLeft?: number;
  slot?: number;
  loadedBeforeEnd?: number;
};

export const test = base.extend<{
  materialPages: MaterialPages;
  documentStatus: { value?: number };
  feed: FeedState;
}>({
  // eslint-disable-next-line no-empty-pattern -- bddgen detects the custom test instance from this shape.
  materialPages: async ({}, use) => {
    const runtime = await startMaterialPages();
    try {
      await use(runtime);
    } finally {
      await runtime.stop();
    }
  },
  // eslint-disable-next-line no-empty-pattern -- each scenario owns its response status.
  documentStatus: async ({}, use) => {
    await use({});
  },
  // eslint-disable-next-line no-empty-pattern -- each scenario owns its rail state.
  feed: async ({}, use) => {
    const state: FeedState = { titles: [], held: [] };
    try {
      await use(state);
    } finally {
      for (const release of state.held.splice(0)) release();
    }
  },
});
const { Given, When, Then, After } = createBdd(test);

After(async ({ page, materialPages, $testInfo }) => {
  await $testInfo.attach("material-server-reads", {
    body: JSON.stringify(materialPages.transport.reads),
    contentType: "application/json",
  });
  await $testInfo.attach("material-browser", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

Given(
  "the published expert {string} is in the experts directory",
  async ({ materialPages }, fullName: string) => {
    await materialPages.expert(fullName);
  },
);
Given(
  "the news item {string} is published with the slug {string}",
  async ({ materialPages }, title: string, slug: string) => {
    await materialPages.material(title, slug, true);
  },
);
Given(
  "the draft news item {string} with the slug {string}",
  async ({ materialPages }, title: string, slug: string) => {
    await materialPages.material(title, slug, false);
  },
);
Given("the material read fails once", async ({ materialPages }) => {
  materialPages.transport.failOnce("otkryt-nabor-centrov");
});
When(
  "a visitor opens {string} on the Academy",
  async ({ page, materialPages, documentStatus }, path: string) => {
    documentStatus.value =
      (await page.goto(materialPages.portal + path))?.status() ?? 0;
  },
);
When(
  "a doctor opens {string} on doctor.school",
  async ({ page, materialPages, documentStatus }, path: string) => {
    documentStatus.value =
      (await page.goto(materialPages.doctor + path))?.status() ?? 0;
  },
);
Then(
  "the page shows the error state with «Повторить»",
  async ({ page, materialPages, $testInfo }) => {
    await expect(
      page.getByRole("button", { name: "Повторить", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    expect(
      materialPages.transport.reads.filter((read) => read.injected),
    ).toHaveLength(1);
    await $testInfo.attach("material-read-error", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  },
);
When("the visitor chooses «Повторить»", async ({ page }) => {
  await waitForClientReady(page);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
});
Then(
  "the reading page shows {string}",
  async ({ page, materialPages }, title: string) => {
    await expect(
      page
        .getByRole("article")
        .getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Повторить", exact: true }),
    ).toHaveCount(0);
    const reads = materialPages.transport.reads.filter(
      (read) => read.path === "/v1/public/materials/otkryt-nabor-centrov",
    );
    expect(reads.filter((read) => read.injected)).toHaveLength(1);
    expect(reads[0]).toEqual({
      path: "/v1/public/materials/otkryt-nabor-centrov",
      status: 503,
      injected: true,
    });
    expect(reads.at(-1)).toEqual({
      path: "/v1/public/materials/otkryt-nabor-centrov",
      status: 200,
      injected: false,
    });
  },
);
Then(
  "the Academy not-found page is shown",
  async ({ page, materialPages, documentStatus, $testInfo }) => {
    expect(documentStatus.value).toBe(404);
    await expect(page.getByRole("article")).toHaveCount(0);
    await $testInfo.attach("academy-draft-404", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const content = maskNotFoundVariant(await page.locator("main").innerText());
    expect(
      (
        await page.goto(
          `${materialPages.portal}/materials/missing-${materialPages.token}`,
        )
      )?.status(),
    ).toBe(404);
    expect(maskNotFoundVariant(await page.locator("main").innerText())).toBe(
      content,
    );
    expect(
      (
        await page.goto(
          `${materialPages.portal}/missing-${materialPages.token}`,
        )
      )?.status(),
    ).toBe(404);
    expect(maskNotFoundVariant(await page.locator("main").innerText())).toBe(
      content,
    );
  },
);
Then(
  "the doctor storefront's not-found page is shown",
  async ({ page, materialPages, documentStatus, $testInfo }) => {
    expect(documentStatus.value).toBe(404);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByText("Открыт набор центров в исследование PRP", {
        exact: true,
      }),
    ).toHaveCount(0);
    await $testInfo.attach("doctor-material-404", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const content = maskNotFoundVariant(await page.locator("body").innerText());
    expect(
      (
        await page.goto(
          `${materialPages.doctor}/missing-${materialPages.token}`,
        )
      )?.status(),
    ).toBe(404);
    expect(maskNotFoundVariant(await page.locator("body").innerText())).toBe(
      content,
    );
  },
);
Then(
  "the doctor storefront home has no rail «Новости, блог и видео»",
  async ({ page, materialPages }) => {
    expect((await page.goto(materialPages.doctor))?.status()).toBe(200);
    await expect(
      page.getByText("Новости, блог и видео", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Открыт набор центров в исследование PRP", {
        exact: true,
      }),
    ).toHaveCount(0);
  },
);

// ── 048 EARS-14 / EARS-15 / EARS-16 — the rail on the Academy home ──────────
// Data are real rows read through the real API; only «fails once» / «slow to
// answer» touch the browser's feed read, and a held read is then forwarded to
// the real API unchanged.

const RAIL_LABEL =
  "Новости, блог и видео: листайте влево и вправо, стрелки клавиатуры — по одной карточке";
const PREV = "Назад к более новым материалам";
const NEXT = "Дальше, к более ранним материалам";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const feedSection = (page: Page) =>
  page.locator('[data-academy-section="feed"]');
const rail = (page: Page) => page.getByRole("region", { name: RAIL_LABEL });
const cards = (page: Page) => rail(page).locator("[data-slot] > a");
const placeholders = (page: Page) =>
  feedSection(page).locator("[data-feed-card-skeleton]");
const liveRegion = (page: Page) =>
  feedSection(page).locator('[aria-live="polite"]');
const isFeedRead = (url: URL) => url.pathname === "/v1/public/feed";

/** Newest first, as the feed orders them. */
const newest = (feed: FeedState) => [...feed.titles].reverse();

async function expectCardTitles(page: Page, titles: string[]) {
  await expect(cards(page)).toHaveCount(titles.length);
  const texts = await cards(page).allTextContents();
  expect(
    texts.map((text) => titles.find((title) => text.includes(title)) ?? text),
  ).toEqual(titles);
}

/** Waits until the rail's scroll position stops changing (smooth scrolling). */
async function settledScroll(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    const now = await rail(page).evaluate((el) => el.scrollLeft);
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}

async function slotWidth(page: Page): Promise<number> {
  return rail(page).evaluate((el) => {
    const slot = el.querySelector<HTMLElement>("[data-slot]")!;
    return slot.offsetWidth + (parseFloat(getComputedStyle(el).columnGap) || 0);
  });
}

/** Holds the first matching feed read until the scenario releases it. */
async function holdFeedRead(
  page: Page,
  feed: FeedState,
  match: (url: URL) => boolean,
): Promise<void> {
  let armed = true;
  await page.route(
    (url) => isFeedRead(url) && match(url),
    async (route) => {
      if (!armed) return route.fallback();
      armed = false;
      await new Promise<void>((release) => feed.held.push(release));
      await route.fallback().catch(() => undefined);
    },
  );
}

async function failFeedReadOnce(
  page: Page,
  match: (url: URL) => boolean,
): Promise<void> {
  let armed = true;
  await page.route(
    (url) => isFeedRead(url) && match(url),
    async (route) => {
      if (!armed) return route.fallback();
      armed = false;
      await route.fulfill({ status: 503, body: "" });
    },
  );
}

async function openHome(
  page: Page,
  materialPages: MaterialPages,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  expect((await page.goto(materialPages.portal + "/"))?.status()).toBe(200);
  await expect(feedSection(page)).toBeVisible();
}

async function openHomeWithCards(page: Page, materialPages: MaterialPages) {
  await openHome(page, materialPages, DESKTOP);
  await expect(cards(page)).toHaveCount(12);
  await waitForClientReady(page);
}

/** Index of the last card wholly inside the rail's visible box. */
async function lastWhollyVisible(page: Page): Promise<number> {
  return rail(page).evaluate((el) => {
    const box = el.getBoundingClientRect();
    let last = -1;
    el.querySelectorAll("[data-slot] > a").forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      if (rect.left >= box.left - 1 && rect.right <= box.right + 1)
        last = index;
    });
    return last;
  });
}

Given(
  "{int} published materials exist",
  async ({ materialPages, feed }, count: number) => {
    const tag = materialPages.token.slice(0, 8);
    for (let n = 1; n <= count; n += 1) {
      const title = `Материал ленты ${String(n).padStart(2, "0")}`;
      await materialPages.material(
        title,
        `feed-${tag}-${String(n).padStart(2, "0")}`,
        true,
      );
      feed.titles.push(title);
    }
    const read = (await (
      await fetch(`${materialPages.api}/v1/public/feed?limit=50`)
    ).json()) as { data: { title: string }[] };
    expect(read.data.map((card) => card.title)).toEqual(newest(feed));
  },
);
Given("no material is published", async ({ materialPages }) => {
  const read = (await (
    await fetch(`${materialPages.api}/v1/public/feed?limit=1`)
  ).json()) as { data: unknown[]; nextCursor: string | null };
  expect(read).toEqual({ data: [], nextCursor: null });
});
Given("the second feed page fails once", async ({ page }) => {
  await failFeedReadOnce(page, (url) => url.searchParams.has("cursor"));
});
Given("the first feed page fails once", async ({ page }) => {
  await failFeedReadOnce(page, (url) => !url.searchParams.has("cursor"));
});
Given("the first feed page is slow to answer", async ({ page, feed }) => {
  await holdFeedRead(page, feed, (url) => !url.searchParams.has("cursor"));
});

When(
  "a visitor on a desktop opens the Academy home",
  async ({ page, materialPages }) => {
    await openHome(page, materialPages, DESKTOP);
  },
);
When("a visitor opens the Academy home", async ({ page, materialPages }) => {
  await openHome(page, materialPages, DESKTOP);
});
When(
  "a visitor on a phone opens the Academy home while the first feed page loads",
  async ({ page, materialPages, feed }) => {
    await holdFeedRead(page, feed, (url) => !url.searchParams.has("cursor"));
    await openHome(page, materialPages, PHONE);
  },
);
When("the first feed page arrives", async ({ feed }) => {
  await expect.poll(() => feed.held.length).toBe(1);
  feed.held.shift()!();
});

Then(
  "the rail shows the {int} newest cards in two rows with the next column partly visible",
  async ({ page, feed }, count: number) => {
    await expectCardTitles(page, newest(feed).slice(0, count));
    await expect(rail(page)).toHaveAttribute("data-rows", "2");
    const layout = await rail(page).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const slots = [...el.querySelectorAll<HTMLElement>("[data-slot]")].map(
        (slot) => slot.getBoundingClientRect(),
      );
      return {
        rows: new Set(slots.map((slot) => Math.round(slot.top))).size,
        partial: slots.some(
          (slot) => slot.left < box.right && slot.right > box.right + 1,
        ),
      };
    });
    expect(layout).toEqual({ rows: 2, partial: true });
  },
);
Then(
  "the rail shows the {int} newest cards",
  async ({ page, feed }, count: number) => {
    await expectCardTitles(page, newest(feed).slice(0, count));
  },
);
Then("the rail shows {int} cards", async ({ page, feed }, count: number) => {
  await expectCardTitles(page, newest(feed).slice(0, count));
});
Then(
  "the button «Назад к более новым материалам» is disabled",
  async ({ page }) => {
    await expect(page.getByRole("button", { name: PREV })).toBeDisabled();
  },
);
Then(
  "the button «Дальше, к более ранним материалам» is disabled",
  async ({ page }) => {
    await expect(page.getByRole("button", { name: NEXT })).toBeDisabled();
  },
);
Then("both arrow buttons are disabled", async ({ page }) => {
  await expect(page.getByRole("button", { name: PREV })).toBeDisabled();
  await expect(page.getByRole("button", { name: NEXT })).toBeDisabled();
});
Then(
  "the feed section shows {int} placeholder cards",
  async ({ page }, count: number) => {
    await expect(placeholders(page)).toHaveCount(count);
    await expect(rail(page)).toHaveAttribute("aria-busy", "true");
    await expect(rail(page).locator("a")).toHaveCount(0);
  },
);

When(
  "the visitor presses «Дальше, к более ранним материалам» until the rail nears its end",
  async ({ page, feed }) => {
    await waitForClientReady(page);
    await holdFeedRead(page, feed, (url) => url.searchParams.has("cursor"));
    const next = page.getByRole("button", { name: NEXT });
    for (let i = 0; i < 12 && feed.held.length === 0; i += 1) {
      await next.click();
      await settledScroll(page);
    }
    expect(feed.held).toHaveLength(1);
  },
);
Then(
  "the next {int} cards load after placeholder cards and «Загружено материалов: {int}» is announced",
  async ({ page, feed }, count: number, announced: number) => {
    await expect(placeholders(page)).toHaveCount(4);
    await expect(cards(page)).toHaveCount(12);
    feed.held.shift()!();
    await expectCardTitles(page, newest(feed).slice(0, 12 + count));
    await expect(placeholders(page)).toHaveCount(0);
    await expect(liveRegion(page)).toHaveText(
      `Загружено материалов: ${announced}`,
    );
  },
);
When("the visitor reaches the last card", async ({ page, feed }) => {
  const next = page.getByRole("button", { name: NEXT });
  for (let i = 0; i < 40 && (await next.isEnabled()); i += 1) {
    await next.click();
    await settledScroll(page);
  }
  await expectCardTitles(page, newest(feed));
  expect(await lastWhollyVisible(page)).toBe(feed.titles.length - 1);
});
Then("«Это все материалы.» is announced", async ({ page }) => {
  await expect(liveRegion(page)).toContainText("Это все материалы.");
});

When(
  "a visitor focuses the rail on the Academy home and presses ArrowRight",
  async ({ page, materialPages, feed }) => {
    await openHomeWithCards(page, materialPages);
    feed.scrollLeft = await settledScroll(page);
    feed.slot = await slotWidth(page);
    await rail(page).focus();
    await page.keyboard.press("ArrowRight");
  },
);
Then("the rail moves by one card", async ({ page, feed }) => {
  await expect
    .poll(async () => (await settledScroll(page)) - feed.scrollLeft!)
    .toBeCloseTo(feed.slot!, 0);
});
When("the visitor presses End", async ({ page, feed }) => {
  feed.loadedBeforeEnd = await cards(page).count();
  await page.keyboard.press("End");
});
Then("the rail shows its last loaded cards", async ({ page, feed }) => {
  await settledScroll(page);
  expect(await lastWhollyVisible(page)).toBeGreaterThanOrEqual(
    feed.loadedBeforeEnd! - 1,
  );
});

When(
  "a visitor opens the Academy home and waits ten seconds without input",
  async ({ page, materialPages, feed }) => {
    await openHomeWithCards(page, materialPages);
    feed.scrollLeft = await rail(page).evaluate((el) => el.scrollLeft);
    await page.waitForTimeout(10_000);
  },
);
Then("the rail is still at its start", async ({ page, feed }) => {
  expect(feed.scrollLeft).toBe(0);
  expect(await rail(page).evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(page.getByRole("button", { name: PREV })).toBeDisabled();
});

When(
  "a visitor scrolls the rail to its end",
  async ({ page, materialPages }) => {
    await openHomeWithCards(page, materialPages);
    await rail(page).evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
  },
);
Then(
  "the {int} loaded cards stay and «Повторить» is offered at the end of the rail",
  async ({ page, feed }, count: number) => {
    const retry = rail(page).getByRole("button", {
      name: "Повторить",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expectCardTitles(page, newest(feed).slice(0, count));
    expect(
      await rail(page).evaluate(
        (el) =>
          !!el.querySelector("[data-slot]:last-child")?.querySelector("button"),
      ),
    ).toBe(true);
  },
);
Then(
  "the next {int} cards are shown",
  async ({ page, feed }, count: number) => {
    await expectCardTitles(page, newest(feed).slice(0, 12 + count));
    await expect(
      rail(page).getByRole("button", { name: "Повторить", exact: true }),
    ).toHaveCount(0);
  },
);

Then(
  "the feed section shows «Записей пока нет.» and «Здесь появятся новости Академии и публикации из наших соцсетей.»",
  async ({ page }) => {
    await expect(
      feedSection(page).getByText("Записей пока нет.", { exact: true }),
    ).toBeVisible();
    await expect(
      feedSection(page).getByText(
        "Здесь появятся новости Академии и публикации из наших соцсетей.",
        { exact: true },
      ),
    ).toBeVisible();
  },
);
Then("the feed section has no rail and no arrow buttons", async ({ page }) => {
  await expect(rail(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: PREV })).toHaveCount(0);
  await expect(page.getByRole("button", { name: NEXT })).toHaveCount(0);
});
Then(
  "the feed section shows «Не удалось загрузить новости.» with «Повторить»",
  async ({ page }) => {
    await expect(
      feedSection(page).getByText("Не удалось загрузить новости.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      feedSection(page).getByRole("button", { name: "Повторить", exact: true }),
    ).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
  },
);
Then("the events block of the home is shown", async ({ page }) => {
  const events = page.locator('[data-academy-section="events"]');
  await expect(events).toBeVisible();
  await expect(
    events.getByRole("heading", { name: "Ближайшие и последние эфиры" }),
  ).toBeVisible();
});
