import { expect, type Page } from "@playwright/test";
import { Given, When, Then, After } from "./support/fixtures.js";
import { createPublicFeedStateFixture } from "../lib/public-feed-state-fixture.js";
import {
  feedEntryLog,
  verifyOwnedFeedEntryListeners,
} from "../lib/feed-entry.js";
import { publicFeedStateTitles } from "../lib/host-tags.js";
import { waitForClientReady } from "../lib/page-ready.js";

type Specialty = { id: string; code: string; name: string; isOther: boolean };
type Card = {
  id: string;
  title: string;
  href: string;
  signUpCount: number | null;
  format: string;
  nmo: boolean;
};
type State = {
  book: Specialty[];
  specialty?: Specialty;
  fixture?: Awaited<ReturnType<typeof createPublicFeedStateFixture>>;
  items?: Card[];
  envelope?: { blocks: { kind: string }[] };
};
const states = new WeakMap<Page, State>();
function state(page: Page) {
  const value = states.get(page);
  if (!value) throw new Error("018 Background did not run");
  return value;
}
async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(new URL(path, page.url()).href);
  expect(response.status(), path).toBe(200);
  feedEntryLog({
    command: "read actual specialty feed API",
    path,
    status: response.status(),
  });
  return response.json() as Promise<T>;
}
function card(page: Page, name: string) {
  const event = state(page).fixture!.events.find(
    (event) => event.name === name,
  )!;
  return page
    .getByTestId("specialty-feed-events")
    .locator("[data-webinar-card]")
    .filter({ has: page.locator(`a[href="/events/${event.slug}"]`) });
}

