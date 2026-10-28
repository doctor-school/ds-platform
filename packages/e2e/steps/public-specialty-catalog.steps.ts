import { expect, type Page } from "@playwright/test";

import { baseUrlFor, type HostConfig } from "../hosts.js";
import { Given, Then, When } from "./support/fixtures.js";

type Specialty = {
  id: string;
  code: string;
  name: string;
  isOther: boolean;
};
type Book = { entries: Specialty[]; total: number };
const NO_MATCH_QUERY = "щщщфывапролдж";

function catalog(page: Page) {
  return page.getByTestId("specialty-catalog");
}
function search(page: Page) {
  return page.getByRole("searchbox", {
    name: "Поиск специальности",
    exact: true,
  });
}
async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), path).toBe(200);
  return response.json() as Promise<T>;
}
async function book(page: Page): Promise<Book> {
  const result = await read<Book>(page, "/v1/public/specialties");
  expect(result.entries.length).toBeGreaterThan(0);
  expect(result.total).toBe(result.entries.length);
  expect(result.entries.some((entry) => entry.isOther)).toBe(true);
  return result;
}
async function open(page: Page, host: HostConfig): Promise<void> {
  const origin = new URL(baseUrlFor(host)).origin;
  const response = await page.goto(`${origin}/`, { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(
    (url) => url.origin === origin && url.pathname === "/",
  );
  await expect(page.getByTestId("storefront-hero")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // 017 EARS-4/5: server markup can precede the catalog's client handlers.
  await page.waitForLoadState("networkidle");
  await expect(catalog(page)).toHaveAttribute("data-state", "open");
  await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
}
async function entries(page: Page, expected: Specialty[]): Promise<void> {
  const chips = catalog(page).getByTestId("specialty-entry");
  await expect(chips).toHaveCount(expected.length);
  await expect
    .poll(() =>
      chips.evaluateAll((nodes) =>
        nodes.map((node) => ({
          code: node.getAttribute("data-code"),
          name: node.textContent?.trim(),
        })),
      ),
    )
    .toEqual(expected.map(({ code, name }) => ({ code, name })));
}
async function noMatch(page: Page): Promise<void> {
  await search(page).fill(NO_MATCH_QUERY);
  await expect(catalog(page)).toHaveAttribute("data-state", "nomatch");
  await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(catalog(page).getByTestId("specialty-entry")).toHaveCount(0);
}
async function expand(page: Page, expected: Book): Promise<void> {
  await page.getByTestId("specialty-expand").click();
  await expect(catalog(page)).toHaveAttribute("data-state", "expanded");
  await expect(page.getByTestId("specialty-expand")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await entries(page, expected.entries);
  const other = expected.entries.find((entry) => entry.isOther);
  expect(other).toBeDefined();
  await expect(
    catalog(page).getByRole("button", { name: other!.name, exact: true }),
  ).toBeVisible();
}

async function pageRemainsReachable(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      return (
        body.overflow === "hidden" ||
        root.overflow === "hidden" ||
        body.position === "fixed"
      );
    }),
    "017 EARS-4: choosing a specialty must not lock the page",
  ).toBe(false);
  const hero = page.getByTestId("storefront-hero");
  const footer = page.getByTestId("storefront-footer");
  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toBeInViewport();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    ),
  ).toBe(true);
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
}

Given(
  "a guest uses the configured Doctor specialty catalog",
  async ({ page, host }) => {
    expect(host.id).toBe("doctor");
    await page.context().clearCookies();
  },
);

Given("a visitor with no chosen specialty", async ({ page }) => {
  await page.context().clearCookies();
});

When("they open the storefront home page", async ({ page, host }) => {
  await open(page, host);
});

When(
  "they open the storefront home page and scroll to the footer",
  async ({ page, host }) => {
    await open(page, host);
    await page.getByTestId("storefront-footer").scrollIntoViewIfNeeded();
  },
);

Then(
  "the existing hero and footer stay readable without a specialty choice",
  async ({ page }) => {
    await pageRemainsReachable(page);
  },
);

