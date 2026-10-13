import { mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  createPublishedEvent,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { addDeskParticipant } from "./support/congress-roster";
import { visible } from "./support/visible";

/**
 * 044 EARS-31 (V-20) — the registrar reads the «возможный дубль» marker under
 * the ФИО of each marked roster row (owner Stage-A «Под ФИО», #2328) and
 * filters the roster to the marked rows or to the rest. Driven against the real
 * admin → api → Postgres chain: the rows are written by the registrar's desk
 * entry (EARS-35, the production route), two of them with one contact phone
 * typed two ways («+7 916 …» / «8 916 …», one normalised key, EARS-29), and
 * every marker and every narrowing is the server's.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (flows tier):
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-roster-duplicate.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the evidence screenshots of the approved-non-canvas
 * source `feature-044-roster-duplicate-v1`: `roster-duplicate-indicator`,
 * `roster-duplicate-filter` at 1440 and `roster-duplicate-narrow` at 390,
 * light and dark.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const RUN = Date.now();
const PEOPLE = [
  {
    surname: "Ковалёва",
    firstName: "Елена",
    patronymic: "Дмитриевна",
    phone: "+7 916 123-45-67",
    specialty: "Терапия",
    workplace: "ГКБ №1 им. Пирогова",
    city: "Москва",
  },
  {
    surname: "Жуков",
    firstName: "Павел",
    patronymic: "Олегович",
    phone: "+7 925 640-72-10",
    specialty: "Терапия",
    workplace: "Поликлиника №3",
    city: "Мытищи",
  },
  {
    surname: "Громова",
    firstName: "Анна",
    patronymic: "Сергеевна",
    // The same number as Ковалёва's, typed with the domestic «8».
    phone: "8 916 123 45 67",
    specialty: "Хирургия",
    workplace: "ГКБ №15",
    city: "Химки",
  },
  {
    surname: "Морозов",
    firstName: "Илья",
    patronymic: "Петрович",
    phone: "8 495 408 12 77",
    specialty: "Кардиология",
    workplace: "Клиника «Здоровье»",
    city: "Долгопрудный",
  },
].map((person, index) => ({
  ...person,
  email: `roster-duplicate-${RUN}-${index}@example.ru`,
}));

const fullName = (index: number) => {
  const p = PEOPLE[index]!;
  return `${p.surname} ${p.firstName} ${p.patronymic}`;
};
const MARKED = [fullName(0), fullName(2)];
const UNMARKED = [fullName(1), fullName(3)];

/** The admin's dark palette is the `.dark` token block (the #1927 recipe, `congress-roster.spec.ts`). */
async function setPalette(page: Page, palette: "light" | "dark") {
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
  // `transition-colors` controls repaint over a beat — capture the settled look.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  for (const palette of ["light", "dark"] as const) {
    await setPalette(page, palette);
    await page.screenshot({
      path: path.join(SHOT_DIR, `${name}-${palette}.png`),
      fullPage: true,
    });
  }
  await setPalette(page, "light");
}

test.describe.configure({ mode: "serial" });
test.use({ channel: "chromium", launchOptions: { args: ["--lang=ru-RU"] } });

