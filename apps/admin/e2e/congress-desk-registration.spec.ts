import { mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { bootstrapRegistrarAccount } from "./support/admin-session";
import {
  createPublishedEvent,
  eventSlugFromRoster,
} from "./support/congress-roster";
import { bindRegistrarToEvent, unbindRegistrar } from "./support/event-grants";
import { ADMIN_ORIGIN, signInAsAdmin } from "./support/sign-in";
import { visible } from "./support/visible";

/**
 * 044 EARS-35 — the registrar's desk entry from the roster screen, driven
 * against the real admin → api → Postgres chain (V-29; V-14 for the open
 * side panel). The event comes from the real 007 admin form; the registrar is a real
 * Zitadel account holding `event-registrar`, bound to the event through the
 * tech-lead SQL runbook (`bindRegistrarToEvent`). No mocked response: the row
 * the desk writes is read back through the roster route.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (flows tier):
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… DATABASE_URL=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/congress-desk-registration.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the evidence screenshots of the approved-non-canvas
 * source `feature-044-desk-registration-form-v1`: the `desk-entry-form` state as
 * the `responsive-web` set (desktop/mobile × light/dark) plus the existing and
 * the refused-without-consent states, and the refusal screen a withdrawn event
 * binding hands the page (`desk-entry-binding-refused`).
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * The admin's dark palette is the `.dark` token block on the document root (the
 * #1927 recipe, `congress-roster.spec.ts`); the token-painted `body` background
 * is the honest signal the recalculation happened.
 */
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

/** Wait for the panel's slide to finish (the axe spec's `settle`). */
async function settle(page: Page) {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (a) =>
            a.playState !== "running" ||
            a.effect?.getTiming().iterations === Infinity,
        ),
    undefined,
    { timeout: 5000 },
  );
}

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await settle(page);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Today's date as the roster's «Дата регистрации» cell prints it (МСК). */
function todayMsk(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function uniqueEmail(): string {
  return `walkin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.org`;
}

/** The desktop table's rows (the phone record cards are hidden at this width). */
function tableRows(page: Page) {
  return visible(page.getByTestId("roster-table").locator("tbody tr"));
}

/**
 * Pick an option of a DS `Combobox`: open it, type into its own query box and
 * click the option the list then offers.
 */
async function pickFromCombobox(
  page: Page,
  testId: string,
  searchLabel: string,
  query: string,
  option: string | RegExp,
) {
  await page.getByTestId(testId).click();
  await page
    .getByRole("combobox", { name: searchLabel, exact: true })
    .fill(query);
  const listbox = page.getByRole("listbox");
  await listbox.getByRole("option", { name: option }).first().click();
  await expect(listbox).toHaveCount(0);
}

/**
 * The specialty book is searched on the SERVER: typing sends `?q=` to the
 * public search read, and the option picked is one the narrowed answer holds.
 */
async function pickSpecialty(page: Page) {
  await page.getByTestId("desk-specialtyId").click();
  // Scoped to the panel's listbox: the roster's own filter bar holds native
  // `<select>` options (the EARS-34 presence filter) that share the role.
  const first = page.getByRole("listbox").getByRole("option").first();
  await expect(first).toBeVisible();
  const name = (await first.innerText()).trim();
  const query = name.slice(0, 4);
  const searched = page.waitForRequest(
    (request) =>
      request.url().includes("/v1/public/specialties/search?q=") &&
      new URL(request.url()).searchParams.get("q") === query,
  );
  await page
    .getByRole("combobox", { name: "Поиск специальности", exact: true })
    .fill(query);
  await searched;
  await page
    .getByRole("listbox")
    .getByRole("option", { name, exact: true })
    .click();
  await expect(page.getByTestId("desk-specialtyId")).toContainText(name);
}

async function fillWalkIn(
  page: Page,
  email: string,
  place: "directory" | "unlisted" | "later" = "directory",
) {
  const panel = page.getByTestId("desk-entry-panel");
  await panel.getByTestId("desk-surname").fill("Сидорова");
  await panel.getByTestId("desk-firstName").fill("Мария");
  await panel.getByTestId("desk-patronymic").fill("Петровна");
  await panel.getByTestId("desk-email").fill(email);
  await panel.getByTestId("desk-contactPhone").fill("+7 (999) 123-45-67");
  await pickSpecialty(page);
  await panel.getByTestId("desk-workplace").fill("ГКБ №1");
  await fillPlace(page, place);
}

/** «Населённый пункт»: a directory pick, an unlisted place, or left empty. */
async function fillPlace(
  page: Page,
  place: "directory" | "unlisted" | "later",
) {
  const panel = page.getByTestId("desk-entry-panel");
  if (place === "later") return;
  if (place === "directory") {
    // A directory place fills the region silently and shows it as the hint.
    await pickFromCombobox(
      page,
      "desk-city",
      "Поиск населённого пункта",
      "Химки",
      /^Химки/,
    );
    await expect(panel.getByTestId("desk-city")).toContainText("Химки");
    await expect(panel.getByTestId("desk-city-hint")).toHaveText(
      "Московская область",
    );
    await expect(panel.getByTestId("desk-region")).toHaveCount(0);
  } else {
    // A place the directory does not hold reveals «Регион», empty.
    await expect(panel.getByTestId("desk-region")).toHaveCount(0);
    await pickFromCombobox(
      page,
      "desk-city",
      "Поиск населённого пункта",
      "Минск",
      "Нет в списке — указать «Минск»",
    );
    await expect(panel.getByTestId("desk-city")).toContainText("Минск");
    const region = panel.getByTestId("desk-region");
    await expect(region).toHaveValue("");
    await expect(panel).toContainText(
      "Этого населённого пункта нет в списке — укажите регион или страну.",
    );
    // The revealed field is announced through the polite status line.
    await expect(panel.getByTestId("desk-region-status")).toHaveText(
      "Добавлено поле «Регион». Этого населённого пункта нет в списке — укажите регион или страну.",
    );
    await region.fill("Беларусь");
  }
}

/**
 * The DS `Checkbox` keeps its native input `sr-only` under a drawn box, so the
 * operator's click lands on the wrapping label (the `legacy-broadcast.spec.ts`
 * precedent).
 */
async function tickPaperConsent(page: Page) {
  const box = page.getByTestId("desk-paperConsent");
  await box.locator("xpath=ancestor::label[1]").click();
  await expect(box).toBeChecked();
}

test.describe.configure({ mode: "serial" });

test.describe("044 EARS-35 — the registrar's desk entry on the roster screen", () => {
  let eventId = "";
  let context: BrowserContext | undefined;
  let desk: Page;
  let registrarEmail = "";
  const email = uniqueEmail();

  test.afterAll(async () => {
    await context?.close();
  });

  test("044 EARS-35: a registrar bound to the event enters a walk-in and the row appears with today's date", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(page);
    eventId = await createPublishedEvent(page, `Конгресс-стол ${Date.now()}`);
    const slug = await eventSlugFromRoster(page, eventId);

    const registrar = await bootstrapRegistrarAccount(ADMIN_ORIGIN);
    await bindRegistrarToEvent(registrar.email, slug);
    registrarEmail = registrar.email;
    context = await browser.newContext({ baseURL: ADMIN_ORIGIN });
    desk = await context.newPage();
    await desk.setViewportSize({ width: 1440, height: 900 });
    await signInAsAdmin(desk, registrar);
    await desk.waitForURL(new RegExp(`/events/${eventId}/roster$`));
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 0");

    await desk.getByTestId("desk-entry-open").click();
    const panel = desk.getByTestId("desk-entry-panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: "Добавить участника" }),
    ).toBeVisible();
    // `desk-entry-panel` — at a wide screen the panel is NON-modal: the roster
    // beside it stays visible and usable (its search takes typing), and a click
    // on the roster does not close the panel.
    await expect(panel).toHaveAttribute("data-modal", "false");
    await expect(desk.getByTestId("roster-table")).toBeVisible();
    const rosterSearch = desk.getByRole("searchbox", {
      name: "Поиск участника",
    });
    await rosterSearch.fill("Сидорова");
    await expect(rosterSearch).toHaveValue("Сидорова");
    await rosterSearch.fill("");
    await expect(panel).toBeVisible();

    // V-14: the roster screen stays axe-clean with the panel open.
    await settle(desk);
    const results = await new AxeBuilder({ page: desk })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target).flat(),
      })),
      "axe violations with the desk panel open",
    ).toEqual([]);

    // `desk-entry-form` in the panel — the responsive-web evidence set; below
    // `lg` the panel is a full-cover modal.
    for (const { name, width, height, modal } of [
      { name: "desktop", width: 1440, height: 900, modal: "false" },
      { name: "mobile", width: 390, height: 844, modal: "true" },
    ]) {
      await desk.setViewportSize({ width, height });
      await expect(panel).toHaveAttribute("data-modal", modal);
      for (const palette of ["light", "dark"] as const) {
        await setPalette(desk, palette);
        await shot(desk, `desk-entry-form-${name}-${palette}`);
      }
    }
    await setPalette(desk, "light");

    // A settlement pick at phone width (390), where the panel covers the page.
    await desk.setViewportSize({ width: 390, height: 844 });
    await pickFromCombobox(
      desk,
      "desk-city",
      "Поиск населённого пункта",
      "Химки",
      /^Химки/,
    );
    await expect(panel.getByTestId("desk-city")).toContainText("Химки");
    await expect(panel.getByTestId("desk-city-hint")).toHaveText(
      "Московская область",
    );
    await expect(panel.getByTestId("desk-region-status")).toHaveText("");
    await desk.setViewportSize({ width: 1440, height: 900 });

    await fillWalkIn(desk, email);
    await tickPaperConsent(desk);
    await panel.getByTestId("desk-entry-submit").click();

    // `desk-entry-accepted` — the panel closes, the roster names the entry.
    await expect(panel).toHaveCount(0);
    await expect(desk.getByTestId("desk-entry-accepted")).toHaveText(
      "Участник Сидорова Мария Петровна добавлен в реестр.",
    );
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");
    const row = tableRows(desk);
    await expect(row).toHaveCount(1);
    await expect(
      row.locator("[data-testid='roster-cell-fullName']"),
    ).toHaveText("Сидорова Мария Петровна");
    await expect(row.locator("[data-testid='roster-cell-email']")).toHaveText(
      email,
    );
    await expect(
      row.locator("[data-testid='roster-cell-registeredAt']"),
    ).toContainText(todayMsk());
  });

  test("044 EARS-35: the same email again names the existing registration and links to its row", async () => {
    test.skip(!eventId, "depends on the entry made by the first test");
    await desk.goto(`/events/${eventId}/roster`);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");

    await desk.getByTestId("desk-entry-open").click();
    const panel = desk.getByTestId("desk-entry-panel");
    await fillWalkIn(desk, email);
    await tickPaperConsent(desk);
    await panel.getByTestId("desk-entry-submit").click();

    // `desk-entry-existing` — the panel stays open and an info notice at the
    // top of the body says so explicitly (owner Stage-B round 2), taking the
    // focus; nothing about whether the account existed before.
    const existing = panel.getByTestId("desk-entry-existing");
    await expect(existing).toHaveAttribute("role", "status");
    await expect(existing).toBeFocused();
    await expect(existing.getByTestId("desk-entry-existing-title")).toHaveText(
      "Участник уже зарегистрирован",
    );
    await expect(existing).toContainText(
      `Участник с почтой ${email} уже есть в реестре этого мероприятия. Новая запись не создана.`,
    );
    await expect(existing.locator("b", { hasText: email })).toHaveCount(1);
    await expect(existing.getByTestId("desk-entry-open-existing")).toHaveText(
      "Открыть запись",
    );
    await expect(panel.getByTestId("desk-email")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(panel).not.toContainText("аккаунт");
    await shot(desk, "desk-entry-existing");

    // The notice stops being true once the address changes.
    await panel.getByTestId("desk-email").fill(`x${email}`);
    await expect(existing).toHaveCount(0);
    await panel.getByTestId("desk-email").fill(email);
    await panel.getByTestId("desk-entry-submit").click();
    await expect(existing).toBeFocused();

    await existing.getByTestId("desk-entry-open-existing").click();
    await expect(panel).toHaveCount(0);
    await expect(
      desk.getByRole("searchbox", { name: "Поиск участника" }),
    ).toHaveValue(email);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");
    await expect(
      tableRows(desk).locator("[data-testid='roster-cell-email']"),
    ).toHaveText(email);
  });

  test("044 EARS-35: without the paper-consent tick the entry is refused and no row is written", async () => {
    test.skip(!eventId, "depends on the event seeded by the first test");
    await desk.goto(`/events/${eventId}/roster`);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");

    const posts: string[] = [];
    desk.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes(`/events/${eventId}/registrations`)
      ) {
        posts.push(request.url());
      }
    });

    await desk.getByTestId("desk-entry-open").click();
    const panel = desk.getByTestId("desk-entry-panel");

    // Focus-on-first-error reaches a Combobox: every field before «Населённый
    // пункт» is filled, so the refused submit lands the focus on its control.
    await fillWalkIn(desk, uniqueEmail(), "later");
    await panel.getByTestId("desk-entry-submit").click();
    await expect(panel.getByTestId("desk-city")).toBeFocused();

    await fillPlace(desk, "unlisted");
    await panel.getByTestId("desk-entry-submit").click();

    // `desk-entry-refused-no-consent` — the box's own refusal; no request left.
    await expect(panel).toContainText(
      "Отметьте, что согласие на обработку персональных данных получено на бумаге.",
    );
    await expect(panel).toBeVisible();
    // The refusal sits at the foot of the scrolling panel body: bring it into
    // view so the evidence shows the refusal, not only the red box.
    await panel
      .getByText(
        "Отметьте, что согласие на обработку персональных данных получено на бумаге.",
      )
      .scrollIntoViewIfNeeded();
    await shot(desk, "desk-entry-refused-no-consent");
    expect(posts, "no desk request is sent without the tick").toEqual([]);

    await panel.getByRole("button", { name: "Отмена" }).click();
    await expect(panel).toHaveCount(0);
    await desk.reload();
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");
  });

  test("044 EARS-35: an answer that arrives after the panel was closed leaves no stale line on the next open", async () => {
    test.skip(!eventId, "depends on the entry made by the first test");
    await desk.goto(`/events/${eventId}/roster`);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");

    // Hold the real desk request until the panel is closed, then let it reach
    // the api unchanged: the late answer is the server's own `existing`.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registrations = `**/events/${eventId}/registrations`;
    await desk.route(registrations, async (route) => {
      await held;
      await route.continue();
    });

    await desk.getByTestId("desk-entry-open").click();
    const panel = desk.getByTestId("desk-entry-panel");
    await fillWalkIn(desk, email);
    await tickPaperConsent(desk);
    const answered = desk.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/events/${eventId}/registrations`),
    );
    await panel.getByTestId("desk-entry-submit").click();
    await panel.getByRole("button", { name: "Отмена" }).click();
    await expect(panel).toHaveCount(0);
    release();
    expect((await answered).ok()).toBe(true);
    await desk.unroute(registrations);

    await desk.getByTestId("desk-entry-open").click();
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("desk-entry-existing")).toHaveCount(0);
    await expect(panel.getByTestId("desk-email")).toHaveValue("");
    await desk.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("044 EARS-38: a binding withdrawn after the roster loaded turns the desk entry into the refusal screen, with no retry", async () => {
    test.skip(!eventId, "depends on the registrar bound by the first test");
    await desk.goto(`/events/${eventId}/roster`);
    await expect(desk.getByTestId("roster-total")).toHaveText("Найдено: 1");

    await desk.getByTestId("desk-entry-open").click();
    const panel = desk.getByTestId("desk-entry-panel");
    await fillWalkIn(desk, uniqueEmail());
    await tickPaperConsent(desk);

    // The tech lead withdraws the binding while the registrar is typing.
    await unbindRegistrar(registrarEmail);
    const answered = desk.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/events/${eventId}/registrations`),
    );
    await panel.getByTestId("desk-entry-submit").click();
    const refusal = await answered;
    expect(refusal.status()).toBe(403);
    expect(((await refusal.json()) as { errorCode: string }).errorCode).toBe(
      "EVENT_BINDING_REQUIRED",
    );

    // The refusal screen, not the panel's «попробуйте ещё раз»: nothing to retry.
    await expect(panel).toHaveCount(0);
    await expect(desk.getByTestId("access-refused")).toHaveText(
      "У этой учётной записи нет прав администратора.",
    );
    await expect(desk.getByTestId("desk-entry-open")).toHaveCount(0);
    await expect(desk.getByTestId("desk-entry-submit")).toHaveCount(0);
    await shot(desk, "desk-entry-binding-refused");
  });
});
