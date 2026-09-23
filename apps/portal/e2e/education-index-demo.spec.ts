import { test, expect, type Page } from "@playwright/test";

/**
 * 045 — the temporary education-index demo pages (V-1, V-2, V-7).
 *
 * Backend-free by construction: both routes render from the static fixture
 * module `lib/education-index-demo/fixtures.ts` and issue no api, DB or
 * telemetry call (spec invariant), so this belongs in the hermetic
 * `playwright.ci.config.ts` tier rather than the dev-stand one. Nothing here can
 * go green because a mock answered — there is nothing to mock.
 *
 * Viewport 1440 is pinned for the table assertions: below the canvas 900px
 * breakpoint the leaderboard is the «полосами» list, a different unit.
 */

const PUBLIC = "/education-index";
const CABINET = "/education-index/partner-demo";

/** Spec invariant (requirements «Invariants») + the brief's RU stems. */
const FORBIDDEN = [
  "пациент",
  "спасённ",
  "спасенн",
  "помощь родственникам",
  "связь с продажами",
  "торговое название",
  "спонсор",
  "рекламодател",
  "контрибьютор",
  "вкладчик",
  "майнинг",
];

test.use({ viewport: { width: 1440, height: 900 } });

function leaderboardRow(page: Page, name: string) {
  return page
    .getByTestId("leaderboard-table")
    .getByRole("button", { name: new RegExp(`Партнёр · ${name}`) });
}

test.describe("045 education-index demo · public leaderboard (V-1, V-2)", () => {
  test("045 EARS-1: /education-index answers 200 with no login redirect", async ({
    page,
  }) => {
    const response = await page.goto(PUBLIC);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(PUBLIC);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Образовательный индекс Doctor.School",
    );
  });

  test.fixme("045 EARS-1: /education-index/partner-demo answers 200 with no login redirect", async ({
    page,
  }) => {
    const response = await page.goto(CABINET);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(CABINET);
  });

  test("045 EARS-11: the sticky demo plaque names the leaderboard as demonstration data", async ({
    page,
  }) => {
    await page.goto(PUBLIC);
    const plaque = page.getByTestId("demo-plaque");
    await expect(plaque).toHaveText(
      "Демонстрационные данные · так будет выглядеть Образовательный индекс",
    );
    await expect(plaque).toHaveCSS("position", "sticky");
  });

  test("045 EARS-2/3/4/5: 12 organisations, no podium, index + delta + amount and share + doctors/lessons/events", async ({
    page,
  }) => {
    await page.goto(PUBLIC);
    const table = page.getByTestId("leaderboard-table");
    await expect(table.getByRole("button")).toHaveCount(12);
    // EARS-4 — no top-3 podium above the table (fork podium = А).
    await expect(page.getByTestId("leaderboard-podium")).toHaveCount(0);

    // EARS-3/5 — the Ortella row carries every column; money = amount AND share.
    const ortella = leaderboardRow(page, "Ортелла Биотех");
    await expect(ortella).toContainText("72");
    await expect(ortella).toContainText("▲2");
    await expect(ortella).toContainText("2 040 000 ₽ · 15%");
    await expect(ortella).toContainText("1 240");
    await expect(ortella).toContainText("28");
    await expect(leaderboardRow(page, "Карталис Фарма")).toContainText(
      "3 400 000 ₽ · 25%",
    );
    await expect(leaderboardRow(page, "Равестра Медтех")).toContainText(
      "200 000 ₽ · 1,5%",
    );
  });

  test("045 EARS-6.1: the Ortella Biotech row is open on load with its two sub-metric bars (15% / 19%) composing index 72", async ({
    page,
  }) => {
    await page.goto(PUBLIC);
    const ortella = leaderboardRow(page, "Ортелла Биотех");
    await expect(ortella).toHaveAttribute("aria-expanded", "true");
    const detail = page.locator(`#${await ortella.getAttribute("aria-controls")}`);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Инвестиции в образование");
    await expect(detail).toContainText("15% всех инвестиций");
    await expect(detail).toContainText("Внимание врачей");
    await expect(detail).toContainText("19% всего внимания");
    await expect(detail).toContainText(
      "Индекс 72: среднее двух долей, пересчитанное к лидеру недели",
    );
    await expect(detail.getByTestId("sub-bar")).toHaveCount(2);
    // Every other row starts closed.
    await expect(
      page.getByTestId("leaderboard-table").locator('[aria-expanded="true"]'),
    ).toHaveCount(1);
  });

  test("045 EARS-6.2: any row toggles open and closed independently of every other row", async ({
    page,
  }) => {
    await page.goto(PUBLIC);
    const ortella = leaderboardRow(page, "Ортелла Биотех");
    const kartalis = leaderboardRow(page, "Карталис Фарма");
    await expect(kartalis).toHaveAttribute("aria-expanded", "false");

    await kartalis.click();
    await expect(kartalis).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator(`#${await kartalis.getAttribute("aria-controls")}`),
    ).toContainText("25% всех инвестиций");
    await expect(ortella).toHaveAttribute("aria-expanded", "true");

    await ortella.click();
    await expect(ortella).toHaveAttribute("aria-expanded", "false");
    await expect(kartalis).toHaveAttribute("aria-expanded", "true");

    await kartalis.click();
    await expect(kartalis).toHaveAttribute("aria-expanded", "false");
    await expect(ortella).toHaveAttribute("aria-expanded", "false");
  });

  test("045 EARS-7: index dynamics — 4 weekly bars for the top-3 from the 1 September 2026 launch, baseline caption", async ({
    page,
  }) => {
    await page.goto(PUBLIC);
    const dynamics = page.getByTestId("index-dynamics");
    const cards = dynamics.getByTestId("dynamics-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText("Карталис Фарма");
    await expect(cards.nth(1)).toContainText("Велтора Фарм");
    await expect(cards.nth(2)).toContainText("Ортелла Биотех");
    for (let i = 0; i < 3; i += 1) {
      await expect(cards.nth(i).getByTestId("dynamics-bar")).toHaveCount(4);
      await expect(cards.nth(i)).toContainText("нед. 1");
      await expect(cards.nth(i)).toContainText("нед. 4");
    }
    await expect(cards.nth(2).getByTestId("dynamics-bar")).toHaveText([
      "38",
      "43",
      "47",
      "72",
    ]);
    await expect(dynamics).toContainText(
      "Точка отсчёта — запуск индекса 1 сентября 2026; неделя 1 — первый срез, раньше индекс не считался",
    );
    await expect(page.getByText("запущен 1 сентября 2026")).toBeVisible();
  });
});

test.describe("045 education-index demo · noindex + compliance words (V-7)", () => {
  async function assertNoindexAndClean(
    request: import("@playwright/test").APIRequestContext,
    path: string,
  ) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    const lower = html.toLowerCase();
    for (const word of FORBIDDEN) {
      expect(lower, `forbidden word «${word}» on ${path}`).not.toContain(word);
    }
  }

  test("045 EARS-13: /education-index emits noindex and renders no forbidden compliance word", async ({
    request,
  }) => {
    await assertNoindexAndClean(request, PUBLIC);
  });

  test.fixme("045 EARS-13: /education-index/partner-demo emits noindex and renders no forbidden compliance word", async ({
    request,
  }) => {
    await assertNoindexAndClean(request, CABINET);
  });
});
