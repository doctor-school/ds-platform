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

  test("045 EARS-1: /education-index/partner-demo answers 200 with no login redirect", async ({
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
    const detail = page.locator(
      `#${await ortella.getAttribute("aria-controls")}`,
    );
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

test.describe("045 education-index demo · partner cabinet (V-1, V-3)", () => {
  test("045 EARS-11: the cabinet plaque names the partner cabinet as demonstration data", async ({
    page,
  }) => {
    await page.goto(CABINET);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Кабинет партнёра · Ортелла Биотех",
    );
    const plaque = page.getByTestId("demo-plaque");
    await expect(plaque).toHaveText(
      "Демонстрационные данные · так будет выглядеть кабинет партнёра",
    );
    await expect(plaque).toHaveCSS("position", "sticky");
  });

  test("045 EARS-8: plan/fact scale and the 4 KPI tiles", async ({ page }) => {
    await page.goto(CABINET);
    const scale = page.getByTestId("plan-fact");
    await expect(scale).toContainText("В графике: 68% плана к 60% срока");
    await expect(scale).toContainText(
      "план 56 300 очков внимания · факт 38 300",
    );
    await expect(scale.getByTestId("plan-fact-bar")).toHaveCount(1);
    const tiles = page.getByTestId("kpi-tile");
    await expect(tiles).toHaveText([
      /1 240\s*врачей обучено/,
      /28\s*уроков создано/,
      /2,9 из 7\s*средняя глубина пути/,
      /6\s*мероприятий проведено/,
    ]);
  });

  test("045 EARS-8: awareness before/after — two bars per topic across the 4 fixed topics (fork awareness = А)", async ({
    page,
  }) => {
    await page.goto(CABINET);
    const rows = page.getByTestId("awareness-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText(
      "PRP-терапия: показания и противопоказания",
    );
    await expect(rows.nth(1)).toContainText("Ранняя диагностика остеоартрита");
    await expect(rows.nth(2)).toContainText("Реабилитация после артроскопии");
    await expect(rows.nth(3)).toContainText("Ортобиология в спортивной травме");
    for (let i = 0; i < 4; i += 1) {
      await expect(rows.nth(i).getByTestId("awareness-bar")).toHaveCount(2);
    }
    await expect(rows.nth(0)).toContainText("24%");
    await expect(rows.nth(0)).toContainText("71%");
    await expect(rows.nth(0)).toContainText("+47 п.п.");
    await expect(page.getByTestId("awareness")).toContainText(
      "Пул осведомлённых врачей: 612 из 1 240",
    );
  });

  test("045 EARS-8: the 7-step engagement funnel in its fixed order", async ({
    page,
  }) => {
    await page.goto(CABINET);
    await expect(page.getByTestId("funnel-step-name")).toHaveText([
      "сериал",
      "микрообучение",
      "вебинар",
      "подкаст",
      "клуб",
      "практическая школа",
      "наставничество",
    ]);
    await expect(page.getByTestId("funnel-bar")).toHaveCount(7);
    const steps = page.getByTestId("funnel-step");
    await expect(steps.nth(0)).toContainText("вход в путь");
    await expect(steps.nth(1)).toContainText("986");
    await expect(steps.nth(1)).toContainText("80% из предыдущего");
  });

  test("045 EARS-8: weekly attention dynamics and the research-request unit with one submitted request", async ({
    page,
  }) => {
    await page.goto(CABINET);
    const attention = page.getByTestId("weekly-attention");
    await expect(attention).toContainText("итого 38 300");
    await expect(attention.getByTestId("attention-bar")).toHaveText([
      "6 200",
      "7 900",
      "9 400",
      "14 800",
    ]);
    const research = page.getByTestId("research-request");
    await expect(research.getByTestId("research-request-item")).toHaveCount(1);
    await expect(research).toContainText(
      "Осведомлённость по теме «Ранняя диагностика остеоартрита» — до/после",
    );
    await expect(research).toContainText(
      "Заявка отправлена · команда Академии свяжется с вами",
    );
  });

  test("045 EARS-9: audience table — header with the 1 240 total, exactly 5 rows, the «5 of 1 240» caption", async ({
    page,
  }) => {
    await page.goto(CABINET);
    const audience = page.getByTestId("audience");
    await expect(
      audience.getByRole("heading", {
        name: "Аудитория ваших проектов · 1 240 врачей",
      }),
    ).toBeVisible();
    const table = audience.getByRole("table");
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(table.locator("tbody tr").first()).toContainText(
      "Корнилова Мария Сергеевна",
    );
    await expect(audience).toContainText(
      "показано 5 из 1 240 · полный список — в выгрузке для отчётности",
    );
  });

  test("045 EARS-10: show-more, export and request-a-study are disabled and labelled unavailable in the demo", async ({
    page,
  }) => {
    await page.goto(CABINET);
    for (const name of [
      "Показать ещё",
      "Выгрузить для отчётности",
      "Запросить исследование",
    ]) {
      const button = page.getByRole("button", { name });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAccessibleDescription("в демо недоступно");
    }
  });
});

function withoutScripts(html: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = html.indexOf("<script", at);
    if (open === -1) return out + html.slice(at);
    out += html.slice(at, open);
    const close = html.indexOf("</script>", open);
    if (close === -1) return out;
    at = close + "</script>".length;
  }
}

test.describe("045 education-index demo · noindex + compliance words (V-7)", () => {
  async function assertNoindexAndClean(
    request: import("@playwright/test").APIRequestContext,
    path: string,
  ) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    // The invariant is about what RENDERS. The document minus its <script>
    // elements is every rendered node, attribute and head tag; the scripts carry
    // the framework flight payload, which serialises the portal-wide message
    // bundle the root layout hands its client providers (other routes' copy,
    // never rendered here).
    const lower = withoutScripts(html).toLowerCase();
    // Non-vacuous: the rendered page itself is still in what is scanned.
    expect(lower).toContain("демонстрационные данные");
    for (const word of FORBIDDEN) {
      expect(lower, `forbidden word «${word}» on ${path}`).not.toContain(word);
    }
  }

  test("045 EARS-13: /education-index emits noindex and renders no forbidden compliance word", async ({
    request,
  }) => {
    await assertNoindexAndClean(request, PUBLIC);
  });

  test("045 EARS-13: /education-index/partner-demo emits noindex and renders no forbidden compliance word", async ({
    request,
  }) => {
    await assertNoindexAndClean(request, CABINET);
  });
});
