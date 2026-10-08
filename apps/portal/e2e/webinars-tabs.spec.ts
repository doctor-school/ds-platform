import { expect, test } from "@playwright/test";

/**
 * 004 EARS-11 — the feed ↔ month round-trip on the Academy mount keeps the tense
 * and every applied facet on the ONE codec (gate §2.5 row 51, §4.3 D1). An
 * unknown topic slug is a valid facet value (empty result, not a 400), so the
 * round-trip is seed-independent.
 */
const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");
test.use({ viewport: { width: 1440, height: 900 } });

const tab = (page: import("@playwright/test").Page, name: string) =>
  page.getByTestId("events-tense-tabs").getByRole("tab", { name });

test("EARS-11: the feed to month round-trip preserves tense and facet state", async ({
  page,
}) => {
  await page.goto(`${BASE}/webinars?tense=past&topic=kardiologiya`);
  await expect(tab(page, "Прошедшие")).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("events-view-switch").click();
  await expect(page).toHaveURL(/view=month/);
  await expect(page).toHaveURL(/topic=kardiologiya/);

  const firstMonth = new URL(page.url()).searchParams.get("month");
  const next = page.getByTestId("month-next");
  const targetMonth = new URL((await next.getAttribute("href"))!, BASE).searchParams.get(
    "month",
  );
  expect(targetMonth).toBeTruthy();
  expect(targetMonth).not.toBe(firstMonth);
  await next.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("month")).toBe(targetMonth);
  await expect(page).toHaveURL(/topic=kardiologiya/);

  await page.getByTestId("events-view-switch").click();
  await expect(page).not.toHaveURL(/view=month/);
  await expect(page).toHaveURL(/topic=kardiologiya/);
  await expect(page).toHaveURL(/tense=past/);
  expect(new URL(page.url()).searchParams.get("month")).toBe(targetMonth);
  await expect(tab(page, "Прошедшие")).toHaveAttribute("aria-selected", "true");
});
