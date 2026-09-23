import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createPublishedEvent,
  eventSlugFromRoster,
  registerDoctorThroughPlatform,
} from "./support/congress-roster";
import { signInAsAdmin } from "./support/sign-in";
import { visible } from "./support/visible";

/**
 * 044 EARS-21 — the congress roster screen on the `AdminDataList` composition,
 * driven against the real admin → api → Postgres chain (EARS-18 route, #2311).
 * No mocked response: the rows are written by the platform registration path
 * (EARS-16) and read back through the roster route.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (a MANUAL gate, not CI):
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-roster.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the evidence screenshots.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

/** EARS-25, exactly — № first, статус письма last. */
const COLUMNS = [
  "№",
  "ФИО",
  "Специальность",
  "Место работы",
  "Город",
  "Область",
  "Телефон",
  "Email",
  "Дата регистрации",
  "Статус письма",
];

const PEOPLE = [
  "Абрамова Анна Ильинична",
  "Борисова Вера Павловна",
  "Власова Галина Олеговна",
];

/** Enough further rows to spill past one default page (20) — none matches a search above. */
const FILLERS = [
  "Григорьева",
  "Дмитриева",
  "Егорова",
  "Жукова",
  "Зайцева",
  "Ильина",
  "Козлова",
  "Лебедева",
  "Морозова",
  "Никитина",
  "Орлова",
  "Петрова",
  "Романова",
  "Сергеева",
  "Титова",
  "Устинова",
  "Фёдорова",
  "Худякова",
].map((surname) => `${surname} Ирина Сергеевна`);

/**
 * Put the page under the design-system palette. The admin ships no theme toggle
 * and does not follow `prefers-color-scheme`: the dark palette is the `.dark`
 * token block in `@ds/design-system` on the document root (the #1927 recipe,
 * `legacy-broadcast.spec.ts`). The token-painted `body` background is the honest
 * signal that the recalculation has happened.
 */
async function setPalette(
  page: Page,
  palette: "light" | "dark",
): Promise<void> {
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, palette);
  await page.waitForFunction((mode) => {
    const channels = getComputedStyle(document.body).backgroundColor.match(
      /[\d.]+/g,
    );
    if (!channels || channels.length < 3) return false;
    const [r, g, b] = channels.map(Number);
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    return mode === "dark" ? luminance < 128 : luminance >= 128;
  }, palette);
}

async function shot(
  page: Page,
  name: string,
  { dark = false }: { dark?: boolean } = {},
): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  const palettes = dark ? (["light", "dark"] as const) : (["light"] as const);
  for (const palette of palettes) {
    await setPalette(page, palette);
    await page.screenshot({
      path: path.join(
        SHOT_DIR,
        dark ? `${name}-${palette}.png` : `${name}.png`,
      ),
      fullPage: true,
    });
  }
  await setPalette(page, "light");
}

/** The desktop table's ФИО cells (the phone record cards are hidden at this width). */
function nameCells(page: Page) {
  return visible(
    page
      .getByTestId("roster-table")
      .locator("[data-testid='roster-cell-fullName']"),
  );
}

/** The desktop table's № cells. */
function numberCells(page: Page) {
  return visible(
    page.getByTestId("roster-table").locator("[data-testid^='roster-row-']"),
  );
}

test.describe.configure({ mode: "serial" });

