import { expect, test, type Page } from "@playwright/test";

/**
 * The Academy mount of the one feed view of both storefronts (wave-2 entry gate
 * §2.4, the #2076 canvas) at `academy.doctor.school/webinars`. The doctor mount
 * is pinned by `apps/doctor/e2e/events-*.spec.ts` over an upstream double; this
 * tier drives the live portal over the seeded branch DB, guest only (the
 * signed-in «Мои события» block needs a real session — the doctor tier owns it).
 *
 *   row 28 — the head's tense tabs, «Будущие» by default, the tense in the URL;
 *   rows 29–30 — «Прошедшие» groups by month newest first, no archive block;
 *   row 32 — both tenses page by 10 events (019 LD-2): the bare `/webinars`
 *            holds the 10 nearest upcoming эфиры (all of them at 11 or fewer,
 *            then no «Показать ещё»), and `?tense=past` offers «Показать ещё N
 *            (осталось M)», which widens the extent in the URL until every past
 *            эфир is shown (no age floor). Expected counts come from the guest
 *            feed read the page renders from, so the same spec holds a local
 *            seed and a slot's golden season (#3229);
 *   row 31 — a published recording reads «Запись · <length>» + «Смотреть запись»;
 *   row 43 — the live block renders an experts-audience live event
 *            (`E2E_WEBINAR_SLUG_LIVE`, default `seed-005-live`);
 *   row 50 — head → «Идёт сейчас» → day feed («Мои события» is absent for a guest);
 *   §4.3 D1 — a legacy listing URL answers a permanent redirect to its
 *            canonical feed URL.
 *
 * `test.skip`s on a bare CI run (no `E2E_PORTAL_URL`), like the sibling
 * live-stand specs.
 */
const SLUG_LIVE = process.env.E2E_WEBINAR_SLUG_LIVE ?? "seed-005-live";

/** One guest feed read — the read `/webinars` renders from (019 EARS-12). */
interface FeedRead {
  data: {
    slug: string;
    title: string;
    recording?: { state: string; durationSec: number | null } | null;
  }[];
  counts: { upcoming: number; past: number };
  horizon: { remaining: number; nextBatch: number };
}

async function feedRead(page: Page, query: string): Promise<FeedRead> {
  const response = await page.request.get(`/v1/public/events?${query}`, {
    headers: { accept: "application/json" },
  });
  expect(response.ok(), `GET /v1/public/events?${query}`).toBe(true);
  return (await response.json()) as FeedRead;
}

/** «1 ч 05 мин» / «45 мин» — the card's recording length. */
function recordingLength(durationSec: number): string {
  const minutes = Math.max(1, Math.round(durationSec / 60));
  const hours = Math.floor(minutes / 60);
  return hours === 0
    ? `${minutes} мин`
    : `${hours} ч ${String(minutes % 60).padStart(2, "0")} мин`;
}

