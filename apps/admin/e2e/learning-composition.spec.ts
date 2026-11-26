import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "@ds/e2e/admin-events";
import { adminWrite, expectNoPageSideScroll } from "./support/admin-write";
import { evidenceShot } from "./support/evidence-shot";

/**
 * 024 EARS-28 / EARS-29 slice 1 (#4011) — the «Обучение» section on the REAL
 * Refine → NestJS → Postgres path: the course list, a module and a lesson added
 * on the course screen, the lesson composed of a video (provider source), a
 * download (uploaded file) and the exit test, the publish refused with every
 * missing item named in words and then accepted, and the «Путь (Duolingo)»
 * preset applied on the course.
 *
 * The school and the course are created through the admin API, over the
 * direction, expert and project the admin API authors here — no fixture SQL;
 * the 023 structure editor screens have their own journey
 * (`learning-structure-editor.spec.ts`).
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec: run with
 * `--config=playwright.flows.config.ts` against a booted admin + api.
 * `E2E_SHOT_DIR` opts into the captures the PR body cites.
 */
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
  // The phone width never side-scrolls, with or without captures.
  await page.setViewportSize(NARROW);
  await expectNoPageSideScroll(page);
  await page.setViewportSize(WIDE);
  // Captures at both widths and both palettes: the admin's dark palette is the
  // `.dark` token block on the document root, not `prefers-color-scheme`.
  await evidenceShot(page, `admin-${name}`);
}

/**
 * A raw admin write whose refusal the journey asserts (`adminWrite` expects a
 * success): the same CSRF + `Idempotency-Key` envelope, `If-Match` from the
 * row's version.
 */
async function adminRefusal(
  page: Page,
  input: { method: "POST" | "PUT"; path: string; payload: unknown; version?: number },
): Promise<{ status: number; errorCode?: string; paths: string[] }> {
  return page.evaluate(async ({ method, path, payload, version }) => {
    const csrf =
      document.cookie
        .split("; ")
        .find((pair) => pair.startsWith("__Host-ds_admin_csrf="))
        ?.split("=")[1] ?? "";
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-ds-admin-csrf": decodeURIComponent(csrf),
      "idempotency-key": crypto.randomUUID(),
    };
    if (version !== undefined) headers["if-match"] = `W/"${version}"`;
    const res = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as {
      errorCode?: string;
      errors?: { path: string }[];
    } | null;
    return {
      status: res.status,
      errorCode: json?.errorCode,
      paths: (json?.errors ?? []).map((e) => e.path),
    };
  }, input);
}

/** The lesson as the admin API holds it (step ids and versions). */
async function adminLesson(
  page: Page,
  lessonId: string,
): Promise<{ steps: { id: string; version: number }[] }> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/v1/admin/learning/lessons/${id}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return res.json();
  }, lessonId);
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
  // EARS-10: the picker offers only providers whose player reports a position
  // and names the one it leaves out; the API refuses that provider too.
  const providers = await video
    .getByLabel("Площадка")
    .locator("option")
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  expect(providers).not.toContain("cdnvideo");
  await expect(video).toContainText(
    "для шагов недоступна: её плеер не сообщает, сколько видео просмотрено.",
  );
  const lessonId = page.url().split("/").pop()!;
  const draft = await adminLesson(page, lessonId);
  const cdn = await adminRefusal(page, {
    method: "PUT",
    path: `/v1/admin/learning/steps/${draft.steps[0]!.id}/source`,
    payload: {
      provider: "cdnvideo",
      embedRef:
        "https://playercdn.cdnvideo.ru/aloha/players/auto_player1.html?clid=kcta544ubo&plid=c263cdf6-253e-400b-a008-d1775d3ee190",
    },
    version: draft.steps[0]!.version,
  });
  expect(cdn).toEqual({
    status: 400,
    errorCode: "VALIDATION_FAILED",
    paths: ["provider"],
  });
  await shots(page, "step-video-provider-hint");
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
  // A published lesson is read-only (EARS-4): no add form, no step controls,
  // the reason in words, and the API refuses a step write.
  await expect(page.getByTestId("lesson-read-only")).toContainText(
    "Урок опубликован, его шаги не меняются. Чтобы изменить шаги, снимите урок с публикации.",
  );
  await expect(page.getByTestId("add-step-form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Сохранить источник" })).toHaveCount(0);
  await shots(page, "lesson-published");
  const added = await adminRefusal(page, {
    method: "POST",
    path: "/v1/admin/learning/steps",
    payload: { lessonId, type: "download", title: "Ещё памятка", durationMin: 1, payload: { fileName: "x.pdf" } },
  });
  expect(added.status).toBe(409);
  expect(added.errorCode).toBe("INVALID_TRANSITION");
  await expect(page.getByTestId("step-row-4")).toHaveCount(0);

  // «Снять с публикации» returns it to a draft whose steps can change again,
  // then the lesson is published once more for the course.
  await page.getByRole("button", { name: "Снять с публикации" }).click();
  await expect(page.getByTestId("lesson-state")).toHaveText("Черновик");
  await expect(page.getByTestId("lesson-read-only")).toHaveCount(0);
  await expect(page.getByTestId("add-step-form")).toBeVisible();
  await shots(page, "lesson-unpublished");
  await page.getByRole("button", { name: "Опубликовать урок" }).click();
  await expect(page.getByTestId("lesson-state")).toHaveText("Опубликован");

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

  // Reopened, the picker starts on the applied preset, not on the first one.
  await page.reload();
  await expect(panel.getByText("Применён: Путь (Duolingo)")).toBeVisible();
  await expect(panel.getByLabel("Путь (Duolingo)")).toBeChecked();
  await expect(panel.getByLabel("ДПО / аккредитация")).not.toBeChecked();
});