test.describe("044 EARS-21 — the congress roster in admin", () => {
  let eventId = "";
  const emails: Record<string, string> = {};

  test("044 EARS-21: the roster renders on AdminDataList, searches and pages", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    eventId = await createPublishedEvent(page, `Конгресс-реестр ${Date.now()}`);
    const slug = await eventSlugFromRoster(page, eventId);
    for (const name of PEOPLE) {
      emails[name] = (
        await registerDoctorThroughPlatform(browser, slug, name)
      ).email;
    }

    // The platform administrator's way in: the event detail links the roster.
    await page.goto(`/events/${eventId}`);
    await page.getByTestId("event-roster-link").click();
    await page.waitForURL(new RegExp(`/events/${eventId}/roster$`));

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Реестр участников",
    );
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 3");
    await expect(
      page.getByTestId("roster-table").locator("thead th"),
    ).toHaveText(COLUMNS);
    await expect(nameCells(page)).toHaveCount(3);
    // The order is the read model's; the SET of people is the assertion here.
    expect((await nameCells(page).allInnerTexts()).sort()).toEqual(
      [...PEOPLE].sort(),
    );
    await expect(numberCells(page)).toHaveText(["1", "2", "3"]);

    // EARS-24 — view-only: no create, no lifecycle facet, no row link.
    await expect(page.getByTestId("roster-create")).toHaveCount(0);
    await expect(page.getByTestId("roster-status")).toHaveCount(0);
    await expect(page.getByTestId("roster-include-retired")).toHaveCount(0);
    await expect(
      page.getByTestId("roster-table").locator("tbody a"),
    ).toHaveCount(0);
    await shot(page, "roster-desktop", { dark: true });

    // Instant search narrows to the one match — no submit control.
    const search = page.getByRole("searchbox", { name: "Поиск участника" });
    await search.fill("Борисова");
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 1");
    await expect(nameCells(page)).toHaveText(["Борисова Вера Павловна"]);
    await shot(page, "roster-search-match");

    // A non-matching term shows the composition's no-results state.
    await search.fill("Несуществующая Фамилия");
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 0");
    await expect(visible(page.getByText("Ничего не найдено"))).toBeVisible();
    await shot(page, "roster-search-empty");

    // Server paging through the composition's own pager: seed past one default
    // page (ADMIN_LIST_PAGE_SIZE_DEFAULT = 20) so a second page exists.
    for (const name of FILLERS) {
      await registerDoctorThroughPlatform(browser, slug, name);
    }
    const total = PEOPLE.length + FILLERS.length;
    await page.reload();
    await expect(page.getByTestId("roster-total")).toHaveText(
      `Найдено: ${total}`,
    );
    await expect(visible(page.getByTestId("roster-page"))).toHaveText(
      "Страница 1 из 2",
    );
    await expect(nameCells(page)).toHaveCount(20);
    await page.getByRole("button", { name: "Вперёд" }).click();
    await expect(visible(page.getByTestId("roster-page"))).toHaveText(
      "Страница 2 из 2",
    );
    await expect(page.getByTestId("roster-total")).toHaveText(
      `Найдено: ${total}`,
    );
    await expect(nameCells(page)).toHaveCount(1);
    await expect(numberCells(page)).toHaveText([String(total)]);
    await shot(page, "roster-page-2");

    // A phone never scrolls the page sideways (the composition's record cards).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/events/${eventId}/roster`);
    await expect(page.getByTestId("roster-total")).toHaveText(
      `Найдено: ${total}`,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      "the roster page does not scroll sideways on a phone",
    ).toBe(0);
    await shot(page, "roster-mobile", { dark: true });
  });

  test("044 EARS-16: answer-less rows render profile values and empty cells, no placeholder", async ({
    page,
  }) => {
    test.skip(!eventId, "depends on the event seeded by EARS-21");
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    const name = PEOPLE[0]!;
    await page.goto(`/events/${eventId}/roster`);
    await page.getByRole("searchbox", { name: "Поиск участника" }).fill(name);
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 1");

    const row = visible(page.getByTestId("roster-table").locator("tbody tr"));
    await expect(row).toHaveCount(1);
    const cell = (key: string) =>
      row.locator(`[data-testid='roster-cell-${key}']`);

    // Profile values: the display name and the account email.
    await expect(cell("fullName")).toHaveText(name);
    await expect(cell("email")).toHaveText(emails[name]!);
    await expect(cell("registeredAt")).not.toBeEmpty();
    // No answers and no profile value → an EMPTY cell, not «—» or a stand-in.
    for (const key of [
      "specialtyName",
      "workplace",
      "city",
      "region",
      "phone",
    ]) {
      await expect(cell(key), `${key} stays empty`).toHaveText("");
    }
    await expect(row).not.toContainText("—");
    await shot(page, "roster-answerless-row");
  });
});
