import { mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  removeTelegramRailSources,
  seedTelegramRailSource,
} from "./support/feed-posts";

/**
 * 048 V-22 (#3997, EARS-33…EARS-35) — the Telegram post card in the Academy
 * home rail on the REAL Academy storefront → NestJS → Postgres path: a visitor
 * sees the posts of a switched-on Telegram source as cards among the own
 * materials, newest first — the text, the copied preview (with the play mark
 * and the duration for a video), the no-image layout with «Telegram» when no
 * preview was copied, «BBM Academy · Telegram» with the chip «TG», «Telegram ↗»
 * — each card one link to its `t.me` permalink in a new tab with
 * `rel="noopener noreferrer"`; a hidden post and the posts of a switched-off
 * source are absent; the source is failing (Telegram unreachable) and the rail
 * still shows its cards with no error state; axe finds nothing in the rail.
 *
 * The stand's API has no bot token, so its update poller never runs (048
 * EARS-24): the posts are stored as the connector stores them
 * (`support/feed-posts.ts`); the update → entry mapping is proven against the
 * Telegram double by the API e2e (V-15, V-18).
 *
 * Runs in the `admin-e2e` job's flows tier (`playwright.flows.config.ts`)
 * against the job's Academy storefront `E2E_PORTAL_URL` and database
 * `DATABASE_URL`. `E2E_SHOT_DIR` opts into the desktop/mobile × light/dark
 * captures the PR body cites; `E2E_FEED_PREVIEW_KEY` names a stored object to
 * use as the copied preview (the captures need one that loads — the job's
 * fresh bucket holds none, so there the image cards assert the signed preview
 * address and not its pixels).
 */
const PORTAL = process.env.E2E_PORTAL_URL;
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const PREVIEW_KEY =
  process.env.E2E_FEED_PREVIEW_KEY ?? "e2e/048/tg-preview.webp";
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const RAIL_NAME =
  "Новости, блог и видео: листайте влево и вправо, стрелки клавиатуры — по одной карточке";
const NEW_TAB = ", откроется в новой вкладке на площадке Telegram";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A run-unique, pattern-valid channel username (EARS-21). */
const RUN = Date.now().toString(36);
const ON = `rail${RUN}`;
const OFF = `railoff${RUN}`;

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

const POSTS = {
  image: {
    messageId: 1201,
    text: "Сегодня в 19:00 МСК — эфир о показаниях к PRP",
  },
  video: { messageId: 1202, text: "PRP при гонартрозе — фрагмент эфира" },
  none: { messageId: 1211, text: "Новый набор в программу" },
  longVideo: {
    messageId: 1212,
    text: "Запись разбора клинических случаев целиком",
  },
  hidden: { messageId: 1213, text: "Скрытый администратором пост" },
} as const;
const OFF_POST = { messageId: 1301, text: "Пост выключенного источника" };

const sourceIds: string[] = [];

test.beforeAll(async () => {
  if (!PORTAL)
    throw new Error("E2E_PORTAL_URL must name the Academy storefront");
  const on = await seedTelegramRailSource(
    ON,
    { enabled: true, failing: true },
    [
      { ...POSTS.image, at: minutesAgo(1), imageRef: PREVIEW_KEY },
      {
        ...POSTS.video,
        at: minutesAgo(2),
        imageRef: PREVIEW_KEY,
        durationSeconds: 72,
      },
      { ...POSTS.none, at: minutesAgo(3) },
      { ...POSTS.longVideo, at: minutesAgo(4), durationSeconds: 3725 },
      { ...POSTS.hidden, at: minutesAgo(5), hidden: true },
    ],
  );
  const off = await seedTelegramRailSource(
    OFF,
    { enabled: false, failing: false },
    [{ ...OFF_POST, at: minutesAgo(1) }],
  );
  sourceIds.push(on.sourceId, off.sourceId);
});

test.afterAll(async () => {
  await removeTelegramRailSources(sourceIds);
});

function card(rail: Locator, address: string, messageId: number): Locator {
  return rail.locator(`a[href="https://t.me/${address}/${messageId}"]`);
}

async function openRail(page: Page): Promise<Locator> {
  await page.goto(`${PORTAL}/`);
  const rail = page.getByRole("region", { name: RAIL_NAME });
  await expect(card(rail, ON, POSTS.image.messageId)).toBeVisible();
  return rail;
}