test.describe("the Academy feed view (wave-2 entry gate §2.4)", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual dev-stand gate",
  );

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("gate row 28: the head carries «Прошедшие | Будущие», «Будущие» by default, and the tense is URL state", async ({
    page,
  }) => {
    await page.goto("/webinars", { waitUntil: "load" });
    // The tense tabs are client-wired: a click before hydration lands on dead
    // markup and the URL never gains `?tense=past` (#3229, slot run).
    await page.waitForLoadState("networkidle");

    const tabs = page.getByTestId("events-tense-tabs");
    await expect(tabs.getByRole("tab")).toHaveText(["Прошедшие", "Будущие"]);
    await expect(tabs.getByRole("tab", { name: "Будущие" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URL(page.url()).searchParams.has("tense")).toBe(false);

    await tabs.getByRole("tab", { name: "Прошедшие" }).click();
    await expect(page).toHaveURL(/\/webinars\?tense=past$/);
    await expect(tabs.getByRole("tab", { name: "Прошедшие" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await tabs.getByRole("tab", { name: "Будущие" }).click();
    await expect(page).toHaveURL(/\/webinars$/);
  });

  test("gate rows 29–30: «Прошедшие» groups by month newest first and renders no archive block", async ({
    page,
  }) => {
    await page.goto("/webinars?tense=past", { waitUntil: "domcontentloaded" });

    const groups = page
      .getByTestId("events-feed")
      .locator('section[id^="day-"]');
    await expect(groups.first()).toBeVisible();
    const keys = await groups.evaluateAll((nodes) =>
      nodes.map((node) => node.id.slice("day-".length)),
    );
    // Month keys (`YYYY-MM`), strictly newest first.
    for (const key of keys) expect(key).toMatch(/^\d{4}-\d{2}$/);
    expect(keys).toEqual([...keys].sort().reverse());
    expect(new Set(keys).size).toBe(keys.length);

    await expect(page.getByText("Архив записей")).toHaveCount(0);
    // The live block belongs to «Будущие».
    await expect(page.locator('[data-feed-block="live"]')).toHaveCount(0);
  });

  test("gate rows 31–32: the bare `?tense=past` offers «Показать ещё N (осталось M)» off the past read, and step by step reaches every past эфир — no age floor — with a published recording reading «Запись · <length>» + «Смотреть запись»", async ({
    page,
  }) => {
    // 019 «Amendment — 2026-10-12»: the first screen is the 10 most recent
    // past эфиры (more only when the 10th one's day holds more); each step adds
    // the next 10, the last the remainder. The inputs are the stand's own past
    // read — the read the page renders from — not seed names (#3229).
    const first = await feedRead(page, "timeframe=past");
    expect(
      first.counts.past,
      "the stand carries a past season",
    ).toBeGreaterThan(10);
    // 019 «Amendment — 2026-10-12»: the first screen holds at least the 10
    // most recent past эфиры.
    expect(first.data.length).toBeGreaterThanOrEqual(10);

    await page.goto("/webinars?tense=past", { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    const cards = page
      .getByTestId("events-feed")
      .locator("[data-webinar-card]");
    await expect(cards).toHaveCount(first.data.length);
    const more = page.getByTestId("events-feed-show-more");
    await expect(more).toHaveText(
      `Показать ещё ${first.horizon.nextBatch} (осталось ${first.horizon.remaining})`,
    );

    let shown = first.data.length;
    for (
      let step = 0;
      step < Math.ceil(first.counts.past / 10) + 1;
      step += 1
    ) {
      if ((await more.count()) === 0) break;
      const before = page.url();
      await more.click();
      await expect(page).not.toHaveURL(before);
      await expect(page).toHaveURL(/[?&]from=\d{4}-\d{2}-\d{2}/);
      await expect(page).toHaveURL(/[?&]to=\d{4}-\d{2}-\d{2}/);
      await expect.poll(() => cards.count()).toBeGreaterThan(shown);
      shown = await cards.count();
    }
    // Every past эфир of the season is reachable, the oldest included.
    await expect(more).toHaveCount(0);
    await expect(cards).toHaveCount(first.counts.past);

    // Row 31 — the oldest published recording on the widened screen reads
    // «Запись · <length>» and offers «Смотреть запись» (a cut still being
    // prepared reads «Без записи»).
    const extent = new URL(page.url()).searchParams;
    const all = await feedRead(
      page,
      `timeframe=past&from=${extent.get("from")}&to=${extent.get("to")}`,
    );
    const recorded = all.data
      .filter(
        (card) =>
          card.recording &&
          card.recording.state !== "preparing" &&
          card.recording.durationSec !== null,
      )
      .at(-1);
    expect(
      recorded,
      "the past season carries a published recording",
    ).toBeDefined();
    // By slug: a title stem repeats across editions («… · выпуск 2»).
    const card = cards.filter({
      has: page.locator(`a[href="/webinars/${recorded!.slug}"]`),
    });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(
      `Запись · ${recordingLength(recorded!.recording!.durationSec!)}`,
    );
    await expect(
      card.getByRole("link", { name: "Смотреть запись" }),
    ).toBeVisible();
  });

  test("gate row 32: the bare `/webinars` holds the 10 nearest upcoming эфиры however far ahead — all of them at 11 or fewer — and offers «Показать ещё» only while more remain (019 LD-2, #2884)", async ({
    page,
  }) => {
    // 019 «Amendment — 2026-10-13»: «Будущие» pages by a count step of 10, not
    // a day horizon; with 11 or fewer matching events the tense shows them all
    // and no «Показать ещё». Expected counts come from the upcoming read the
    // page renders from (#3229: a slot's season holds dozens, a local seed a
    // handful).
    const read = await feedRead(page, "timeframe=upcoming");
    const total = read.counts.upcoming;
    expect(read.data.length).toBe(total <= 11 ? total : 10);
    expect(read.horizon.remaining).toBe(total - read.data.length);

    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    const cards = page
      .getByTestId("events-feed")
      .locator("[data-webinar-card]");
    await expect(page.getByTestId("events-feed")).toBeVisible();
    await expect(cards).toHaveCount(read.data.length);
    // «however far ahead»: the screen's last card is the read's 10th (or
    // last) event, whatever its distance from today.
    await expect(cards.last()).toContainText(read.data.at(-1)!.title);
    const more = page.getByTestId("events-feed-show-more");
    const { remaining } = read.horizon;
    if (remaining === 0) {
      await expect(more).toHaveCount(0);
    } else {
      // The step adds the next 10; when 11 or fewer remain, all of them.
      const step = remaining <= 11 ? remaining : 10;
      expect(read.horizon.nextBatch).toBe(step);
      await expect(more).toHaveText(
        `Показать ещё ${step} (осталось ${remaining})`,
      );
    }
  });

  test("gate rows 43, 50: the live block renders the experts-audience live event, between the head and the day feed", async ({
    page,
  }) => {
    // 019 «Amendment — 2026-10-05» «Live block» (019-requirements-en.md:329): at
    // most TWO strips, earliest start first, then «Ещё N в эфире →». A stand
    // with more live эфиры (a slot's golden season, #3229) need not show
    // SLUG_LIVE, so the expected strips are the live read's own head — the same
    // guest read the page renders from.
    const live = (await (
      await page.request.get("/v1/public/events/live", {
        headers: { accept: "application/json" },
      })
    ).json()) as { slug: string }[];
    expect(
      live.map((s) => s.slug),
      "the experts-audience live event is live",
    ).toContain(SLUG_LIVE);
    const first = live[0]!.slug;

    await page.goto("/webinars", { waitUntil: "domcontentloaded" });

    const block = page.getByTestId("events-live-block");
    await expect(block).toBeVisible();
    await expect(block.getByTestId("live-event-strip")).toHaveCount(
      Math.min(live.length, 2),
    );
    if (live.length > 2) {
      await expect(block).toContainText(`Ещё ${live.length - 2} в эфире →`);
    }
    const strip = block.getByTestId("live-event-strip").first();
    await expect(strip.getByTestId("live-event-strip-title")).toHaveAttribute(
      "href",
      `/webinars/${first}`,
    );
    // A guest's action leads to the event page, never into the room.
    await expect(strip.getByTestId("live-event-strip-action")).toHaveText(
      "Открыть страницу события",
    );
    await expect(block.locator('a[href$="/room"]')).toHaveCount(0);

    await expect(page.getByTestId("events-feed")).toBeVisible();
    const order = await page
      .locator("[data-feed-block]")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.feedBlock),
      );
    // «Мои события» is a signed-in reader's block; a guest reads the rest.
    expect(order).toEqual(["head", "live", "feed"]);
  });

  test("§4.3 D1: a legacy listing URL permanently redirects to its canonical feed URL", async ({
    page,
    request,
  }) => {
    const response = await request.get("/webinars?tab=past&cursor=x", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(308);
    const location = new URL(
      response.headers()["location"]!,
      "http://portal.test",
    );
    expect(`${location.pathname}${location.search}`).toBe(
      "/webinars?tense=past",
    );

    await page.goto("/webinars?tab=past&cursor=x", {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(/\/webinars\?tense=past$/);
    await expect(
      page
        .getByTestId("events-tense-tabs")
        .getByRole("tab", { name: "Прошедшие" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
