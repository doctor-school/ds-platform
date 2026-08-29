import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const PAST_SLUG = process.env.E2E_PAST_WEBINAR_SLUG;

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

test("EARS-11: /webinars tabs persist archive and calendar state in the URL", async ({
  page,
}) => {
  await page.goto(`${BASE}/webinars?view=week&specialty=cardiology`);
  const upcoming = page.getByRole("tab", { name: /Предстоящие · \d+/ });
  const past = page.getByRole("tab", { name: /Прошедшие · \d+/ });
  await expect(upcoming).toHaveAttribute("aria-selected", "true");
  await past.click();
  await expect(page).toHaveURL(/tab=past/);
  await expect(page).toHaveURL(/specialty=cardiology/);
  await page.reload();
  await expect(past).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(upcoming).toHaveAttribute("aria-selected", "true");

  await page.getByRole("link", { name: /Месяц/ }).click();
  await expect(page).toHaveURL(/view=month/);
  await expect(page).toHaveURL(/specialty=cardiology/);
});

test("EARS-11: a past card navigates to its post-live page", async ({
  page,
}) => {
  test.skip(!PAST_SLUG, "requires a seeded ended event");
  await page.goto(`${BASE}/webinars?tab=past`);
  await expect(
    page.locator(`[data-webinar-card] a[href="/webinars/${PAST_SLUG}"]`),
  ).toBeVisible();
  await page.locator(`a[href="/webinars/${PAST_SLUG}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/webinars/${PAST_SLUG}$`));
});