Then(
  "no modal gate, interstitial, scroll lock or empty page appears at any point",
  async ({ page }) => {
    const served = await book(page);
    await expect(catalog(page)).toHaveAttribute("data-state", "open");
    await pageRemainsReachable(page);

    await expand(page, served);
    await pageRemainsReachable(page);

    const target = served.entries.find((entry) => !entry.isOther)!;
    const expected = await read<Book>(
      page,
      `/v1/public/specialties/search?q=${encodeURIComponent(target.name)}`,
    );
    expect(expected.entries.some((entry) => entry.id === target.id)).toBe(true);
    await search(page).fill(target.name);
    await expect(catalog(page)).toHaveAttribute("data-state", "filtered");
    await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
    await entries(page, expected.entries);
    await pageRemainsReachable(page);

    await noMatch(page);
    await pageRemainsReachable(page);
  },
);

Then(
  "the catalog renders a labelled search field over the whole list as its hero element",
  async ({ page }) => {
    await expect(search(page)).toBeVisible();
    await expect(search(page)).toHaveAttribute(
      "placeholder",
      "Начните вводить название",
    );
    await expect(catalog(page)).toHaveAttribute(
      "data-total",
      String((await book(page)).total),
    );
  },
);

Then("the frequent specialties render beneath it", async ({ page }) => {
  const frequent = await read<{ entries: Specialty[] }>(
    page,
    "/v1/public/specialties/frequent",
  );
  expect(frequent.entries.length).toBeGreaterThan(0);
  await expect(
    catalog(page).getByText("Частые специальности", { exact: true }),
  ).toBeVisible();
  await entries(page, frequent.entries);
  const field = await search(page).boundingBox();
  const firstChip = await catalog(page)
    .getByTestId("specialty-entry")
    .first()
    .boundingBox();
  expect(field).not.toBeNull();
  expect(firstChip).not.toBeNull();
  expect(firstChip!.y).toBeGreaterThan(field!.y + field!.height);
});

Then(
  "a «Показать весь список — N» control, N rendered from the actual book size, reveals the remainder including «Другое»",
  async ({ page }) => {
    const served = await book(page);
    const control = page.getByTestId("specialty-expand");
    await expect(control).toHaveText(`Показать весь список — ${served.total}`);
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await expand(page, served);
  },
);

Then(
  "the list is never presented as a bare full-length scroll",
  async ({ page }) => {
    const list = catalog(page).getByTestId("specialty-entries");
    await expect(list).toHaveCSS("flex-wrap", "wrap");
    expect(
      await list.evaluate((node) => getComputedStyle(node).overflowY),
    ).not.toMatch(/^(auto|scroll)$/u);
    await page.getByTestId("specialty-expand").click();
    await expect(catalog(page)).toHaveAttribute("data-state", "open");
    const frequent = await read<{ entries: Specialty[] }>(
      page,
      "/v1/public/specialties/frequent",
    );
    await entries(page, frequent.entries);
  },
);

Given("a visitor on the open catalog", async ({ page, host }) => {
  await open(page, host);
});

When("they type a fragment that matches no entry", async ({ page }) => {
  const response = await read<Book>(
    page,
    `/v1/public/specialties/search?q=${encodeURIComponent(NO_MATCH_QUERY)}`,
  );
  expect(response.total).toBe(0);
  expect(response.entries).toEqual([]);
  await noMatch(page);
});

Then(
  "the catalog states in plain Russian that nothing was found",
  async ({ page }) => {
    await expect(page.getByTestId("specialty-no-match")).toHaveText(
      "Ничего не найдено. Проверьте написание или выберите «Другое».",
    );
  },
);

Then("the typed query remains in the field and editable", async ({ page }) => {
  await expect(search(page)).toHaveValue(NO_MATCH_QUERY);
  await expect(search(page)).toBeEditable();
  const served = await book(page);
  const target = served.entries.find((entry) => !entry.isOther)!;
  const query = target.name;
  const expected = await read<Book>(
    page,
    `/v1/public/specialties/search?q=${encodeURIComponent(query)}`,
  );
  expect(expected.entries.some((entry) => entry.id === target.id)).toBe(true);
  await search(page).fill(query);
  await expect(catalog(page)).toHaveAttribute("data-state", "filtered");
  await expect(catalog(page)).not.toHaveAttribute("aria-busy", "true");
  await entries(page, expected.entries);
});

Then("«Другое» remains reachable", async ({ page }) => {
  await noMatch(page);
  await expand(page, await book(page));
  await expect(search(page)).toHaveValue("");
});
