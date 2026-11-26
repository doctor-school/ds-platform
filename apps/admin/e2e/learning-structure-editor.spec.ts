import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "@ds/e2e/admin-events";
import { adminWrite, expectNoPageSideScroll } from "./support/admin-write";
import { evidenceShot } from "./support/evidence-shot";
import { searchRelationshipCombobox } from "./support/relationship-combobox";

/**
 * 023 EARS-26 / EARS-27 / EARS-28 (#4018) — the school → course → module
 * structure editor on the REAL Refine → NestJS → Postgres path: «Школы» lists
 * the schools, a staff member creates a school by picking its direction,
 * leading expert and project, a second school of the same expert in the same
 * direction is refused in words, the school's EARS-1 data is edited (facts up
 * to four), two courses are created in it and reordered, the school is
 * published and doctors read it as «скоро»; in a course two modules are added,
 * reordered and renamed, the publish of a course without a published lesson is
 * refused in words, and with one it is accepted and the school reads «open».
 *
 * The direction, expert and project are authored through the admin API (their
 * own editors are 012's); the lesson the course publish needs is composed
 * through the admin API too (its editor is 024's, `learning-composition.spec.ts`).
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec: run with
 * `--config=playwright.flows.config.ts` against a booted admin + api.
 * `E2E_SHOT_DIR` opts into the captures the PR body cites.
 */
const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 900 };

const RUN = Date.now().toString(36);
const DIRECTION = `Неврология ${RUN}`;
const FAMILY = `Структурная${RUN}`;
const PROJECT = `Школа неврологии ${RUN}`;
const SCHOOL_SLUG = `nevro-${RUN}`;
const SCHOOL_TITLE = `Школа неврологии ${RUN}`;
const COURSE_A = { title: `Инсульт ${RUN}`, slug: `insult-${RUN}` };
const COURSE_B = { title: `Эпилепсия ${RUN}`, slug: `epilepsiya-${RUN}` };

async function shots(page: Page, name: string): Promise<void> {
  // The phone width never side-scrolls, with or without captures.
  await page.setViewportSize(NARROW);
  await expectNoPageSideScroll(page);
  await page.setViewportSize(WIDE);
  await evidenceShot(page, `admin-${name}`);
}

/** Pick a picker's option by the text it shows (the shared stand holds many rows). */
async function pick(
  page: Page,
  triggerId: string,
  query: string,
  label: RegExp,
): Promise<void> {
  const panel = await searchRelationshipCombobox(page, triggerId, query);
  await panel.getByText(label).first().click();
}

/** The create form of «Новая школа», filled with this run's taxonomy. */
async function fillNewSchool(page: Page, slug: string): Promise<void> {
  await pick(page, "school-direction", DIRECTION, new RegExp(DIRECTION, "u"));
  await pick(page, "school-expert", FAMILY, new RegExp(FAMILY, "u"));
  await pick(page, "school-project", PROJECT, new RegExp(PROJECT, "u"));
  await page.getByLabel("Название школы").fill(SCHOOL_TITLE);
  await page.getByLabel("Адрес школы (латиница, цифры и дефисы)").fill(slug);
}

