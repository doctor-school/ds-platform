import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInAsAdmin } from "@ds/e2e/admin-events";
import {
  chooseProjectDefaultAudience,
  chooseProjectStage,
} from "./support/event-classification";
import { selectRelationshipCombobox } from "./support/relationship-combobox";

/**
 * 030 EARS-1, 2, 3, 6, 17, 18 (#3503) — the project container on the REAL
 * Refine → NestJS → Postgres path: the project form with its stage and stage
 * note and no project kind, the «Результаты» tab saved as one ordered set, the
 * «Виды результатов» book (add, refused duplicate, rename, a retire refused
 * while a project holds the kind, retire, restore), the publish refusal that
 * links each missing item to its tab, and the list marks of a project the
 * forward migration left without results. Every screen is also driven at a
 * 390 px phone width without horizontal scrolling of the page (EARS-20); the
 * axe half is `e2e/a11y/a11y-axe.e2e.spec.ts` («030 EARS-20 …»).
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec; run against a booted
 * admin + api (`DOCTOR_PUBLIC_ORIGIN` set on the api — the storefront origin a
 * result link must sit on) with `--config=playwright.flows.config.ts`, and
 * `DATABASE_URL` for the EARS-17 fixture.
 *
 * `E2E_SHOT_DIR` opts into the captures the PR body cites; unset, the spec
 * still asserts.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };
/** The api's configured doctor-storefront origin (CI: `https://doctor.ds.test`). */
const STOREFRONT =
  process.env.DOCTOR_PUBLIC_ORIGIN ?? "https://doctor.ds.test";

const stamp = Date.now();
const projectTitle = `Школа гастроэнтерологии ${stamp}`;
const kindTitle = `Вебинар ${stamp}`;
const renamedKind = `Вебинар-разбор ${stamp}`;

/** The page itself never scrolls sideways (EARS-20). */
async function expectNoPageSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${page.url()} side-scrolls by ${overflow}px`).toBe(0);
}

/** Each screen in both schemes, at the current viewport. */
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: `${SHOT_DIR}/${name}-${colorScheme}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Desktop and phone captures of the current screen, plus the side-scroll check. */
async function shots(page: Page, name: string): Promise<void> {
  await shot(page, `${name}-desktop`);
  await page.setViewportSize(NARROW);
  await expectNoPageSideScroll(page);
  await shot(page, `${name}-mobile`);
  await page.setViewportSize(WIDE);
}

async function createProject(
  page: Page,
  title: string,
  stage: "running" | "soon" = "running",
): Promise<string> {
  await page.goto("/projects/create");
  await page.getByTestId("project-form").waitFor({ state: "visible" });
  await page.getByTestId("project-title").fill(title);
  await page.getByTestId("project-description").fill("Описание проекта.");
  await chooseProjectDefaultAudience(page);
  if (stage === "running") await chooseProjectStage(page);
  else await page.getByTestId("project-stage-note").fill("Набираем экспертов");
  await page.getByTestId("submit-project").click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url();
}

async function openOutputKind(page: Page, title: string): Promise<void> {
  await page.goto("/project-output-kinds");
  await page
    .getByTestId("project-output-kinds-table")
    .getByRole("link", { name: title, exact: true })
    .click();
  await page.waitForURL(/\/project-output-kinds\/[0-9a-f-]{36}$/, {
    timeout: 20_000,
  });
}

let projectUrl = "";

test.describe.configure({ mode: "serial" });

