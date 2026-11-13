import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "@ds/e2e/admin-events";
import { adminWrite, expectNoPageSideScroll } from "./support/admin-write";

/**
 * 024 EARS-28 / EARS-29 slice 1 (#4011) — the «Обучение» section on the REAL
 * Refine → NestJS → Postgres path: the course list, a module and a lesson added
 * on the course screen, the lesson composed of a video (provider source), a
 * download (uploaded file) and the exit test, the publish refused with every
 * missing item named in words and then accepted, and the «Путь (Duolingo)»
 * preset applied on the course.
 *
 * The school and the course are created through the admin API (024-design §10
 * slice 1: the structure editor is 023's, #4018), over the direction, expert
 * and project the admin API authors here — no fixture SQL.
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec: run with
 * `--config=playwright.flows.config.ts` against a booted admin + api.
 * `E2E_SHOT_DIR` opts into the captures the PR body cites.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 900 };

const RUN = Date.now().toString(36);
const COURSE_SLUG = `ekg-${RUN}`;
const COURSE_TITLE = `ЭКГ с нуля ${RUN}`;
const MODULE_TITLE = "Ритм";
const LESSON_TITLE = "Основы ЭКГ";
/** A minimal PDF the 012 media contract accepts for a download step. */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function shots(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) {
    await page.setViewportSize(NARROW);
    await expectNoPageSideScroll(page);
    await page.setViewportSize(WIDE);
    return;
  }
  for (const [width, viewport] of [
    ["1280", WIDE],
    ["390", NARROW],
  ] as const) {
    await page.setViewportSize(viewport);
    await expectNoPageSideScroll(page);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: `${SHOT_DIR}/admin-${name}-${width}-${colorScheme}.png`,
        fullPage: true,
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(WIDE);
}

/** Direction, expert, project, school and course through the admin API. */
async function authorCourse(page: Page): Promise<string> {
  const direction = await adminWrite(page, {
    path: "/v1/admin/directions",
    payload: { title: `Кардиология ${RUN}` },
  });
  const expert = await adminWrite(page, {
    path: "/v1/admin/experts",
    payload: {
      familyName: `Учебная${RUN}`,
      givenName: "Анна",
      professionalRole: "Кардиолог",
      credentials: "к. м. н.",
      affiliation: "Академия Doctor.School",
      bio: "Ведёт школу ЭКГ.",
    },
  });
  const project = await adminWrite(page, {
    path: "/v1/admin/projects",
    payload: {
      title: `Школа ЭКГ ${RUN}`,
      stage: "running",
      defaultAudience: "doctors",
    },
  });
  const school = await adminWrite(page, {
    path: "/v1/admin/learning/schools",
    payload: {
      directionId: direction.id,
      leadExpertId: expert.id,
      projectId: project.id,
      slug: `school-${RUN}`,
      title: `Школа ЭКГ ${RUN}`,
    },
  });
  const course = await adminWrite(page, {
    path: "/v1/admin/learning/courses",
    payload: {
      schoolId: school.id,
      projectId: project.id,
      slug: COURSE_SLUG,
      title: COURSE_TITLE,
    },
  });
  return course.id;
}