test.describe("044 EARS-31 — the roster's «возможный дубль» marker and filter (V-20)", () => {
  let context: BrowserContext;
  let desk: Page;
  let eventId = "";

  test.afterAll(async () => {
    await context?.close();
  });

  const total = (page: Page) => page.getByTestId("roster-total");
  const toggle = (page: Page) =>
    page.getByRole("button", { name: /^Все фильтры/ });
  const chip = (page: Page, label: string) =>
    page
      .getByTestId("roster-filters")
      .getByRole("button", { name: `Убрать фильтр: ${label}` });
  const select = (page: Page) =>
    page
      .getByRole("group", { name: "Фильтры по данным участника" })
      .getByLabel("Возможный дубль");
  /** The ФИО of every visible row whose name cell carries the marker. */
  const markedNames = (page: Page) =>
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-testid='roster-row-duplicate']",
        ),
      )
        .filter((el) => el.offsetParent !== null)
        .map(
          (el) =>
            el.parentElement?.querySelector<HTMLElement>(
              "[data-testid='roster-cell-fullName']",
            )?.textContent ?? "",
        )
        .sort(),
    );
  const names = (page: Page) =>
    visible(
      page
        .getByTestId("roster-table")
        .locator("[data-testid='roster-cell-fullName']"),
    );

  test("044 EARS-31: the marker sits under the ФИО of exactly the rows sharing a phone; «Да» keeps only them, «Нет» the rest, as a chip in the address that survives a reload; «Сбросить всё» clears", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    context = await browser.newContext({
      baseURL: ADMIN_ORIGIN,
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
    });
    desk = await context.newPage();
    const page = desk;
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    eventId = await createPublishedEvent(page, `Конгресс-дубли ${RUN}`);
    await page.goto(`/events/${eventId}/roster`);
    for (const person of PEOPLE) {
      expect(await addDeskParticipant(page, person)).toBe("accepted");
    }
    await page.reload();
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);

    // The marker: the card's own label, under the ФИО, on the pair only — no
    // column of its own.
    await expect(
      visible(page.getByTestId("roster-row-duplicate")),
    ).toHaveCount(2);
    await expect(visible(page.getByTestId("roster-row-duplicate")).first())
      .toHaveText("Возможный дубль");
    expect(await markedNames(page)).toEqual([...MARKED].sort());
    await expect(
      page.getByTestId("roster-table").getByRole("columnheader", {
        name: /Возможный дубль/,
      }),
    ).toHaveCount(0);
    await shot(page, "roster-duplicate-indicator");

    // The card of a marked row says the same; an unmarked row's card does not.
    const cardPanel = page.getByTestId("participant-card-panel");
    await visible(
      page.getByRole("button", { name: fullName(2), exact: true }),
    ).click();
    await expect(
      cardPanel.getByTestId("participant-card-duplicate"),
    ).toContainText("Возможный дубль");
    await page.keyboard.press("Escape");
    await expect(cardPanel).toHaveCount(0);
    await visible(
      page.getByRole("button", { name: fullName(1), exact: true }),
    ).click();
    await expect(cardPanel.getByTestId("participant-card-fullName")).toHaveText(
      fullName(1),
    );
    await expect(cardPanel.getByTestId("participant-card-duplicate")).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await expect(cardPanel).toHaveCount(0);

    // «Да» — only the marked rows.
    await toggle(page).click();
    await select(page).selectOption({ label: "Да" });
    await expect(total(page)).toHaveText("Найдено: 2");
    await expect(page).toHaveURL(/possibleDuplicate=yes/);
    await expect(names(page)).toHaveText(MARKED.slice().sort(byRegistration));
    await expect(chip(page, "Возможный дубль: да")).toBeVisible();
    await shot(page, "roster-duplicate-filter");

    // Reload: the address restores the filter, its chip and the badge count.
    await page.reload();
    await expect(total(page)).toHaveText("Найдено: 2");
    await expect(chip(page, "Возможный дубль: да")).toBeVisible();
    await expect(toggle(page)).toHaveAccessibleName("Все фильтры, применено: 1");
    expect(await markedNames(page)).toEqual([...MARKED].sort());

    // «Нет» — every other row, none of them marked.
    await toggle(page).click();
    await select(page).selectOption({ label: "Нет" });
    await expect(total(page)).toHaveText("Найдено: 2");
    await expect(page).toHaveURL(/possibleDuplicate=no/);
    await expect(chip(page, "Возможный дубль: нет")).toBeVisible();
    await expect(names(page)).toHaveText(UNMARKED.slice().sort(byRegistration));
    expect(await markedNames(page)).toEqual([]);

    await page
      .getByTestId("roster-filters")
      .getByRole("button", { name: "Сбросить всё" })
      .click();
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);
    await expect(page).not.toHaveURL(/possibleDuplicate=/);
    await expect(select(page)).toHaveValue("");
  });

  test("044 EARS-31: a hand-edited «возможный дубль» value is dropped as not applied, never a 400 page", async () => {
    test.skip(!eventId, "depends on the event seeded above");
    const page = desk;
    await page.goto(`/events/${eventId}/roster?possibleDuplicate=maybe`);
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);
    await expect(toggle(page)).toHaveAccessibleName("Все фильтры");
  });

  test("044 EARS-31: the open panel with the filter is axe-clean (WCAG 2.1 AA); at 390 the marker stays under the ФИО on the record cards with no sideways scroll", async () => {
    test.skip(!eventId, "depends on the event seeded above");
    const page = desk;
    await page.goto(`/events/${eventId}/roster`);
    await toggle(page).click();
    await select(page).selectOption({ label: "Да" });
    await expect(total(page)).toHaveText("Найдено: 2");
    const results = await new AxeBuilder({ page })
      .include("[data-testid='roster-filters']")
      .withTags(WCAG_TAGS)
      .analyze();
    const summary = results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
    expect(summary, "axe violations on the open filter panel").toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await toggle(page).click();
    await expect(
      visible(page.getByTestId("roster-row-duplicate")),
    ).toHaveCount(2);
    expect(await markedNames(page)).toEqual([...MARKED].sort());
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(sideways, "the roster scrolls sideways at 390").toBe(false);
    await shot(page, "roster-duplicate-narrow");
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});

/** Default order is registration order — the desk wrote the PEOPLE in sequence. */
function byRegistration(a: string, b: string): number {
  const index = (name: string) =>
    PEOPLE.findIndex(
      (p) => `${p.surname} ${p.firstName} ${p.patronymic}` === name,
    );
  return index(a) - index(b);
}
