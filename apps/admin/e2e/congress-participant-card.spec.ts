import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  addDeskParticipant,
  createPublishedEvent,
  eventSlugFromRoster,
  registerDoctorThroughPlatform,
} from "./support/congress-roster";
import { ADMIN_ORIGIN, signInAsAdmin } from "./support/sign-in";
import { expectOneLineValue } from "./support/one-line-value";
import { visible } from "./support/visible";

/**
 * 044 EARS-36 / EARS-37 — the participant card in the side panel over the
 * roster and the seven-column roster, driven against the real admin → api →
 * Postgres chain; nothing is mocked. Rows come from the production writers:
 * two platform registrations (EARS-16, no answers, never a duplicate) and two
 * desk entries (EARS-35) carrying ONE phone in two spellings — the «возможный
 * дубль» pair (EARS-29/30, V-20 for the card).
 *
 * The api must run with `CONGRESS_SIGNUP_EVENT_DAYS=2027-04-23,2027-04-24` (the
 * `admin-e2e` CI job's value). Dev-stand-gated like the rest of the flows tier:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-participant-card.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the approved-non-canvas `responsive-web` evidence:
 * `participant-card-panel-{desktop,mobile}-{light,dark}.png`,
 * `participant-card-attendance.png`, `roster-seven-columns.png`. Dark = the
 * design-system `.dark` token block on the document root.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const DAY_1 = "2027-04-23";
const DAY_1_LABEL = "23.04 — присутствие 23 апреля";

const COLUMNS = [
  "№",
  "ФИО",
  "Специальность",
  "Город",
  "Телефон",
  "Дата регистрации",
  "Присутствие",
];

const PLATFORM = ["Абрамова Анна Ильинична", "Борисова Вера Павловна"];
const DUPLICATE_A = {
  surname: "Громова",
  firstName: "Дарья",
  patronymic: "Сергеевна",
  phone: "+7 (999) 555-11-22",
};
const DUPLICATE_B = {
  surname: "Громов",
  firstName: "Денис",
  patronymic: "Сергеевич",
  phone: "8 999 555 11 22",
};
const fullName = (p: typeof DUPLICATE_A) =>
  `${p.surname} ${p.firstName} ${p.patronymic}`;

function uniqueEmail(tag: string): string {
  return `card-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.org`;
}

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
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

function nameCells(page: Page): Locator {
  return visible(
    page
      .getByTestId("roster-table")
      .locator("[data-testid='roster-cell-fullName']"),
  );
}

/** The visible row-activation control of one participant (table or phone card). */
function rowControl(page: Page, name: string): Locator {
  return visible(page.getByRole("button", { name, exact: true }));
}

function card(page: Page): Locator {
  return page.getByTestId("participant-card-panel");
}

function registrationParam(page: Page): string | null {
  return new URL(page.url()).searchParams.get("registration");
}

test.describe.configure({ mode: "serial" });

