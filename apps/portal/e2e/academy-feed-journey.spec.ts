import { PublicFeedPageSchema } from "@ds/schemas";
import { expect, test, type Response } from "@playwright/test";

function isFeedRead(response: Response, cursor: string | null): boolean {
  const url = new URL(response.url());
  return (
    response.request().method() === "GET" &&
    url.pathname === "/v1/public/feed" &&
    url.searchParams.get("cursor") === cursor
  );
}

function isGoldenMaterial(href: string): boolean {
  return href.startsWith("/materials/golden-");
}

// live/academy/default supplies the published golden fixture marker.
test.skip(
  !process.env.E2E_PORTAL_URL || !process.env.E2E_MATERIAL_SLUG,
  "requires a live Academy portal with the golden feed seeded",
);

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

test("048 EARS-14/15: a guest reads Academy and Telegram cards, pages the feed and opens a material", async ({
  page,
}) => {
  const [firstResponse] = await Promise.all([
    page.waitForResponse((response) => isFeedRead(response, null)),
    page.goto("/", { waitUntil: "domcontentloaded" }),
  ]);
  expect(firstResponse.ok()).toBe(true);
  const firstPage = PublicFeedPageSchema.parse(await firstResponse.json());
  const firstMaterial = firstPage.data
    .filter((card) => card.kind !== "post")
    .find((card) => isGoldenMaterial(card.href));
  const telegram = firstPage.data.find(
    (card) =>
      card.kind === "post" && card.href.startsWith("https://t.me/bbm_academy_"),
  );
  if (!firstMaterial || !telegram || firstPage.nextCursor === null) {
    throw new Error(
      "The first golden feed page must mix materials and Telegram posts and have a next page.",
    );
  }

  const rail = page.getByRole("region", { name: /^Новости, блог и видео:/ });
  const cardLink = (href: string) => rail.locator(`a[href="${href}"]`);
  const ownCard = cardLink(firstMaterial.href);
  const telegramCard = cardLink(telegram.href);
  await expect(ownCard).toBeVisible();
  await expect(ownCard).toContainText(firstMaterial.title);
  await expect(telegramCard).toBeVisible();
  await expect(telegramCard).toContainText("BBM Academy · Telegram");
  await expect(telegramCard).toHaveAttribute("target", "_blank");

  const next = page.getByRole("button", {
    name: "Дальше, к более ранним материалам",
  });
  const [nextResponse] = await Promise.all([
    page.waitForResponse((response) =>
      isFeedRead(response, firstPage.nextCursor),
    ),
    next.click(),
  ]);
  expect(nextResponse.ok()).toBe(true);
  await expect
    .poll(() => rail.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);

  const nextPage = PublicFeedPageSchema.parse(await nextResponse.json());
  const laterMaterial = nextPage.data
    .filter((card) => card.kind !== "post")
    .find(
      (card) =>
        isGoldenMaterial(card.href) &&
        !firstPage.data.some((firstCard) => firstCard.href === card.href),
    );
  if (!laterMaterial) {
    throw new Error(
      "The next golden feed page must contain a new Academy material.",
    );
  }

  const laterCard = cardLink(laterMaterial.href);
  await expect(laterCard).toBeVisible();
  await expect(laterCard).toContainText(laterMaterial.title);
  await laterCard.click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(laterMaterial.href);
  const article = page.getByRole("article");
  await expect(
    article.getByRole("heading", {
      level: 1,
      name: laterMaterial.title,
      exact: true,
    }),
  ).toBeVisible();
  await expect(article.locator("p").first()).toBeVisible();
});
