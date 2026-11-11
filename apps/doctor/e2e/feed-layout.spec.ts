import { expect, test } from "@playwright/test";

/**
 * 018 EARS-1 (#1496) — the specialty feed route `doctor.school/feed/<code>`
 * inside 017's shell. The upstream is the events tier's stand-in
 * `e2e/support/doctor-events-api.mjs`, which answers the `SpecialtyFeed`
 * envelope with the release-1 connected types (events, value, adjacent) for one specialty and
 * a 404 Problem for any other code; the envelope's composition rule itself is
 * proven against the real service in
 * `apps/api/test/storefront/specialty-feed.e2e-spec.ts`.
 */
const CODE = "travmatologiya-i-ortopediya";
const FEED = `/feed/${CODE}`;

test("EARS-1: the feed renders inside 017's shell — the shell's ONE header and ONE footer, none of the feed's own", async ({
  page,
}) => {
  await page.goto(FEED);
  const feed = page.getByTestId("specialty-feed");
  await expect(feed).toBeVisible();

  await expect(page.getByTestId("storefront-header")).toHaveCount(1);
  await expect(page.getByTestId("storefront-footer")).toHaveCount(1);
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator("footer")).toHaveCount(1);
  // The feed defines no chrome of its own.
  await expect(feed.locator("header, footer")).toHaveCount(0);
});

test("EARS-1: breadcrumbs and the specialty heading carrying «сменить специальность», which re-opens 017's catalog", async ({
  page,
}) => {
  await page.goto(FEED);
  const crumbs = page.getByTestId("specialty-feed-breadcrumbs");
  await expect(crumbs).toContainText("Doctor.School");
  await expect(crumbs).toContainText("Специальности");
  await expect(
    page.getByRole("heading", { level: 1, name: "Травматология и ортопедия" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const change = page.getByTestId("specialty-feed-change");
  await expect(change).toHaveText("сменить специальность ▾");
  await expect(change).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("specialty-feed-catalog")).toHaveCount(0);
  await change.click();
  await expect(change).toHaveAttribute("aria-expanded", "true");
  // The SAME 017 catalog the home mounts: its search field answers input.
  const catalog = page.getByTestId("specialty-feed-catalog");
  const search = catalog.getByRole("searchbox").first();
  await expect(search).toBeVisible();
  await search.fill("Кардио");
  await expect(search).toHaveValue("Кардио");
  await change.click();
  await expect(page.getByTestId("specialty-feed-catalog")).toHaveCount(0);
});

test("EARS-1: only the connected blocks are in the DOM, events first — no heading, placeholder or empty shell for a type that is not connected, and no personalisation claim", async ({
  page,
}) => {
  await page.goto(FEED);
  const slots = page.locator("[data-feed-block-slot]");
  await expect(slots).toHaveCount(3);
  await expect(slots.nth(0)).toHaveAttribute("data-feed-block-slot", "events");
  await expect(slots.nth(1)).toHaveAttribute("data-feed-block-slot", "value");
  await expect(slots.nth(2)).toHaveAttribute(
    "data-feed-block-slot",
    "adjacent",
  );

  const text = await page.getByTestId("specialty-feed").innerText();
  for (const absent of [
    /Школы и курсы/,
    /Уроки/,
    /Топ по специальности/,
    /Сообщества/,
    /Готовится/,
    /скоро/i,
    /на основе ваших данных/i,
  ]) {
    expect(text, String(absent)).not.toMatch(absent);
  }
});

test("EARS-1: a feed address naming no specialty of the book is an honest not-found with the way to the choice — never a crash", async ({
  page,
}) => {
  const response = await page.goto("/feed/no-such-specialty");
  expect(response?.status()).toBe(404);
  const notFound = page.getByTestId("specialty-feed-not-found");
  await expect(notFound).toContainText("Такой специальности нет");
  await expect(
    notFound.getByRole("link", { name: "Выбрать специальность" }),
  ).toHaveAttribute("href", "/");
  // Still inside the shell.
  await expect(page.getByTestId("storefront-header")).toHaveCount(1);
});