test.describe("044 EARS-36/37 — the participant card and the seven-column roster", () => {
  let eventId = "";
  let order: string[] = [];
  let context: BrowserContext | undefined;
  let desk: Page;

  test.afterAll(async () => {
    await context?.close();
  });
  const duplicateEmail = uniqueEmail("dup");

  test("044 EARS-37: the roster shows exactly №, ФИО, специальность, город, телефон, дата регистрации, присутствие", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    // One signed-in admin for the whole describe: every sign-in bootstraps a
    // fresh IdP account, and the shared IdP throttles serial sign-ups.
    context = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    desk = await context.newPage();
    const page = desk;
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    eventId = await createPublishedEvent(
      page,
      `Конгресс-карточка ${Date.now()}`,
    );
    const slug = await eventSlugFromRoster(page, eventId);
    for (const name of PLATFORM) {
      await registerDoctorThroughPlatform(browser, slug, name);
    }
    await page.goto(`/events/${eventId}/roster`);
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 2");
    expect(
      await addDeskParticipant(page, { ...DUPLICATE_A, email: duplicateEmail }),
    ).toBe("accepted");
    expect(
      await addDeskParticipant(page, {
        ...DUPLICATE_B,
        email: uniqueEmail("dup-b"),
      }),
    ).toBe("accepted");
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 4");

    await expect(
      page.getByTestId("roster-table").locator("thead th"),
    ).toHaveText(COLUMNS);
    // The moved fields are not cells of the table any more.
    for (const moved of [
      "workplace",
      "region",
      "email",
      "confirmationMailStatus",
    ]) {
      await expect(
        page.locator(`[data-testid='roster-cell-${moved}']`),
      ).toHaveCount(0);
    }
    order = await nameCells(page).allInnerTexts();
    expect([...order].sort()).toEqual(
      [...PLATFORM, fullName(DUPLICATE_A), fullName(DUPLICATE_B)].sort(),
    );
    await shot(page, "roster-seven-columns");
  });

  test("044 EARS-36: a row click opens the card with every field read-only, the desk pair marked «возможный дубль»", async () => {
    test.skip(!eventId, "depends on the roster seeded above");
    const page = desk;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${eventId}/roster`);
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 4");

    await rowControl(page, fullName(DUPLICATE_A)).click();
    const panel = card(page);
    await expect(panel).toBeVisible();
    // The inspector does not cover the roster at this width.
    await expect(panel).toHaveAttribute("data-modal", "false");
    await expect(page).toHaveURL(/[?&]registration=[0-9a-f-]{36}/);
    await expect(panel.getByTestId("participant-card-fullName")).toHaveText(
      fullName(DUPLICATE_A),
    );
    await expect(panel.getByTestId("participant-card-phone")).toHaveText(
      DUPLICATE_A.phone,
    );
    await expect(panel.getByTestId("participant-card-email")).toHaveText(
      duplicateEmail,
    );
    await expect(panel.getByTestId("participant-card-workplace")).toHaveText(
      "ГКБ №1",
    );
    await expect(panel.getByTestId("participant-card-city")).toContainText(
      "Химки",
    );
    await expect(panel.getByTestId("participant-card-region")).toHaveText(
      "Московская область",
    );
    await expect(
      panel.getByTestId("participant-card-specialtyName"),
    ).not.toHaveText("");
    await expect(
      panel.getByTestId("participant-card-registeredAt"),
    ).not.toHaveText("");
    await expect(panel.getByTestId("participant-card-origin")).toHaveText(
      "Стойка регистрации",
    );
    await expect(panel.getByTestId("participant-card-consent")).toContainText(
      "Обработка персональных данных",
    );
    await expect(panel.getByTestId("participant-card-consent")).toContainText(
      "На бумаге",
    );
    // The consent version is a long unbroken token (`<date>.sha256-<64 hex>`):
    // every fact wraps inside the panel instead of running past its edge.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await panel
        .locator("dd")
        .evaluateAll((dds) => dds.map((dd) => dd.scrollWidth - dd.clientWidth));
      expect(
        Math.max(...overflow),
        `a card fact overflows the panel at ${width}px`,
      ).toBeLessThanOrEqual(0);
      // Contacts read as plain body text: an address is one token, never
      // broken across lines, cut with an ellipsis only when it cannot fit,
      // the whole value in its title and selectable in the text.
      for (const [testId, value] of [
        ["participant-card-email", duplicateEmail],
        ["participant-card-phone", DUPLICATE_A.phone],
      ] as const) {
        // On the desktop inspector the address has the row to itself and fits.
        await expectOneLineValue(
          panel.getByTestId(testId),
          value,
          width,
          width === 1440,
        );
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(panel.getByTestId("participant-card-mail")).toHaveText(
      /^(Отправлено .+ МСК|Не доставлено .+ МСК|—)$/,
    );
    // V-20 — the card carries the marker for the pair sharing one phone.
    await expect(panel.getByTestId("participant-card-duplicate")).toContainText(
      "Возможный дубль",
    );
    // Read-only: no field, no delete — the one control is the day marks.
    await expect(
      panel.locator("input:not([type='checkbox']), textarea, select"),
    ).toHaveCount(0);
    await expect(panel.getByRole("checkbox")).toHaveCount(2);
    await expect(panel).not.toContainText("аккаунт");

    // A platform row: no answers, never a duplicate.
    await rowControl(page, PLATFORM[0]!).click();
    await expect(panel.getByTestId("participant-card-fullName")).toHaveText(
      PLATFORM[0]!,
    );
    await expect(panel.getByTestId("participant-card-origin")).toHaveText(
      "Платформа",
    );
    await expect(panel.getByTestId("participant-card-duplicate")).toHaveCount(
      0,
    );
  });

  test("044 EARS-36: ↑/↓ walk the rows and the address follows; Esc closes and gives the focus back to the row", async () => {
    test.skip(!eventId, "depends on the roster seeded above");
    const page = desk;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${eventId}/roster`);
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 4");
    const names = await nameCells(page).allInnerTexts();

    await rowControl(page, names[0]!).click();
    const panel = card(page);
    const fullNameFact = panel.getByTestId("participant-card-fullName");
    await expect(fullNameFact).toHaveText(names[0]!);
    const first = registrationParam(page);

    // ↑ at the first row stays put.
    await page.keyboard.press("ArrowUp");
    await expect(fullNameFact).toHaveText(names[0]!);
    await page.keyboard.press("ArrowDown");
    await expect(fullNameFact).toHaveText(names[1]!);
    await expect.poll(() => registrationParam(page)).not.toBe(first);
    const second = registrationParam(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(fullNameFact).toHaveText(names[3]!);
    // ↓ at the last row stays put.
    await page.keyboard.press("ArrowDown");
    await expect(fullNameFact).toHaveText(names[3]!);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(fullNameFact).toHaveText(names[1]!);
    await expect.poll(() => registrationParam(page)).toBe(second);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect.poll(() => registrationParam(page)).toBeNull();
    await expect(rowControl(page, names[1]!)).toBeFocused();

    // Enter on the focused row opens it again.
    await page.keyboard.press("Enter");
    await expect(fullNameFact).toHaveText(names[1]!);
  });

  test("044 EARS-36: after a second row click ↓ moves to the next participant, not the page", async () => {
    test.skip(!eventId, "depends on the roster seeded above");
    const page = desk;
    // Wide enough for the non-modal inspector (≥ lg), short enough that the
    // page itself can scroll — an arrow the card missed would move it.
    await page.setViewportSize({ width: 1440, height: 420 });
    await page.goto(`/events/${eventId}/roster`);
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 4");
    const names = await nameCells(page).allInnerTexts();

    await rowControl(page, names[0]!).click();
    const panel = card(page);
    const fullNameFact = panel.getByTestId("participant-card-fullName");
    await expect(fullNameFact).toHaveText(names[0]!);

    // Switch rows while the panel stays open.
    await rowControl(page, names[2]!).click();
    await expect(fullNameFact).toHaveText(names[2]!);
    const third = registrationParam(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await page.keyboard.press("ArrowDown");
    await expect(fullNameFact).toHaveText(names[3]!);
    await expect.poll(() => registrationParam(page)).not.toBe(third);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // Esc still gives the focus back to the row whose card was open.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(rowControl(page, names[3]!)).toBeFocused();
  });

  test("044 EARS-36: a direct ?registration= link opens the card on load", async () => {
    test.skip(!eventId, "depends on the roster seeded above");
    const page = desk;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${eventId}/roster`);
    await rowControl(page, PLATFORM[1]!).click();
    await expect(page).toHaveURL(/[?&]registration=[0-9a-f-]{36}/);
    const link = page.url();

    await page.goto(`/events/${eventId}/roster`);
    await expect(card(page)).toHaveCount(0);
    await page.goto(link);
    await expect(
      card(page).getByTestId("participant-card-fullName"),
    ).toHaveText(PLATFORM[1]!);

    // An id that is no registration of this event reads nothing.
    await page.goto(
      `/events/${eventId}/roster?registration=00000000-0000-4000-8000-000000000000`,
    );
    await expect(
      card(page).getByTestId("participant-card-error"),
    ).toContainText("Такой записи нет в реестре этого мероприятия.");
  });

  test("044 EARS-36: a mark in the card flips the roster's box and lands in the day's history", async () => {
    test.skip(!eventId, "depends on the roster seeded above");
    const page = desk;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${eventId}/roster`);
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 4");
    const target = fullName(DUPLICATE_B);
    const row = visible(
      page.getByTestId("roster-table").locator("tbody tr", { hasText: target }),
    );
    await expect(
      row.getByRole("checkbox", { name: DAY_1_LABEL }),
    ).not.toBeChecked();

    await rowControl(page, target).click();
    const panel = card(page);
    await expect(panel.getByTestId("participant-card-fullName")).toHaveText(
      target,
    );
    // The mark history is secondary: collapsed until the registrar opens it.
    const disclosure = panel.getByTestId("participant-card-history");
    const history = panel.getByTestId(`participant-card-history-${DAY_1}`);
    await expect(history).toBeHidden();
    await disclosure.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(history).toBeVisible();
    await expect(history).toContainText("Отметок не было.");

    const answered = page.waitForResponse(
      (res) =>
        res.request().method() === "PUT" &&
        res.url().endsWith(`/attendance/${DAY_1}`),
    );
    await panel.getByTestId("attendance-cell").getByText("23.04").click();
    expect((await answered).status()).toBe(200);
    await expect(
      panel.getByRole("checkbox", { name: DAY_1_LABEL }),
    ).toBeChecked();
    await expect(
      row.getByRole("checkbox", { name: DAY_1_LABEL }),
    ).toBeChecked();
    await expect(
      history.getByTestId("participant-card-history-entry"),
    ).toHaveCount(1);
    await expect(
      history.getByTestId("participant-card-history-entry"),
    ).toContainText(/ — .+ МСК — отметил$/);
    await shot(page, "participant-card-attendance");

    // Evidence: the open card, desktop inspector and phone full cover, both palettes.
    // The day click above scrolls the card body; the evidence shows it from the top,
    // where the registrar first looks.
    for (const [name, width, height] of [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await panel
        .getByTestId("participant-card")
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
      await expect(panel).toHaveAttribute(
        "data-modal",
        name === "desktop" ? "false" : "true",
      );
      for (const palette of ["light", "dark"] as const) {
        await setPalette(page, palette);
        await shot(page, `participant-card-panel-${name}-${palette}`);
      }
    }
    await setPalette(page, "light");
  });

  test("044 EARS-35/36: the desk's «Открыть запись» for an already-registered email lands on the open card", async () => {
    test.skip(!eventId, "depends on the roster seeded above");
    const page = desk;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/events/${eventId}/roster`);
    await expect(page.getByTestId("roster-total")).toHaveText("Найдено: 4");
    expect(
      await addDeskParticipant(page, { ...DUPLICATE_A, email: duplicateEmail }),
    ).toBe("existing");
    await page.getByTestId("desk-entry-open-existing").click();
    await expect(page.getByTestId("desk-entry-panel")).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]registration=[0-9a-f-]{36}/);
    await expect(card(page).getByTestId("participant-card-email")).toHaveText(
      duplicateEmail,
    );
  });
});
