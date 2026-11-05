import { expect, test, type Page } from "@playwright/test";

/**
 * Residual 017 EARS-1 transport boundaries after the canonical choice and
 * remembered-header originals moved to packages/e2e (#3751). The upstream is
 * the events tier's fixed stand-in `e2e/support/doctor-events-api.mjs`, which
 * serves a feed envelope for every entry of its book and the guest half of the
 * choose/change contract (`/v1/public/specialty-choice`).
 *
 * The `__Host-` prefix is https-only in Chromium and this tier serves http, so
 * a REMEMBERED specialty rides a request header — exactly what the `/feed`
 * route reads and relays (`home-events.spec.ts`'s idiom). A choice made in the
 * page needs no cookie at all: the feed it opens is the one the command's
 * answer names.
 */
const CARDIOLOGY_ID = "00000000-0000-4000-8000-000000000001";
function myFeed(page: Page) {
  return page
    .getByTestId("shell-nav-desktop")
    .getByRole("link", { name: "Моя лента" });
}

async function expectFeedOf(page: Page, code: string, name: string) {
  await expect(page).toHaveURL(new RegExp(`/feed/${code}$`));
  await expect(page.locator('[data-surface="specialty-feed"]')).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
}

test("017 EARS-1: «Моя лента» with a different remembered specialty follows THAT choice", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    cookie: `__Host-ds_specialty=${CARDIOLOGY_ID}`,
  });
  await page.goto("/feed");

  await expectFeedOf(page, "kardiologiya", "Кардиология");
});

test("017 EARS-1: «Моя лента» with nothing chosen opens the home specialty catalog, never an empty feed", async ({
  page,
}) => {
  await page.goto("/events");
  await myFeed(page).click();

  await expect(page).toHaveURL(/\/#specialties$/);
  const catalog = page.locator("#specialties");
  await expect(catalog).toHaveAttribute("data-testid", "specialty-catalog");
  await expect(catalog).toHaveAttribute("data-state", "open");
  await expect(catalog).toBeInViewport();
  await expect(page.locator('[data-surface="specialty-feed"]')).toHaveCount(0);
});
