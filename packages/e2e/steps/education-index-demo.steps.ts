import { expect, type Locator, type Page } from "@playwright/test";

import { baseUrlFor } from "../hosts.js";
import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

type State = { before: (string | null)[]; target: number };
const states = new WeakMap<StepWorld, State>();
const weeks = [1, 2, 3, 4] as const;
// 045 EARS-2/6/7: independent expectations for the canonical fictional fixture.
const organizations = [
  {
    name: "Карталис Фарма",
    investmentShare: 25,
    attentionShare: 22,
    index: 100,
  },
  { name: "Велтора Фарм", investmentShare: 20, attentionShare: 17, index: 79 },
  {
    name: "Ортелла Биотех",
    investmentShare: 15,
    attentionShare: 19,
    index: 72,
  },
  {
    name: "Фортакс Биофарм",
    investmentShare: 11,
    attentionShare: 12,
    index: 49,
  },
  { name: "Эвкрит Фарма", investmentShare: 9, attentionShare: 8, index: 36 },
  {
    name: "Претона Биосистемс",
    investmentShare: 5,
    attentionShare: 7,
    index: 26,
  },
  { name: "Калинта Медтех", investmentShare: 4, attentionShare: 5, index: 19 },
  { name: "Селмира Фарма", investmentShare: 3.5, attentionShare: 3, index: 14 },
  {
    name: "Острана Медтех",
    investmentShare: 2.5,
    attentionShare: 3,
    index: 12,
  },
  { name: "Кверион Фарма", investmentShare: 2, attentionShare: 2, index: 9 },
  {
    name: "Имбрель Медикал",
    investmentShare: 1.5,
    attentionShare: 1.5,
    index: 6,
  },
  {
    name: "Равестра Медтех",
    investmentShare: 1.5,
    attentionShare: 0.5,
    index: 4,
  },
] as const;
const weeklySeries: Record<string, Record<1 | 2 | 3 | 4, number>> = {
  "Карталис Фарма": { 1: 100, 2: 100, 3: 100, 4: 100 },
  "Велтора Фарм": { 1: 84, 2: 82, 3: 80, 4: 79 },
  "Ортелла Биотех": { 1: 38, 2: 43, 3: 47, 4: 72 },
};
const INDEX_LAUNCH = "1 сентября 2026";
const ortella = organizations.find((org) => org.name === "Ортелла Биотех")!;

function rows(page: Page) {
  return page.getByTestId("leaderboard-table").getByRole("button");
}
function row(page: Page, name: string) {
  return rows(page).filter({ hasText: name });
}
async function vector(page: Page) {
  return rows(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-expanded")),
  );
}
async function detail(page: Page, button: Locator) {
  const id = await button.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  return page.locator(`[id=${JSON.stringify(id)}]`);
}
async function bars(page: Page, button: Locator, name: string) {
  const org = organizations.find((entry) => entry.name === name)!;
  const panel = await detail(page, button);
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("sub-bar")).toHaveCount(2);
  await expect(panel).toContainText("Инвестиции в образование");
  await expect(panel).toContainText("Внимание врачей");
  await expect(panel).toContainText(`${org.investmentShare}% всех инвестиций`);
  await expect(panel).toContainText(`${org.attentionShare}% всего внимания`);
}
async function open(page: Page, origin: string) {
  expect(
    (
      await page.goto(`${origin}/education-index`, { waitUntil: "networkidle" })
    )?.status(),
  ).toBe(200);
  await expect(page).toHaveURL(`${origin}/education-index`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Образовательный индекс Doctor.School",
      exact: true,
    }),
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(12);
}

Given(
  /^the education-index demo routes are deployed in apps\/portal$/,
  async ({ page, host }) => {
    expect(host.id).toBe("academy");
    await page.context().clearCookies();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const origin = new URL(baseUrlFor(host)).origin;
    const cabinet = await page.request.get(
      `${origin}/education-index/partner-demo`,
    );
    expect(cabinet.status()).toBe(200);
    expect(new URL(cabinet.url()).pathname).toBe(
      "/education-index/partner-demo",
    );
    expect(await cabinet.text()).toContain("Ортелла Биотех");
    await open(page, origin);
  },
);

