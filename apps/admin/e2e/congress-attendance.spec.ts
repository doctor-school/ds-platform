import { mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { bootstrapRegistrarAccount } from "./support/admin-session";
import {
  createPublishedEvent,
  eventSlugFromRoster,
  registerDoctorThroughPlatform,
} from "./support/congress-roster";
import { bindRegistrarToEvent } from "./support/event-grants";
import { ADMIN_ORIGIN, signInAsAdmin } from "./support/sign-in";
import { visible } from "./support/visible";

/**
 * 044 EARS-34 / EARS-38 — the roster's «Присутствие» column and presence filter,
 * driven by a congress registrar bound to one event against the real admin →
 * api → Postgres chain (V-25). The marks are written by the real
 * `PUT …/attendance/:day` route and read back through the roster route; nothing
 * is mocked. The event is authored through the 007 admin form, the rows by the
 * platform registration path (EARS-16), the binding by the tech-lead SQL
 * runbook (`support/event-grants.ts`, until #2378).
 *
 * The api must run with `CONGRESS_SIGNUP_EVENT_DAYS=2027-04-23,2027-04-24` (the
 * `admin-e2e` CI job's value). Dev-stand-gated like the rest of the flows tier:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… DATABASE_URL=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-attendance.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the approved-non-canvas `responsive-web` evidence:
 * `attendance-cell-{desktop,mobile}-{light,dark}.png` + `attendance-filter.png`.
 * Dark = the design-system `.dark` token block on the document root (the admin
 * ships no theme toggle; the `congress-roster.spec.ts` recipe).
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const DAY_1 = "2027-04-23";
const DAY_2 = "2027-04-24";

const DAY_1_LABEL = "23.04 — присутствие 23 апреля";
const DAY_2_LABEL = "24.04 — присутствие 24 апреля";

const MARKED = "Абрамова Анна Ильинична";
const OTHERS = ["Борисова Вера Павловна", "Власова Галина Олеговна"];

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
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

/**
 * The day box of the ONE row on screen (the caller narrows by search first).
 * The table and the phone cards both render the cell; only the variant for
 * the current width is visible.
 */
function dayBox(page: Page, label: string) {
  return visible(page.getByRole("checkbox", { name: label }));
}

/** Click one box and wait for the real PUT to answer 200. */
async function mark(page: Page, label: string, day: string) {
  const answered = page.waitForResponse(
    (res) =>
      res.request().method() === "PUT" &&
      res.url().endsWith(`/attendance/${day}`),
  );
  await visible(page.getByTestId("attendance-cell"))
    .getByText(label === DAY_1_LABEL ? "23.04" : "24.04")
    .click();
  expect((await answered).status()).toBe(200);
}

function nameCells(page: Page) {
  return visible(
    page
      .getByTestId("roster-table")
      .locator("[data-testid='roster-cell-fullName']"),
  );
}

test.describe.configure({ mode: "serial" });

test.describe("044 EARS-34 — attendance per congress day on the roster", () => {
  let eventId = "";
  let deskContext: BrowserContext | undefined;
  let desk: Page;

  test.afterAll(async () => {
    await deskContext?.close();
  });

  test("044 EARS-34: a registrar bound to the event marks a day, it survives a reload, and unmarks it", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    eventId = await createPublishedEvent(page, `Конгресс-присутствие ${Date.now()}`);
    const slug = await eventSlugFromRoster(page, eventId);
    for (const name of [MARKED, ...OTHERS]) {
      await registerDoctorThroughPlatform(browser, slug, name);
    }

    // EARS-38 — the desk is a registrar bound to THIS event only.
    const registrar = await bootstrapRegistrarAccount(ADMIN_ORIGIN);
    await bindRegistrarToEvent(registrar.email, slug);
    deskContext = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    desk = await deskContext.newPage();
    await desk.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(desk, registrar);
    await desk.waitForURL(new RegExp(`/events/${eventId}/roster$`));
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 3");

    // The column exists and every row carries one box per congress day.
    await expect(
      desk.getByTestId("roster-table").locator("thead th").last(),
    ).toHaveText("Присутствие");
    await expect(
      visible(desk.getByRole("checkbox", { name: DAY_1_LABEL })),
    ).toHaveCount(3);
    await expect(
      visible(desk.getByRole("checkbox", { name: DAY_2_LABEL })),
    ).toHaveCount(3);

    const search = desk.getByRole("searchbox", { name: "Поиск участника" });
    await search.fill(MARKED);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");
    await expect(dayBox(desk, DAY_1_LABEL)).not.toBeChecked();

    // A click is the whole act — no save button.
    await mark(desk, DAY_1_LABEL, DAY_1);
    await expect(dayBox(desk, DAY_1_LABEL)).toBeChecked();
    await expect(dayBox(desk, DAY_2_LABEL)).not.toBeChecked();
    await expect(desk.getByTestId("attendance-error")).toHaveCount(0);

    // Both renders of the row (table + phone cards) carry the confirmed mark:
    // crossing the md breakpoint without a reload shows it on the phone card.
    await desk.setViewportSize({ width: 390, height: 844 });
    await expect(dayBox(desk, DAY_1_LABEL)).toBeChecked();
    await desk.setViewportSize({ width: 1440, height: 900 });

    // The mark is the server's: a fresh read shows 23.04 set, 24.04 untouched.
    await desk.reload();
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 3");
    await expect(
      visible(desk.getByRole("checkbox", { name: DAY_1_LABEL, checked: true })),
    ).toHaveCount(1);
    await shot(desk, "attendance-cell-desktop-light");
    await setPalette(desk, "dark");
    await shot(desk, "attendance-cell-desktop-dark");
    await setPalette(desk, "light");
    await desk.getByRole("searchbox", { name: "Поиск участника" }).fill(MARKED);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");
    await expect(dayBox(desk, DAY_1_LABEL)).toBeChecked();
    await expect(dayBox(desk, DAY_2_LABEL)).not.toBeChecked();

    // Phone width: the record cards carry the same boxes, no sideways scroll.
    await desk.getByRole("searchbox", { name: "Поиск участника" }).fill("");
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 3");
    await desk.setViewportSize({ width: 390, height: 844 });
    await expect(
      visible(desk.getByRole("checkbox", { name: DAY_1_LABEL, checked: true })),
    ).toHaveCount(1);
    expect(
      await desk.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      "the roster does not scroll sideways on a phone",
    ).toBe(0);
    await shot(desk, "attendance-cell-mobile-light");
    await setPalette(desk, "dark");
    await shot(desk, "attendance-cell-mobile-dark");
    await setPalette(desk, "light");
    await desk.setViewportSize({ width: 1440, height: 900 });
    await desk.getByRole("searchbox", { name: "Поиск участника" }).fill(MARKED);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");

    // Unmark and back: both directions are the same idempotent PUT.
    await mark(desk, DAY_2_LABEL, DAY_2);
    await expect(dayBox(desk, DAY_2_LABEL)).toBeChecked();
    await mark(desk, DAY_2_LABEL, DAY_2);
    await expect(dayBox(desk, DAY_2_LABEL)).not.toBeChecked();
    await desk.reload();
    await desk.getByRole("searchbox", { name: "Поиск участника" }).fill(MARKED);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");
    await expect(dayBox(desk, DAY_1_LABEL)).toBeChecked();
    await expect(dayBox(desk, DAY_2_LABEL)).not.toBeChecked();
  });

  test("044 EARS-34: the presence filter narrows the roster by day — «Присутствовал» / «Не отмечен» — and composes with search", async () => {
    test.skip(!eventId, "depends on the event and desk seeded above");
    test.setTimeout(120_000);
    await desk.goto(`/events/${eventId}/roster`);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 3");

    const day = desk.getByTestId("roster-attendance-day");
    const presence = desk.getByTestId("roster-attendance-presence");
    // A presence means nothing without its day.
    await expect(presence).toBeDisabled();
    await day.selectOption(DAY_1);
    await expect(presence).toBeEnabled();

    await presence.selectOption("marked");
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");
    await expect(nameCells(desk)).toHaveText([MARKED]);
    await shot(desk, "attendance-filter");

    await presence.selectOption("unmarked");
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 2");
    expect((await nameCells(desk).allInnerTexts()).sort()).toEqual(
      [...OTHERS].sort(),
    );

    // Composes with search: «Не отмечен» ∩ «Борисова».
    const search = desk.getByRole("searchbox", { name: "Поиск участника" });
    await search.fill("Борисова");
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");
    await expect(nameCells(desk)).toHaveText([OTHERS[0]!]);

    // Marking under an active filter re-reads the list: the row leaves the
    // «Не отмечен» set it no longer belongs to.
    await mark(desk, DAY_1_LABEL, DAY_1);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 0");
    await search.fill("");
    await presence.selectOption("marked");
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 2");
    expect((await nameCells(desk).allInnerTexts()).sort()).toEqual(
      [MARKED, OTHERS[0]!].sort(),
    );

    // Clearing the day clears the presence and restores the whole roster.
    await day.selectOption("");
    await expect(presence).toBeDisabled();
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 3");
  });

  test("044 EARS-34: the roster with the attendance column is axe-clean (WCAG 2.1 AA)", async () => {
    test.skip(!eventId, "depends on the event and desk seeded above");
    await desk.goto(`/events/${eventId}/roster`);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 3");
    await desk.getByTestId("roster-attendance-day").selectOption(DAY_1);
    await expect(desk.getByTestId("roster-attendance-presence")).toBeEnabled();
    const results = await new AxeBuilder({ page: desk })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target).flat(),
    }));
    expect(summary, "axe violations on the roster").toEqual([]);
  });
});