Given(
  "feature 017's storefront shell and specialty books are in place",
  async ({ page, host, world }) => {
    expect(host.id).toBe("doctor");
    verifyOwnedFeedEntryListeners();
    expect((await page.goto(world.hostBaseUrl))?.status()).toBe(200);
    await expect(page.getByTestId("storefront-shell")).toBeVisible();
    await expect(page.getByTestId("storefront-header")).toHaveCount(1);
    await expect(page.getByTestId("storefront-footer")).toHaveCount(1);
    const book = await read<{ entries: Specialty[]; total: number }>(
      page,
      "/v1/public/specialties",
    );
    expect(book.total).toBe(book.entries.length);
    expect(book.total).toBeGreaterThan(90);
    expect(
      book.entries.filter((row) => row.isOther).map((row) => row.name),
    ).toEqual(["Другое"]);
    states.set(page, { book: book.entries });
  },
);
Given(
  "the specialty «Травматология и ортопедия» exists in specialties_minzdrav",
  async ({ page }) => {
    const specialty = state(page).book.find(
      (row) => row.name === "Травматология и ортопедия",
    );
    expect(specialty).toBeDefined();
    state(page).specialty = specialty!;
  },
);
Given(
  "the managed reference table links it to its directions and adjacent directions",
  async ({ page }) => {
    state(page).fixture = await createPublicFeedStateFixture(
      state(page).specialty!.id,
    );
  },
);
Given("the specialty has upcoming events", async ({ page }) => {
  const value = state(page);
  const body = await read<{ items: Card[] }>(
    page,
    `/v1/storefront/feed/${value.specialty!.code}/events`,
  );
  expect(body.items.map((item) => item.id)).toEqual(
    value.fixture!.events.map((event) => event.id),
  );
  value.items = body.items;
});
Given(
  "an upcoming event whose «Скрыть число записавшихся» option is on",
  async ({ page }) => {
    expect(state(page).items![0]!.signUpCount).toBeNull();
  },
);
Given(
  "an offline colleagues' meet-up among the nearest events",
  async ({ page }) => {
    expect(state(page).items![2]!.format).toBe("offline");
  },
);
When("a visitor opens the feed", async ({ page }) => {
  const value = state(page);
  expect((await page.goto(`/feed/${value.specialty!.code}`))?.status()).toBe(
    200,
  );
  await expect(page.getByTestId("specialty-feed")).toBeVisible();
  await expect(
    page.getByTestId("specialty-feed-events").locator("[data-webinar-card]"),
  ).toHaveCount(3);
  await waitForClientReady(page);
  value.envelope = await read(
    page,
    `/v1/storefront/feed/${value.specialty!.code}`,
  );
});
Then(
  "the feed response carries no entry for schools, lessons, leaderboard or communities",
  async ({ page }) => {
    expect(state(page).envelope!.blocks.map((block) => block.kind)).toEqual([
      "events",
    ]);
  },
);
Then(
  "the page renders no heading, placeholder, «Готовится» or «скоро» stand-in and no empty shell for any of them",
  async ({ page }) => {
    const feed = page.getByTestId("specialty-feed");
    await expect(feed.locator("[data-feed-block-slot]")).toHaveCount(1);
    await expect(feed.locator("[data-feed-block-slot]")).toHaveAttribute(
      "data-feed-block-slot",
      "events",
    );
    for (const kind of ["schools", "lessons", "leaderboard", "communities"])
      await expect(
        feed.locator(
          `[data-feed-block-slot="${kind}"], [data-testid="specialty-feed-${kind}"]`,
        ),
      ).toHaveCount(0);
    await expect(feed).not.toContainText(
      /Школы и курсы|Уроки|Топ по специальности|Сообщества|Готовится|скоро/i,
    );
  },
);
Then("its nearest-events item carries signUpCount null", async ({ page }) => {
  expect(state(page).items![0]!.signUpCount).toBeNull();
});
Then(
  "its card renders no sign-up counter line, no «0» and no empty slot",
  async ({ page }) => {
    const hidden = card(page, "hidden");
    await expect(hidden).toHaveCount(1);
    await expect(hidden.locator("[data-signup-count]")).toHaveCount(0);
    await expect(hidden).not.toContainText(/записал/i);
    const standaloneZero = await hidden
      .locator("span")
      .evaluateAll((nodes) =>
        nodes.some((node) => node.textContent?.trim() === "0"),
      );
    expect(standaloneZero).toBe(false);
  },
);
Then(
  "the cards of events with the option off still show the counter",
  async ({ page }) => {
    for (const name of ["shown", "offline"]) {
      const item = state(page).items!.find(
        (item) =>
          item.id ===
          state(page).fixture!.events.find((event) => event.name === name)!.id,
      )!;
      expect(item.signUpCount).toBe(1);
      await expect(card(page, name).locator("[data-signup-count]")).toHaveCount(
        1,
      );
      await expect(
        card(page, name).locator("[data-signup-count]"),
      ).toContainText(String(item.signUpCount));
    }
  },
);
Then(
  "the meet-up renders through the same event card with its offline format marker",
  async ({ page }) => {
    await expect(card(page, "offline")).toHaveCount(1);
    await expect(
      card(page, "offline").locator("[data-event-format-label]"),
    ).toBeVisible();
    await expect(
      card(page, "offline").locator("[data-event-format-label]"),
    ).toContainText(/очно|офлайн/i);
  },
);
Then("no separate card kind is introduced for it", async ({ page }) => {
  const kinds = await page
    .getByTestId("specialty-feed-events")
    .locator("[data-webinar-card]")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        tag: node.tagName,
        marker: node.getAttribute("data-webinar-card"),
        classes: node.className,
      })),
    );
  expect(kinds).toHaveLength(3);
  expect(kinds[2]).toEqual(kinds[1]);
});
Then(
  "НМО appears only as an attribute of an event, never as a heading or a filter of the screen",
  async ({ page }) => {
    const feed = page.getByTestId("specialty-feed");
    for (const role of [
      "heading",
      "checkbox",
      "switch",
      "button",
      "combobox",
    ] as const)
      await expect(feed.getByRole(role, { name: /НМО/ })).toHaveCount(0);
    // The real authoring projection currently supplies false; positive-chip rendering has distinct local coverage.
    for (const name of ["hidden", "shown", "offline"]) {
      const item = state(page).items!.find(
        (item) =>
          item.id ===
          state(page).fixture!.events.find((event) => event.name === name)!.id,
      )!;
      expect(typeof item.nmo).toBe("boolean");
      await expect(card(page, name).locator("[data-event-nmo]")).toHaveCount(
        item.nmo ? 1 : 0,
      );
    }
  },
);
After(async ({ page, $testInfo }) => {
  if (
    !publicFeedStateTitles.some(
      (title) =>
        $testInfo.title === title || $testInfo.title.startsWith(title + " @"),
    )
  )
    return;
  const value = states.get(page);
  try {
    await $testInfo.attach("real-public-feed-states", {
      body: JSON.stringify({
        specialty: value?.specialty,
        items: value?.items,
        envelope: value?.envelope,
      }),
      contentType: "application/json",
    });
  } finally {
    await value?.fixture?.cleanup();
    states.delete(page);
  }
});
