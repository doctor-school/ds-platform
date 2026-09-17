import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

test("EARS-11: the upcoming week to month round-trip preserves facet state", async ({
  page,
}) => {
  await page.goto(`${BASE}/webinars?specialty=cardiology`);
  await expect(
    page.getByRole("tab", { name: /Расписание · \d+/ }),
  ).toHaveAttribute("aria-selected", "true");

  await page.getByRole("link", { name: /Месяц/ }).click();
  await expect(page).toHaveURL(/view=month/);
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
  await expect(page).toHaveURL(/specialty=cardiology/);

  await page
    .getByTestId("month-toolbar")
    .getByRole("link", { name: /Неделя/ })
    .click();
  await expect(page).not.toHaveURL(/view=month/);
  await expect(page).toHaveURL(/specialty=cardiology/);
  expect(new URL(page.url()).searchParams.get("month")).toBe(pagedMonth);
  await expect(
    page.getByRole("tab", { name: /Расписание · \d+/ }),
  ).toHaveAttribute("aria-selected", "true");
});