test("024 EARS-28 / EARS-29 — a staff member composes a lesson, publishes it and applies a preset", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await signInAsAdmin(page);
  await page.goto("/learning");
  const courseId = await authorCourse(page);

  // The section and its course list.
  await page.goto("/");
  await page.getByTestId("nav-learning").click();
  await expect(page).toHaveURL(/\/learning$/u);
  // The shared stand holds many courses: find this run's by its address.
  const search = page.getByRole("searchbox", { name: "Поиск курса" });
  await search.fill(COURSE_SLUG);
  await search.press("Enter");
  await expect(page.getByTestId("learning-courses-total")).toHaveText(
    "Найдено: 1",
  );
  // The list draws a table and, at a phone width, cards: the visible one counts.
  const row = page
    .getByTestId(`learning-course-row-${COURSE_SLUG}`)
    .filter({ visible: true });
  await expect(row).toHaveText(COURSE_TITLE);
  await expect(
    page
      .getByTestId(`learning-course-state-${COURSE_SLUG}`)
      .filter({ visible: true }),
  ).toHaveText("Черновик");
  await shots(page, "learning-list");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/learning/courses/${courseId}$`, "u"));

  // A module, then a lesson in it.
  await expect(
    page.getByRole("heading", { level: 1, name: COURSE_TITLE }),
  ).toBeVisible();
  await page.getByLabel("Название модуля").fill(MODULE_TITLE);
  await page.getByRole("button", { name: "Добавить модуль" }).click();
  const module = page.getByTestId("module-1");
  await expect(
    module.getByRole("heading", { name: `Модуль 1. ${MODULE_TITLE}` }),
  ).toBeVisible();
  await module.getByLabel("Название урока").fill(LESSON_TITLE);
  await module.getByLabel("Описание").fill("Зубцы, интервалы и ритм.");
  await module.getByLabel("Анонс").fill("Пять признаков синусового ритма.");
  await module.getByRole("button", { name: "Добавить урок" }).click();
  const lessonLink = module.getByRole("link", {
    name: new RegExp(`Урок 1\\. ${LESSON_TITLE}`, "u"),
  });
  await expect(lessonLink).toBeVisible();
  await lessonLink.click();
  await expect(page).toHaveURL(/\/learning\/lessons\/[0-9a-f-]{36}$/u);
  await expect(page.getByTestId("lesson-state")).toHaveText("Черновик");

  // A video and a download, each without its media yet.
  const form = page.getByTestId("add-step-form");
  await form.getByLabel("Тип шага").selectOption("video");
  await form.getByLabel("Название шага").fill("Ритм сердца");
  await form.getByLabel("Длительность шага, мин").fill("8");
  await form.getByLabel("Длина видео, секунд").fill("420");
  await form.getByRole("button", { name: "Добавить шаг" }).click();
  await expect(page.getByTestId("step-row-1")).toContainText("Ритм сердца");
  await form.getByLabel("Тип шага").selectOption("download");
  await form.getByLabel("Название шага").fill("Памятка");
  await form.getByLabel("Длительность шага, мин").fill("2");
  await form.getByLabel("Имя файла у врача").fill("pamyatka.pdf");
  await form.getByRole("button", { name: "Добавить шаг" }).click();
  await expect(page.getByTestId("step-row-2")).toContainText("Памятка");

  // Reject: the publish names every missing item and changes nothing.
  await page.getByRole("button", { name: "Опубликовать урок" }).click();
  const refusal = page.getByTestId("publish-refusal");
  await expect(refusal).toContainText("Урок пока нельзя опубликовать");
  await expect(refusal.getByRole("listitem")).toContainText([
    "Шаг 1 «Ритм сердца»: укажите площадку и ссылку на видео.",
    "Шаг 2 «Памятка»: загрузите файл.",
  ]);
  await expect(page.getByTestId("lesson-state")).toHaveText("Черновик");
  await shots(page, "lesson-publish-refused");

  // The missing items: the video's source, the file, the exit test.
  const video = page.getByTestId("step-row-1");
  await video.getByLabel("Площадка").selectOption("youtube");
  await video.getByLabel("Ссылка или идентификатор видео").fill("dQw4w9WgXcQ");
  await video.getByRole("button", { name: "Сохранить источник" }).click();
  await expect(video).toContainText("Источник: YouTube · dQw4w9WgXcQ");
  const download = page.getByTestId("step-row-2");
  await download.getByLabel("Файл").setInputFiles({
    name: "pamyatka.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await download.getByRole("button", { name: "Загрузить файл" }).click();
  await expect(download).toContainText("Файл загружен: application/pdf");
  await form.getByLabel("Тип шага").selectOption("test");
  await form.getByLabel("Название шага").fill("Итоговый тест");
  await form.getByLabel("Длительность шага, мин").fill("5");
  await form.getByLabel("Вопрос 1", { exact: true }).fill("Норма интервала PQ?");
  await form.getByLabel("Вопрос 1, вариант 1", { exact: true }).fill("300 мс");
  await form.getByLabel("Вопрос 1, вариант 2", { exact: true }).fill("120–200 мс");
  // The DS radio is a visually hidden input inside its label: click the label.
  const correct = form.getByLabel("Вопрос 1, вариант 2 — верный");
  await correct.locator("xpath=ancestor::label[1]").click();
  await expect(correct).toBeChecked();
  await form.getByRole("button", { name: "Добавить шаг" }).click();
  await expect(page.getByTestId("step-row-3")).toContainText("Итоговый тест");

  // Accept: the lesson is published.
  await page.getByRole("button", { name: "Опубликовать урок" }).click();
  await expect(page.getByTestId("lesson-state")).toHaveText("Опубликован");
  await expect(page.getByTestId("publish-refusal")).toHaveCount(0);
  await shots(page, "lesson-published");

  // The course's preset.
  await page.goto(`/learning/courses/${courseId}`);
  const panel = page.getByTestId("preset-panel");
  const preset = panel.getByLabel("Путь (Duolingo)");
  await preset.locator("xpath=ancestor::label[1]").click();
  await expect(preset).toBeChecked();
  await panel.getByRole("button", { name: "Применить пресет" }).click();
  await expect(panel.getByRole("status")).toContainText(
    "Пресет «Путь (Duolingo)» применён к курсу.",
  );
  await expect(panel.getByText("Применён: Путь (Duolingo)")).toBeVisible();
  await shots(page, "course-preset-applied");
});