async function expectRail(page: Page, rail: Locator): Promise<void> {
  // Newest first: the four visible posts in their publication order.
  const hrefs = await rail
    .locator(`a[href^="https://t.me/${ON}/"]`)
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual(
    [POSTS.image, POSTS.video, POSTS.none, POSTS.longVideo].map(
      (p) => `https://t.me/${ON}/${p.messageId}`,
    ),
  );
  // Among the own materials: the same rail, one link per card.
  await expect(rail.locator("[data-slot] > a").first()).toBeVisible();

  const image = card(rail, ON, POSTS.image.messageId);
  await expect(image).toContainText(POSTS.image.text);
  await expect(image).toContainText("BBM Academy · Telegram");
  await expect(image.getByRole("img", { name: "Telegram" })).toHaveText("TG");
  await expect(image).toContainText(`Telegram ↗︎${NEW_TAB}`);
  await expect(image).toHaveAttribute("target", "_blank");
  await expect(image).toHaveAttribute("rel", "noopener noreferrer");
  // The copied preview, signed at the read (the logo avatar is the other img).
  await expect(image.locator(`img[src*="${PREVIEW_KEY}"]`)).toHaveCount(1);
  await expect(image.locator("[data-feed-card-play]")).toHaveCount(0);

  const video = card(rail, ON, POSTS.video.messageId);
  await expect(video).toContainText(POSTS.video.text);
  await expect(video.locator("[data-feed-card-play]")).toHaveText("▶︎");
  await expect(video.locator("[data-feed-card-duration]")).toHaveText("1:12");

  const none = card(rail, ON, POSTS.none.messageId);
  await expect(none.locator('[data-feed-card-media="none"]')).toHaveText(
    "Telegram",
  );
  await expect(none.locator(`img[src*="${PREVIEW_KEY}"]`)).toHaveCount(0);

  // A video with no copied preview takes the plain no-image layout.
  const longVideo = card(rail, ON, POSTS.longVideo.messageId);
  await expect(longVideo.locator('[data-feed-card-media="none"]')).toHaveText(
    "Telegram",
  );
  await expect(longVideo.locator("[data-feed-card-play]")).toHaveCount(0);

  // Nothing plays inside the Academy.
  await expect(rail.locator("video, audio, iframe")).toHaveCount(0);

  // A hidden post and a switched-off source's posts are absent.
  await expect(card(rail, ON, POSTS.hidden.messageId)).toHaveCount(0);
  await expect(rail.locator(`a[href^="https://t.me/${OFF}/"]`)).toHaveCount(0);

  // The source is failing (Telegram unreachable): no error state in the rail.
  await expect(page.getByText("Не удалось загрузить новости.")).toHaveCount(0);
}

async function setPalette(page: Page, palette: "light" | "dark") {
  await page.emulateMedia({ colorScheme: palette });
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, palette);
}

test.describe("048 EARS-33 / EARS-34 / EARS-35 — Telegram cards in the Academy rail", () => {
  for (const [width, size] of [
    ["desktop", WIDE],
    ["mobile", NARROW],
  ] as const) {
    test(`048 EARS-33: a visitor sees the Telegram posts as cards in the rail, each a new-tab link to t.me (${width})`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      const rail = await openRail(page);
      await expectRail(page, rail);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      if (!SHOT_DIR) return;
      await mkdir(SHOT_DIR, { recursive: true });
      await rail.scrollIntoViewIfNeeded();
      // The captures need the copied preview to have loaded.
      await expect
        .poll(() =>
          card(rail, ON, POSTS.image.messageId)
            .locator(`img[src*="${PREVIEW_KEY}"]`)
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
        )
        .toBe(true);
      for (const palette of ["light", "dark"] as const) {
        await setPalette(page, palette);
        await page.locator('[data-academy-section="feed"]').screenshot({
          path: path.join(SHOT_DIR, `ev3997-rail-${width}-${palette}.png`),
          // A local `next dev` storefront paints its dev-tools pill over
          // the page; it is not part of the Academy.
          style: "nextjs-portal { display: none !important; }",
        });
      }
    });
  }

  test("048 EARS-34: the rail with Telegram cards has no axe violation, light and dark", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await openRail(page);
    for (const palette of ["light", "dark"] as const) {
      await setPalette(page, palette);
      const results = await new AxeBuilder({ page })
        .include('[data-academy-section="feed"]')
        .withTags(WCAG_TAGS)
        .analyze();
      expect(
        results.violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.flatMap((node) => node.target),
        })),
      ).toEqual([]);
    }
  });

  for (const [width, size] of [
    ["desktop", WIDE],
    ["mobile", NARROW],
  ] as const) {
    test(`048 EARS-37: the whole Academy home carrying Telegram cards has no axe violation, light and dark (${width})`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await openRail(page);
      for (const palette of ["light", "dark"] as const) {
        await setPalette(page, palette);
        const results = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          // The two leaf exclusions every full-page Academy scan carries
          // (`materials-reading-page.spec.ts`): #2189 — the shared shell's BBM
          // topbar keeps the owner-accepted canvas contrast; #1692 — open
          // defect, the Academy footer wordmark contrast. Every other node of
          // the home stays in the scan.
          .exclude('[data-testid="shell-topbar"]')
          .exclude('[data-testid="academy-footer-wordmark"]')
          .analyze();
        expect(
          results.violations.map((violation) => ({
            id: violation.id,
            nodes: violation.nodes.flatMap((node) => node.target),
          })),
          `axe violations on the Academy home (${width}, ${palette})`,
        ).toEqual([]);
      }
    });
  }

  test("048 EARS-34: the card is one keyboard-reachable link that opens t.me in a new tab", async ({
    page,
    context,
  }) => {
    await page.setViewportSize(WIDE);
    const rail = await openRail(page);
    const image = card(rail, ON, POSTS.image.messageId);
    await image.focus();
    await expect(image).toBeFocused();
    // The original opens in a new tab; t.me itself is never fetched here.
    await context.route("https://t.me/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>t.me</title>" }),
    );
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      page.keyboard.press("Enter"),
    ]);
    expect(tab.url()).toBe(`https://t.me/${ON}/${POSTS.image.messageId}`);
    expect(page.url()).toBe(`${PORTAL}/`);
    await tab.close();
  });
});
