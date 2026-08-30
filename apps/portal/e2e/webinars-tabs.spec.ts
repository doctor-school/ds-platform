import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const PAST_SLUG = process.env.E2E_PAST_WEBINAR_SLUG;

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

test("EARS-11: a past card navigates to its post-live page", async ({
  page,
}) => {
  test.skip(!PAST_SLUG, "requires a seeded ended event");
  await page.goto(`${BASE}/webinars?tab=past`);
  await expect(page.getByTestId("event-list-tabs")).toBeVisible();
  await expect(page.getByTestId("week-toolbar")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Неделя" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Месяц" })).toHaveCount(0);
  // EventList renders one mobile band and one desktop rule label for the same
  // month; CSS selects the visible composition at the active breakpoint.
  await expect(page.getByText(/^\p{L}+ 20\d{2}$/u)).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: "Смотреть запись ↗" }).first(),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Смотреть запись ↗" })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/webinars/${PAST_SLUG}$`));
});