/** A lesson that can be published: one exit test, through the admin API. */
async function publishedLesson(
  page: Page,
  moduleId: string,
  projectId: string,
) {
  const lesson = await adminWrite(page, {
    path: "/v1/admin/learning/lessons",
    payload: { moduleId, projectId, title: "Острый период" },
  });
  await adminWrite(page, {
    path: "/v1/admin/learning/steps",
    payload: {
      lessonId: lesson.id,
      type: "test",
      title: "Итоговый тест",
      durationMin: 3,
      payload: {
        kind: "exit",
        questions: [
          {
            text: "Окно тромболизиса?",
            options: [
              { text: "4,5 часа", correct: true },
              { text: "24 часа", correct: false },
            ],
          },
        ],
      },
    },
  });
  const current = await page.evaluate(async (id) => {
    const res = await fetch(`/v1/admin/learning/lessons/${id}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return (await res.json()) as { version: number };
  }, lesson.id);
  await adminWrite(page, {
    path: `/v1/admin/learning/lessons/${lesson.id}/publish`,
    version: current.version,
  });
}

/** The course as the admin API holds it (its project and module ids). */
async function adminCourse(
  page: Page,
  courseId: string,
): Promise<{ projectId: string; modules: { id: string; title: string }[] }> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/v1/admin/learning/courses/${id}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return res.json();
  }, courseId);
}

/** The school as doctors read it (`soon` until a course is published). */
async function publicSchool(
  page: Page,
): Promise<{ status: number; school?: { status: string } }> {
  const res = await page.request.get(`/v1/learning/schools/${SCHOOL_SLUG}`);
  const body = (await res.json().catch(() => ({}))) as {
    school?: { status: string };
  };
  return { status: res.status(), school: body.school };
}

test("023 EARS-26 / EARS-27 / EARS-28 — a staff member builds a school, its courses and modules, and publishes them", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await signInAsAdmin(page);
  await page.goto("/learning");
  await adminWrite(page, {
    path: "/v1/admin/directions",
    payload: { title: DIRECTION },
  });
  await adminWrite(page, {
    path: "/v1/admin/experts",
    payload: {
      familyName: FAMILY,
      givenName: "Ирина",
      professionalRole: "Невролог",
      credentials: "д. м. н.",
      affiliation: "Академия Doctor.School",
      bio: "Ведёт школу неврологии.",
    },
  });
  await adminWrite(page, {
    path: "/v1/admin/projects",
    payload: { title: PROJECT, stage: "running", defaultAudience: "doctors" },
  });

  // «Обучение» → «Школы» → «Создать школу».
  await page.goto("/learning");
  await page.getByTestId("learning-schools-link").click();
  await expect(page).toHaveURL(/\/learning\/schools$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Школы" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Создать школу" }).first().click();
  await expect(page).toHaveURL(/\/learning\/schools\/new$/u);

  // Reject: a school without its direction, expert and project is not sent.
  await page.getByLabel("Название школы").fill(SCHOOL_TITLE);
  await page
    .getByLabel("Адрес школы (латиница, цифры и дефисы)")
    .fill(SCHOOL_SLUG);
  await page.getByRole("button", { name: "Создать школу" }).click();
  await expect(page.getByTestId("write-refusal")).toContainText(
    "Направление: Выберите направление",
  );
  await expect(page).toHaveURL(/\/learning\/schools\/new$/u);

  // Accept: the school is created as a draft and opens in its editor.
  await fillNewSchool(page, SCHOOL_SLUG);
  await shots(page, "school-new");
  await page.getByRole("button", { name: "Создать школу" }).click();
  await expect(page).toHaveURL(/\/learning\/schools\/[0-9a-f-]{36}$/u);
  const schoolId = page.url().split("/").pop()!;
  await expect(
    page.getByRole("heading", { level: 1, name: SCHOOL_TITLE }),
  ).toBeVisible();
  await expect(page.getByTestId("school-state")).toHaveText("Черновик");
  expect((await publicSchool(page)).status).toBe(404);

  // Reject: the same expert cannot lead a second school in the direction.
  await page.goto("/learning/schools/new");
  await fillNewSchool(page, `${SCHOOL_SLUG}-2`);
  await page.getByRole("button", { name: "Создать школу" }).click();
  await expect(page.getByTestId("write-refusal")).toContainText(
    "Этот эксперт уже ведёт школу в этом направлении.",
  );
  await expect(page.getByTestId("school-expert-error")).toContainText(
    "Этот эксперт уже ведёт школу в этом направлении.",
  );
  await expect(page.locator("#school-expert")).toHaveAccessibleDescription(
    "Этот эксперт уже ведёт школу в этом направлении.",
  );
  await expect(page).toHaveURL(/\/learning\/schools\/new$/u);
  await shots(page, "school-new-expert-taken");

  // The list finds the school by its address, a draft.
  await page.goto("/learning/schools");
  const search = page.getByRole("searchbox", { name: "Поиск школы" });
  await search.fill(SCHOOL_SLUG);
  await search.press("Enter");
  await expect(
    page
      .getByTestId(`learning-school-state-${SCHOOL_SLUG}`)
      .filter({ visible: true }),
  ).toHaveText("Черновик");
  await shots(page, "schools-list");
  await page
    .getByTestId(`learning-school-row-${SCHOOL_SLUG}`)
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/learning/schools/${schoolId}$`, "u"),
  );

  // The school's EARS-1 data: description, «скоро», facts up to four.
  await page.getByLabel("Описание").fill("Неврология для практикующего врача.");
  await page.getByLabel("Пометка «скоро»").fill("Первый курс готовится");
  for (let no = 1; no <= 4; no += 1) {
    await page.getByRole("button", { name: "Добавить факт" }).click();
    await page.getByLabel(`Факт ${no} — заголовок`).fill(`${no * 10}`);
    await page.getByLabel(`Факт ${no} — текст`).fill(`факт номер ${no}`);
  }
  await expect(page.getByRole("button", { name: "Добавить факт" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByTestId("write-saved")).toContainText("Сохранено.");
  await page.reload();
  await expect(page.getByLabel("Факт 4 — текст")).toHaveValue("факт номер 4");
  await expect(page.getByLabel("Пометка «скоро»")).toHaveValue(
    "Первый курс готовится",
  );

  // Two courses in the school, then the second moved to the top.
  const newCourse = page.getByRole("form", { name: "Новый курс" });
  for (const course of [COURSE_A, COURSE_B]) {
    await newCourse.getByLabel("Название курса").fill(course.title);
    await newCourse
      .getByLabel("Адрес курса (латиница, цифры и дефисы)")
      .fill(course.slug);
    await newCourse.getByRole("button", { name: "Создать курс" }).click();
    await expect(
      page
        .getByTestId("school-courses")
        .getByRole("link", { name: course.title }),
    ).toBeVisible();
  }
  const courseLinks = page.getByTestId("school-courses").getByRole("link");
  await expect(courseLinks).toHaveText([COURSE_A.title, COURSE_B.title]);
  await page
    .getByRole("button", { name: `Поднять курс «${COURSE_B.title}»` })
    .click();
  await expect(courseLinks).toHaveText([COURSE_B.title, COURSE_A.title]);
  await page.reload();
  await expect(courseLinks).toHaveText([COURSE_B.title, COURSE_A.title]);

  // Publish the school: doctors read it, «скоро» while no course is published.
  await page.getByRole("button", { name: "Опубликовать школу" }).click();
  await expect(page.getByTestId("school-state")).toHaveText("Опубликована");
  await expect(
    page.getByRole("button", { name: "Снять школу с публикации" }),
  ).toBeVisible();
  await expect(page.getByTestId("school-state-hint")).toHaveText(
    "Школа видна врачам на сайте. Пока в ней нет опубликованного курса, врачи видят её как «скоро».",
  );
  await expect(page.getByTestId("school-interest-count")).toHaveText(
    "Интерес к школе: 0 врачей",
  );
  const soon = await publicSchool(page);
  expect(soon.status).toBe(200);
  expect(soon.school?.status).toBe("soon");
  await shots(page, "school-published");

  // The course: two modules, the second moved up, then renamed.
  await courseLinks.filter({ hasText: COURSE_A.title }).click();
  await expect(page).toHaveURL(/\/learning\/courses\/[0-9a-f-]{36}$/u);
  const courseId = page.url().split("/").pop()!;
  await expect(
    page.getByRole("heading", { level: 1, name: COURSE_A.title }),
  ).toBeVisible();
  for (const title of ["Диагностика", "Лечение"]) {
    await page.getByLabel("Название модуля", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Добавить модуль" }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(title, "u") }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Поднять модуль 2" }).click();
  await expect(
    page
      .getByTestId("module-1")
      .getByRole("heading", { name: "Модуль 1. Лечение" }),
  ).toBeVisible();
  await page
    .getByLabel("Новое название модуля 1")
    .fill("Лечение и реабилитация");
  await page
    .getByTestId("module-1")
    .getByRole("button", { name: "Переименовать" })
    .click();
  await expect(
    page
      .getByTestId("module-1")
      .getByRole("heading", { name: "Модуль 1. Лечение и реабилитация" }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("module-2")
      .getByRole("heading", { name: "Модуль 2. Диагностика" }),
  ).toBeVisible();

  // The course's EARS-1 data: a save says so.
  await page.getByLabel("Академических часов").fill("36");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByTestId("write-saved")).toContainText("Сохранено.");
  await expect(page.getByLabel("Академических часов")).toHaveValue("36");
  await shots(page, "course-saved");

  // Reject: a course without a published lesson is not published.
  await page.getByRole("button", { name: "Опубликовать курс" }).click();
  await expect(page.getByTestId("write-refusal")).toContainText(
    "Курс нельзя опубликовать: в нём нет опубликованного урока. Опубликуйте хотя бы один урок.",
  );
  await expect(page.getByTestId("course-state")).toHaveText("Черновик");
  await shots(page, "course-publish-refused");

  // Accept: with a published lesson the course is published, the school opens.
  const course = await adminCourse(page, courseId);
  await publishedLesson(page, course.modules[0]!.id, course.projectId);
  await page.reload();
  await page.getByRole("button", { name: "Опубликовать курс" }).click();
  await expect(page.getByTestId("course-state")).toHaveText("Опубликован");
  await expect(page.getByTestId("write-refusal")).toHaveCount(0);
  const open = await publicSchool(page);
  expect(open.status).toBe(200);
  expect(open.school?.status).toBe("open");
  await shots(page, "course-published");

  // «К школе» returns to the editor, where the course reads published.
  await page.getByRole("link", { name: "К школе" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/learning/schools/${schoolId}$`, "u"),
  );
  await expect(
    page.getByTestId("school-courses").getByRole("listitem").nth(1),
  ).toContainText("Опубликован");
  await expect(page.getByTestId("school-state-hint")).toHaveText(
    "Школа видна врачам на сайте и открыта: в ней есть опубликованный курс.",
  );
  await shots(page, "school-open");
});