test.describe("030 — the project container in the live admin", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDE);
    await signInAsAdmin(page);
  });

  test("030 EARS-1: a project is authored with a stage and a stage note and no project kind", async ({
    page,
  }) => {
    await page.getByTestId("nav-projects").click();
    await page.waitForURL(/\/projects$/, { timeout: 20_000 });
    await page.getByTestId("projects-create").click();
    await page.waitForURL(/\/projects\/create$/, { timeout: 20_000 });

    // No project kind is offered; a new project starts «Скоро».
    await expect(page.getByTestId("project-kind")).toHaveCount(0);
    await expect(page.getByText("Вид проекта")).toHaveCount(0);
    await expect(page.getByTestId("project-stage")).toContainText("Стадия");
    await expect(page.getByTestId("project-stage-soon")).toBeChecked();
    await expect(page.getByTestId("project-stage-note")).toBeVisible();

    // ── Reject: «Скоро» without «Что происходит сейчас» ────────────────────
    await page.getByTestId("project-title").fill(projectTitle);
    await page.getByTestId("project-description").fill("Школа для врачей.");
    await chooseProjectDefaultAudience(page);
    await page.getByTestId("submit-project").click();
    await expect(
      page.getByText("Для стадии «Скоро» напишите, что происходит сейчас."),
    ).toBeVisible();
    await expect(page.getByTestId("project-stage-note")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(page.url()).toMatch(/\/projects\/create$/);
    await shots(page, "project-form");

    // ── Accept ─────────────────────────────────────────────────────────────
    await page.getByTestId("project-stage-note").fill("Набираем экспертов");
    await page.getByTestId("submit-project").click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    projectUrl = page.url();
    await expect(page.getByTestId("project-stage-soon")).toBeChecked();
    await expect(page.getByTestId("project-stage-note")).toHaveValue(
      "Набираем экспертов",
    );
    // A project created since 030 carries no former 012 kind.
    await expect(page.getByTestId("project-legacy-kind")).toHaveCount(0);

    // ── Another stage owes no note, and the note field leaves the form ─────
    await chooseProjectStage(page, "completed");
    await expect(page.getByTestId("project-stage-note")).toHaveCount(0);
    await page.getByTestId("submit-project").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("project-stage-completed")).toBeChecked();
    await expect(page.getByTestId("project-stage-note")).toHaveCount(0);

    // ── Back to «Проект идёт» for the rest of the walk ─────────────────────
    await chooseProjectStage(page, "running");
    await page.getByTestId("submit-project").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
  });

  test("030 EARS-3, EARS-18: the «Виды результатов» book lists, adds, refuses a duplicate and renames", async ({
    page,
  }) => {
    // EARS-18: the section is in the platform administrator's chrome.
    await expect(page.getByTestId("nav-project-output-kinds")).toHaveText(
      "Виды результатов",
    );
    await page.getByTestId("nav-project-output-kinds").click();
    await page.waitForURL(/\/project-output-kinds$/, { timeout: 20_000 });
    const table = page.getByTestId("project-output-kinds-table");
    for (const seeded of [
      "Школа",
      "Курс",
      "Подкаст",
      "Событие",
      "Конгресс",
      "Клуб",
    ]) {
      await expect(table).toContainText(seeded);
    }
    await expect(page.getByTestId("output-kind-count-shkola").first()).toBeAttached();
    await expect(page.getByTestId("project-output-kinds-filters")).toHaveCount(0);

    // ── Reject: empty, then a duplicate active title (case-insensitive) ────
    await page.getByTestId("project-output-kinds-create").click();
    await page.waitForURL(/\/project-output-kinds\/create$/, {
      timeout: 20_000,
    });
    await page.getByTestId("output-kind-title").fill("   ");
    await page.getByTestId("submit-output-kind").click();
    await expect(page.getByText("Обязательное поле.")).toBeVisible();
    await page.getByTestId("output-kind-title").fill("подкаст");
    await page.getByTestId("submit-output-kind").click();
    await expect(
      page.getByText("Вид с таким названием уже есть", { exact: false }),
    ).toBeVisible();
    await expect(page.getByTestId("output-kind-title")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByTestId("create-error")).toHaveCount(0);
    expect(page.url()).toMatch(/\/project-output-kinds\/create$/);

    // ── Accept: the new kind joins the book with no results ────────────────
    await page.getByTestId("output-kind-title").fill(kindTitle);
    await page.getByTestId("submit-output-kind").click();
    await page.waitForURL(/\/project-output-kinds$/, { timeout: 20_000 });
    await expect(table).toContainText(kindTitle);

    // ── Rename: same record, new title ─────────────────────────────────────
    await openOutputKind(page, kindTitle);
    await expect(page.getByTestId("output-kind-status")).toHaveText("Действует");
    await expect(page.getByTestId("output-kind-results")).toHaveText(
      "Этот вид пока не носит ни один результат.",
    );
    await page.getByTestId("output-kind-title").fill(renamedKind);
    await page.getByTestId("submit-output-kind").click();
    await expect(page.getByTestId("output-kind-notice")).toHaveText(
      "Изменения сохранены.",
    );
    await expect(page.getByTestId("output-kind-heading")).toHaveText(
      renamedKind,
    );
    await page.goto("/project-output-kinds");
    await expect(table).toContainText(renamedKind);
    await shots(page, "output-kinds");
  });

  test("030 EARS-2: the results are saved as one ordered set, with refused rows marked at their fields", async ({
    page,
  }) => {
    await page.goto(projectUrl);
    await page.getByTestId("tab-results").click();
    await expect(page.getByTestId("results-empty")).toHaveText(
      "Результатов пока нет. Без результатов проект не выходит на сайт.",
    );

    // EARS-3: the kind added a moment ago is offered at once.
    await page.getByTestId("result-add").click();
    await expect(page.getByTestId("result-kind-0")).toContainText(renamedKind);

    // ── Reject in the browser: no kind, no title, a non-https link ─────────
    await page.getByTestId("result-url-0").fill("doctor.school/school");
    await page.getByTestId("results-save").click();
    await expect(page.getByText("Выберите вид результата.")).toBeVisible();
    await expect(page.getByText("Обязательное поле.")).toBeVisible();
    await expect(
      page.getByText("Нужна полная ссылка, начинающаяся с https://."),
    ).toBeVisible();

    // ── Reject on the server: an https link off the storefront origin ──────
    await page.getByTestId("result-kind-0").selectOption({ label: renamedKind });
    await page.getByTestId("result-title-0").fill("Разборы клинических случаев");
    await page.getByTestId("result-url-0").fill("https://example.com/webinar");
    await page.getByTestId("results-save").click();
    await expect(page.getByTestId("results-error")).toHaveText(
      "Не удалось сохранить результаты. Ничего не изменилось — проверьте строки и попробуйте снова.",
    );
    await expect(
      page.getByText("Ссылка должна вести на doctor.school и начинаться с https://."),
    ).toBeVisible();
    await expect(page.getByTestId("result-url-0")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    // ── Accept: two rows, the second moved first, saved as one set ─────────
    await page
      .getByTestId("result-url-0")
      .fill(`${STOREFRONT}/webinars/razbory`);
    await page.getByTestId("result-add").click();
    await page.getByTestId("result-kind-1").selectOption({ label: "Школа" });
    await page.getByTestId("result-title-1").fill("Школа гастроэнтеролога");
    await page
      .getByTestId("result-description-1")
      .fill("Годовая программа для практикующих врачей.");
    await expect(page.getByTestId("result-up-0")).toBeDisabled();
    await expect(page.getByTestId("result-down-1")).toBeDisabled();
    await page.getByTestId("result-up-1").click();
    await expect(page.getByTestId("result-title-0")).toHaveValue(
      "Школа гастроэнтеролога",
    );
    await page.getByTestId("results-save").click();
    await expect(page.getByTestId("results-saved")).toHaveText(
      "Результаты сохранены.",
    );

    // The stored order is the order on screen.
    await page.reload();
    await page.getByTestId("tab-results").click();
    await expect(page.getByTestId("result-title-0")).toHaveValue(
      "Школа гастроэнтеролога",
    );
    await expect(page.getByTestId("result-title-1")).toHaveValue(
      "Разборы клинических случаев",
    );
    await expect(page.getByTestId("result-url-1")).toHaveValue(
      `${STOREFRONT}/webinars/razbory`,
    );
    await shots(page, "results");

    // The book counts the result of the new kind.
    await openOutputKind(page, renamedKind);
    await expect(page.getByTestId("output-kind-results")).toHaveText(
      "Вид у 1 результата.",
    );
  });

  test("030 EARS-3: retiring a kind a project holds is refused with that project, then retire and restore work", async ({
    page,
  }) => {
    // ── Reject: the draft project holds the kind ───────────────────────────
    await openOutputKind(page, renamedKind);
    await page.getByTestId("output-kind-retire").click();
    await expect(page.getByTestId("output-kind-error")).toContainText(
      "Вид нельзя снять: его носят результаты проектов ниже.",
    );
    const holder = page
      .getByTestId("output-kind-holders")
      .getByRole("link", { name: projectTitle });
    await expect(holder).toHaveAttribute(
      "href",
      new URL(projectUrl).pathname,
    );
    await expect(page.getByTestId("output-kind-status")).toHaveText("Действует");

    // ── The fix: the project stops holding the kind ────────────────────────
    await holder.click();
    await page.waitForURL(projectUrl);
    await page.getByTestId("tab-results").click();
    await page.getByTestId("result-remove-1").click();
    await page.getByTestId("results-save").click();
    await expect(page.getByTestId("results-saved")).toBeVisible();

    // ── Accept: retire, no longer offered; restore under the same id ───────
    await openOutputKind(page, renamedKind);
    const recordUrl = page.url();
    await page.getByTestId("output-kind-retire").click();
    await expect(page.getByTestId("output-kind-notice")).toHaveText("Вид снят.");
    await expect(page.getByTestId("output-kind-status")).toHaveText("Снят");

    await page.goto(projectUrl);
    await page.getByTestId("tab-results").click();
    await page.getByTestId("result-add").click();
    await expect(page.getByTestId("result-kind-1")).not.toContainText(
      renamedKind,
    );

    await page.goto(recordUrl);
    await page.getByTestId("output-kind-restore").click();
    await expect(page.getByTestId("output-kind-notice")).toHaveText(
      "Вид снова действует.",
    );
    await expect(page.getByTestId("output-kind-status")).toHaveText("Действует");
    expect(page.url()).toBe(recordUrl);
  });

  test("030 EARS-6: a refused publish links each missing item to its tab, and publishes once they are filled", async ({
    page,
  }) => {
    const title = `Клуб гепатологов ${stamp}`;
    const url = await createProject(page, title);

    // ── Reject: no result and no curator, each a link to its tab ───────────
    await page.getByTestId("tab-publish").click();
    await page.getByTestId("projects-publish").click();
    await expect(page.getByTestId("publish-error")).toContainText(
      "Проект пока нельзя опубликовать — ничего не изменилось.",
    );
    const blockers = page.getByTestId("publish-blockers");
    await expect(page.getByTestId("publish-blocker-results")).toHaveText(
      "Хотя бы один результат — вкладка «Результаты»",
    );
    await expect(page.getByTestId("publish-blocker-curator")).toHaveText(
      "Один куратор — вкладка «Эксперты»",
    );
    await expect(blockers.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("project-status")).toHaveText("Черновик");
    await page.setViewportSize(NARROW);
    await expectNoPageSideScroll(page);
    await page.setViewportSize(WIDE);

    // The link opens the tab that fixes the item.
    await page.getByTestId("publish-blocker-results").click();
    await expect(page.getByTestId("tab-results")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByTestId("result-add").click();
    await page.getByTestId("result-kind-0").selectOption({ label: "Клуб" });
    await page.getByTestId("result-title-0").fill("Клуб гепатологов");
    await page.getByTestId("results-save").click();
    await expect(page.getByTestId("results-saved")).toBeVisible();

    // Still refused — for the curator alone, which links to «Эксперты».
    await page.getByTestId("tab-publish").click();
    await page.getByTestId("projects-publish").click();
    await expect(blockers.getByRole("listitem")).toHaveCount(1);
    await page.getByTestId("publish-blocker-curator").click();
    await expect(page.getByTestId("tab-experts")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // ── The fix: a PUBLISHED expert seated as the curator ──────────────────
    const familyName = `Кураторова-${stamp}`;
    await page.goto("/experts/create");
    await page.getByTestId("expert-family-name").fill(familyName);
    await page.getByTestId("expert-given-name").fill("Анна");
    await page.getByTestId("expert-patronymic").fill("Петровна");
    await page.getByTestId("expert-professional-role").fill("Гепатолог");
    await page.getByTestId("expert-credentials").fill("К. м. н.");
    await page.getByTestId("expert-affiliation").fill("Клиника гепатологии");
    await page
      .getByTestId("expert-bio")
      .fill("Пятнадцать лет клинической практики.");
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.getByTestId("tab-publish").click();
    await page.getByTestId("experts-publish").click();
    await expect(page.getByTestId("publish-notice")).toBeVisible();
    await page.getByTestId("tab-projects").click();
    await selectRelationshipCombobox(
      page,
      "project-expert-link-combobox",
      title,
      title,
    );
    await page.getByTestId("project-expert-link-role").selectOption("curator");
    await page.getByTestId("project-expert-link-submit").click();
    await expect(page.getByTestId("project-experts-notice")).toBeVisible();

    // ── Accept ─────────────────────────────────────────────────────────────
    await page.goto(url);
    await page.getByTestId("tab-publish").click();
    await page.getByTestId("projects-publish").click();
    await expect(page.getByTestId("publish-notice")).toBeVisible();
    await expect(page.getByTestId("project-status")).toHaveText("Опубликован");

    // A published project keeps at least one result.
    await page.getByTestId("tab-results").click();
    await page.getByTestId("result-remove-0").click();
    await page.getByTestId("results-save").click();
    await expect(page.getByTestId("results-error")).toHaveText(
      "У опубликованного проекта должен остаться хотя бы один результат.",
    );
  });

  test("030 EARS-17: a project the migration left without results shows its former kind and is marked off the site", async ({
    page,
  }) => {
    const title = `Медиапроект до 030 ${stamp}`;
    const url = await createProject(page, title);
    const id = url.split("/").pop()!;
    await asMigrated(id);

    // ── The list: the stage column and the off-site mark ───────────────────
    await page.goto("/projects");
    await page.getByRole("searchbox", { name: "Поиск" }).fill(title);
    const table = page.getByTestId("projects-table");
    await expect(table).toContainText(title);
    await expect(page.getByTestId(`stage-${id}`).first()).toHaveText(
      "Проект идёт",
    );
    await expect(page.getByTestId(`off-site-${id}`).first()).toHaveText(
      "Не на сайте: нет результатов",
    );
    // A published project WITH results carries no mark.
    await page.getByRole("searchbox", { name: "Поиск" }).fill(`Клуб гепатологов ${stamp}`);
    await expect(table).toContainText(`Клуб гепатологов ${stamp}`);
    await expect(table).not.toContainText("Не на сайте: нет результатов");
    await page.getByRole("searchbox", { name: "Поиск" }).fill(String(stamp));
    await expect(table).toContainText(title);
    await shots(page, "list");

    // ── The form: the read-only former-kind hint, no kind control ──────────
    await page.goto(url);
    await expect(page.getByTestId("project-legacy-kind")).toHaveText(
      "Прежний тип (012): Медиа — укажите результаты проекта",
    );
    await expect(page.getByTestId("project-kind")).toHaveCount(0);
  });
});

/**
 * Put a project in the state 030 EARS-17's forward migration leaves a former
 * 012 project in: its kind kept only as `legacy_kind`, already published, and
 * no results. No product path produces that state — the API refuses to publish
 * a project without results and never writes `legacy_kind` — so the row is set
 * the way the migration sets it, on the stand database (`DATABASE_URL`).
 */
async function asMigrated(id: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("E2E requires DATABASE_URL in the environment");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE projects
          SET legacy_kind = 'media', status = 'published',
              first_published_at = now(), version = version + 1
        WHERE id = $1`,
      [id],
    );
    expect(result.rowCount, `migrated-state fixture for ${id}`).toBe(1);
  } finally {
    await client.end();
  }
}