Given(
  "the fixture module carries 12 fictional organisations and the weekly index series",
  async ({ page }) => {
    expect(organizations).toHaveLength(12);
    expect(new Set(organizations.map((org) => org.name)).size).toBe(12);
    expect(
      organizations.reduce((sum, org) => sum + org.investmentShare, 0),
    ).toBe(100);
    expect(
      organizations.reduce((sum, org) => sum + org.attentionShare, 0),
    ).toBe(100);
    for (const org of organizations)
      await expect(row(page, org.name)).toHaveCount(1);
    const cards = page
      .getByTestId("index-dynamics")
      .getByTestId("dynamics-card");
    await expect(cards).toHaveCount(3);
    for (const [index, org] of organizations.slice(0, 3).entries()) {
      expect(Object.keys(weeklySeries[org.name]!)).toEqual(weeks.map(String));
      expect(weeklySeries[org.name]![4]).toBe(org.index);
      await expect(cards.nth(index)).toContainText(org.name);
      await expect(cards.nth(index).getByTestId("dynamics-bar")).toHaveText(
        weeks.map((week) => String(weeklySeries[org.name]![week])),
      );
    }
  },
);

Given(/^the visitor is on "\/education-index"$/, async ({ page, host }) => {
  await open(page, new URL(baseUrlFor(host)).origin);
});

Then("the Ortella Biotech row is already expanded", async ({ page }) => {
  await expect(row(page, ortella.name)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(await vector(page)).toEqual(
    organizations.map((org) => String(org.name === ortella.name)),
  );
});

Then(
  "two sub-metric bars appear for education-investment share and doctor-attention share",
  async ({ page }) => {
    await bars(page, row(page, ortella.name), ortella.name);
  },
);

When(
  "the visitor clicks a leaderboard row that is closed",
  async ({ page, world }) => {
    const before = await vector(page);
    const target = before.indexOf("false");
    expect(target).toBeGreaterThanOrEqual(0);
    states.set(world, { before, target });
    await rows(page).nth(target).click();
  },
);

Then(
  /^that row expands to reveal its two sub-metric bars, and every other row's open\/closed state is unchanged$/,
  async ({ page, world }) => {
    const { before, target } = states.get(world)!;
    await expect(rows(page).nth(target)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await vector(page)).toEqual(
      before.map((value, index) => (index === target ? "true" : value)),
    );
    await bars(page, rows(page).nth(target), organizations[target]!.name);
  },
);

When("the visitor clicks that same row again", async ({ page, world }) => {
  await rows(page).nth(states.get(world)!.target).click();
});

Then(
  /^that row collapses, and every other row's open\/closed state is unchanged$/,
  async ({ page, world }) => {
    const { before, target } = states.get(world)!;
    await expect(rows(page).nth(target)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(await detail(page, rows(page).nth(target))).toHaveCount(0);
    expect(await vector(page)).toEqual(before);
  },
);

Then(
  "the dynamics chart shows 4 weekly bars for the top-3 organisations starting at week 1",
  async ({ page }) => {
    const cards = page
      .getByTestId("index-dynamics")
      .getByTestId("dynamics-card");
    await expect(cards).toHaveCount(3);
    for (const [index, org] of organizations.slice(0, 3).entries()) {
      const card = cards.nth(index);
      await expect(card).toContainText(org.name);
      await expect(card.getByTestId("dynamics-bar")).toHaveText(
        weeks.map((week) => String(weeklySeries[org.name]![week])),
      );
      expect(
        [...(await card.innerText()).matchAll(/нед\. (\d+)/gu)].map((match) =>
          Number(match[1]),
        ),
      ).toEqual(weeks);
    }
  },
);

Then("no value renders before the index launch date", async ({ page }) => {
  const chart = page.getByTestId("index-dynamics");
  await expect(chart).toContainText(
    `Точка отсчёта — запуск индекса ${INDEX_LAUNCH}; неделя 1 — первый срез, раньше индекс не считался`,
  );
  expect(await chart.innerText()).not.toMatch(/нед\. (0|-\d)/u);
  await expect(chart.getByTestId("dynamics-bar")).toHaveCount(12);
});
