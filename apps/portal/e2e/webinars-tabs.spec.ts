import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const PAST_SLUG = process.env.E2E_PAST_WEBINAR_SLUG;

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

test("EARS-11: week to month paging to week preserves tab and facet state", async ({
  page,
}) => {
  await page.goto(`${BASE}/webinars?tab=past&specialty=cardiology`);
  const past = page.getByRole("tab", { name: /Прошедшие · \d+/ });
  await expect(past).toHaveAttribute("aria-selected", "true");

  await page.getByRole("link", { name: /Месяц/ }).click();
  await expect(page).toHaveURL(/view=month/);
  await expect(page).toHaveURL(/tab=past/);
  await expect(page).toHaveURL(/specialty=cardiology/);

  const firstMonth = new URL(page.url()).searchParams.get("month");
  const nextMonthLink = page.getByRole("link", { name: /Следующий месяц/ });
  const nextMonthHref = await nextMonthLink.getAttribute("href");
  const targetMonth = new URL(nextMonthHref!, BASE).searchParams.get("month");
  expect(targetMonth).toBeTruthy();
  expect(targetMonth).not.toBe(firstMonth);
  await nextMonthLink.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("month"))
    .toBe(targetMonth);
  const pagedMonth = new URL(page.url()).searchParams.get("month");
  expect(pagedMonth).not.toBe(firstMonth);
  await expect(page).toHaveURL(/tab=past/);
  await expect(page).toHaveURL(/specialty=cardiology/);

  await page
    .getByTestId("month-toolbar")
    .getByRole("link", { name: /Неделя/ })
    .click();
  await expect(page).not.toHaveURL(/view=month/);
  await expect(page).toHaveURL(/tab=past/);
  await expect(page).toHaveURL(/specialty=cardiology/);
  expect(new URL(page.url()).searchParams.get("month")).toBe(pagedMonth);
  await expect(
    page.getByRole("tab", { name: /Прошедшие · \d+/ }),
  ).toHaveAttribute("aria-selected", "true");
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
