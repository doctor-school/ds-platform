import { mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  createPublishedEvent,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import {
  addDeskParticipant,
  pickComboboxOption,
} from "./support/congress-roster";
import { visible } from "./support/visible";

/**
 * 044 EARS-23 — the roster's per-column filters in the «Все фильтры» panel
 * (owner layout F1, #2316), driven against the real admin → api → Postgres
 * chain (V-12). No mocked response: the rows are written by the registrar's
 * desk entry (EARS-35, the production route) with real Минздрав specialties and
 * directory places, and every narrowing is the server's (`GET …/roster` with
 * the slice-A params).
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (flows tier):
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-roster-filters.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the evidence screenshots of the approved-non-canvas
 * source `feature-044-roster-filters-v1`: `roster-filters-closed`, `-open`,
 * `-applied` at 1440 and `-narrow` at 390, light and dark.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const RUN = Date.now();
const PEOPLE = [
  {
    surname: "Ковалёва",
    firstName: "Елена",
    patronymic: "Дмитриевна",
    phone: "+7 903 455-67-89",
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
    surname: "Громов",
    firstName: "Денис",
    patronymic: "Сергеевич",
    phone: "8 999 555 11 22",
    specialty: "Хирургия",
    workplace: "ГКБ №15",
    city: "Химки",
  },
  {
    surname: "Морозова",
    firstName: "Наталья",
    patronymic: "Петровна",
    phone: "8 495 408 12 77",
    specialty: "Кардиология",
    workplace: "Клиника «Здоровье»",
    city: "Долгопрудный",
  },
  {
    surname: "Борисова",
    firstName: "Вера",
    patronymic: "Павловна",
    phone: "8 926 310 45 02",
    specialty: "Неврология",
    workplace: "ГКБ №1 им. Пирогова",
    city: "Химки",
  },
].map((person, index) => ({
  ...person,
  email: `roster-filters-${RUN}-${index}@example.ru`,
}));

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

/** Today / a day off it as a Moscow calendar day (`YYYY-MM-DD`). */
function mskDay(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}
const ruDay = (day: string) => day.split("-").reverse().join(".");

function nameCells(page: Page) {
  return visible(
    page
      .getByTestId("roster-table")
      .locator("[data-testid='roster-cell-fullName']"),
  );
}

const fullName = (index: number) => {
  const p = PEOPLE[index]!;
  return `${p.surname} ${p.firstName} ${p.patronymic}`;
};

test.describe.configure({ mode: "serial" });
// A native date input's «дд.мм.гггг» follows the BROWSER's UI language, not the
// context locale — the registrar's Russian Chromium is launched as such.
test.use({ channel: "chromium", launchOptions: { args: ["--lang=ru-RU"] } });

test.describe("044 EARS-23 — the roster's column filters (F1)", () => {
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

  test("044 EARS-23: a text column narrows by «contains», the specialty selector by the book, both as chips in the address; reload keeps them; they compose with the sort; «Сбросить всё» clears", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    // One signed-in admin for the describe: every sign-in bootstraps a fresh
    // IdP account, and the shared IdP throttles serial sign-ups.
    // An explicit context does not inherit the config's `use` — the registrar's
    // locale and zone are set here, so a native date input reads «дд.мм.гггг».
    context = await browser.newContext({
      baseURL: ADMIN_ORIGIN,
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
    });
    desk = await context.newPage();
    const page = desk;
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    eventId = await createPublishedEvent(page, `Конгресс-фильтры ${RUN}`);
    await page.goto(`/events/${eventId}/roster`);
    for (const person of PEOPLE) {
      expect(await addDeskParticipant(page, person)).toBe("accepted");
    }
    await page.reload();
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);

    // Closed by default: the toggle says so, no panel control is visible.
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Место работы")).toBeHidden();
    await shot(page, "roster-filters-closed");

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("group", { name: "Фильтры по данным участника" }),
    ).toBeVisible();

    // Page 1 after any change — the pager reads it.
    await page.getByLabel("Место работы").fill("гкб");
    await expect(total(page)).toHaveText("Найдено: 3");
    await expect(chip(page, "Место работы: гкб")).toBeVisible();
    await expect(page).toHaveURL(/workplace=%D0%B3%D0%BA%D0%B1/);
    await expect(toggle(page)).toHaveAccessibleName(
      "Все фильтры, применено: 1",
    );

    await page.getByTestId("roster-filter-specialty").click();
    await pickComboboxOption(page, "Поиск специальности", "Терапия", /^Терапия$/);
    await expect(total(page)).toHaveText("Найдено: 1");
    await expect(nameCells(page)).toHaveText([fullName(0)]);
    await expect(chip(page, "Специальность: Терапия")).toBeVisible();
    await expect(page).toHaveURL(/specialtyId=[0-9a-f-]{36}/);
    await shot(page, "roster-filters-open");

    // Reload: the address restores both filters, the chip names the specialty.
    await page.reload();
    await expect(total(page)).toHaveText("Найдено: 1");
    await expect(chip(page, "Место работы: гкб")).toBeVisible();
    await expect(chip(page, "Специальность: Терапия")).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(page)).toHaveAccessibleName(
      "Все фильтры, применено: 2",
    );
    await shot(page, "roster-filters-applied");

    // A chip removes just its own filter.
    await chip(page, "Место работы: гкб").click();
    await expect(total(page)).toHaveText("Найдено: 2");
    await expect(page).not.toHaveURL(/workplace=/);

    // Composes with the sort: ФИО descending keeps the specialty filter.
    const nameHeader = page
      .getByTestId("roster-table")
      .getByRole("button", { name: "ФИО", exact: true });
    await nameHeader.click();
    await expect(nameCells(page)).toHaveText([fullName(1), fullName(0)]);
    await nameHeader.click();
    await expect(nameCells(page)).toHaveText([fullName(0), fullName(1)]);
    await expect(page).toHaveURL(/sort=fullName/);
    await expect(page).toHaveURL(/specialtyId=/);

    await page
      .getByTestId("roster-filters")
      .getByRole("button", { name: "Сбросить всё" })
      .click();
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);
    await expect(page).not.toHaveURL(/specialtyId=|workplace=/);
    await expect(page).toHaveURL(/sort=fullName/);
  });

  test("044 EARS-23: the city selector and the registration date range narrow server-side, open ends included", async () => {
    test.skip(!eventId, "depends on the event seeded above");
    test.setTimeout(120_000);
    const page = desk;
    await page.goto(`/events/${eventId}/roster`);
    await toggle(page).click();

    await page.getByTestId("roster-filter-city").click();
    await pickComboboxOption(page, "Поиск населённого пункта", "Химки", /^Химки/);
    await expect(total(page)).toHaveText("Найдено: 2");
    await expect(nameCells(page)).toHaveText([fullName(2), fullName(4)]);
    await expect(chip(page, "Город: Химки")).toBeVisible();

    const today = mskDay();
    await page.getByLabel("Дата регистрации с").fill(today);
    await page.getByLabel("Дата регистрации по").fill(today);
    await expect(
      chip(page, `Дата регистрации: ${ruDay(today)} – ${ruDay(today)}`),
    ).toBeVisible();
    await expect(total(page)).toHaveText("Найдено: 2");

    // An open end: from tomorrow on, nobody has registered yet.
    const tomorrow = mskDay(1);
    await page.getByLabel("Дата регистрации по").fill("");
    await page.getByLabel("Дата регистрации с").fill(tomorrow);
    await expect(
      chip(page, `Дата регистрации: с ${ruDay(tomorrow)}`),
    ).toBeVisible();
    await expect(total(page)).toHaveText("Найдено: 0");

    await chip(page, `Дата регистрации: с ${ruDay(tomorrow)}`).click();
    await expect(total(page)).toHaveText("Найдено: 2");
    await expect(page).not.toHaveURL(/registeredFrom=/);
  });

  test("044 EARS-23: телефон rejects a digit-less term and accepts digits under the 8 → 7 rule; a hand-edited address value the route would refuse is dropped, never a 400 page", async () => {
    test.skip(!eventId, "depends on the event seeded above");
    const page = desk;
    await page.goto(`/events/${eventId}/roster`);
    await toggle(page).click();
    const phone = page.getByLabel("Телефон", { exact: true });

    // Reject: no digit — not applied, no chip, the whole roster stays.
    await phone.fill("+ (");
    await expect(page).toHaveURL(/phone=/);
    await expect(
      page.getByTestId("roster-filters").getByRole("button", {
        name: /^Убрать фильтр: Телефон/,
      }),
    ).toHaveCount(0);
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);

    // Accept: «+7 999 555» finds the participant typed «8 999 555 11 22».
    await phone.fill("+7 999 555");
    await expect(chip(page, "Телефон: +7 999 555")).toBeVisible();
    await expect(total(page)).toHaveText("Найдено: 1");
    await expect(nameCells(page)).toHaveText([fullName(2)]);
    await chip(page, "Телефон: +7 999 555").click();
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);

    // A hand-edited address: an impossible day, text over the 160 maximum, an
    // inverted range's «по» — all dropped, the roster renders unfiltered.
    await page.goto(
      `/events/${eventId}/roster?registeredFrom=2026-02-31&name=${"а".repeat(161)}&phone=${encodeURIComponent("()")}`,
    );
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);
    await expect(toggle(page)).toHaveAccessibleName("Все фильтры");
    const today = mskDay();
    await page.goto(
      `/events/${eventId}/roster?registeredFrom=${today}&registeredTo=${mskDay(-1)}`,
    );
    await expect(
      chip(page, `Дата регистрации: с ${ruDay(today)}`),
    ).toBeVisible();
    await expect(total(page)).toHaveText(`Найдено: ${PEOPLE.length}`);
  });

  test("044 EARS-23: the open filter panel is axe-clean (WCAG 2.1 AA) and folds to one column at 390", async () => {
    test.skip(!eventId, "depends on the event seeded above");
    const page = desk;
    await page.goto(`/events/${eventId}/roster`);
    await toggle(page).click();
    await page.getByLabel("Место работы").fill("ГКБ");
    await expect(total(page)).toHaveText("Найдено: 3");
    const results = await new AxeBuilder({ page })
      .include("[data-testid='roster-filters']")
      .withTags(WCAG_TAGS)
      .analyze();
    const summary = results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
    expect(summary, "axe violations on the open filter panel").toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    const panel = page.getByRole("group", {
      name: "Фильтры по данным участника",
    });
    const fio = await panel.getByLabel("ФИО").boundingBox();
    const workplace = await panel.getByLabel("Место работы").boundingBox();
    expect(workplace!.y).toBeGreaterThan(fio!.y);
    // No sideways scroll: nothing in the bar reaches past the viewport.
    const overflowing = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-testid='roster-filters'] *"),
      )
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth)
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(overflowing).toEqual([]);
    await shot(page, "roster-filters-narrow");
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
