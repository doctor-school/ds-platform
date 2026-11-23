import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  bootstrapAdminSession,
  bootstrapRulesEditorAccount,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { expectNoPageSideScroll } from "./support/admin-write";
import { evidenceShot } from "./support/evidence-shot";
import { signInDoctorOnAdminOrigin } from "./support/storefront-session";

/**
 * 024 EARS-29 / EARS-30 / EARS-31 (#4012) — the rules part of V-12 on the REAL
 * Refine → NestJS → Postgres path:
 *
 *  - a `learning_rules_editor` raises the exit-test pass mark of a PUBLISHED
 *    course from 50 % to 80 %; the change dialog names how many doctors'
 *    statuses the change touches — the doctors this spec made pass at 50 %,
 *    counted by the server's preview, never a literal it computed itself — and
 *    «Сохранить заработанные зачёты» (preselected) keeps every one of them done;
 *  - the course takes «ДПО / аккредитация», a module is overridden to «в любом
 *    порядке», and a lesson of that module reads the order as «Унаследовано от:
 *    модуль»;
 *  - a staff member without the role sees the published course's and the
 *    platform's rules read-only with the reason in words, and the API refuses
 *    that staff member's write (403).
 *
 * Volume: the course is three modules of four lessons each, and three doctors
 * pass lesson 1 through the real doctor test endpoints (`/v1/me/learning/…`),
 * each in its own storefront session on the admin origin. Every row is written
 * by the production admin and doctor paths — no fixture SQL.
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec: run with
 * `--config=playwright.flows.config.ts` against a booted admin + api.
 * `E2E_SHOT_DIR` opts into the captures the PR body cites.
 */
const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 900 };

const RUN = Date.now().toString(36);
const COURSE_SLUG = `rules-${RUN}`;
const COURSE_TITLE = `Правила обучения ${RUN}`;
const MODULES = 3;
const LESSONS_PER_MODULE = 4;
const DOCTORS = 3;

interface Reply {
  status: number;
  etag: string | null;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** One admin or storefront API call from `page`: CSRF + `Idempotency-Key` on a write. */
async function api(
  page: Page,
  method: "GET" | "POST" | "PUT",
  path: string,
  payload?: unknown,
  ifMatch?: string | null,
): Promise<Reply> {
  return page.evaluate(
    async ({ method, path, payload, ifMatch }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((pair) => pair.startsWith("__Host-ds_admin_csrf="))
          ?.split("=")[1] ?? "";
      const headers: Record<string, string> = { accept: "application/json" };
      if (method !== "GET") {
        headers["x-ds-admin-csrf"] = decodeURIComponent(csrf);
        headers["idempotency-key"] = crypto.randomUUID();
      }
      if (ifMatch) headers["if-match"] = ifMatch;
      if (payload !== undefined) headers["content-type"] = "application/json";
      const res = await fetch(path, {
        method,
        credentials: "include",
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      return {
        status: res.status,
        etag: res.headers.get("etag"),
        json: await res.json().catch(() => null),
      };
    },
    { method, path, payload, ifMatch },
  );
}

async function ok(reply: Promise<Reply>, what: string): Promise<Reply> {
  const r = await reply;
  expect(r.status, `${what} → ${JSON.stringify(r.json)}`).toBeLessThan(300);
  return r;
}

interface TestStep {
  id: string;
  questions: { id: string; options: { id: string; correct: boolean }[] }[];
}

interface Course {
  courseId: string;
  moduleIds: string[];
  lessonIds: string[];
  firstTest: TestStep;
}

/**
 * Direction, expert, project, school, then the course of MODULES ×
 * LESSONS_PER_MODULE lessons, each one exit test of two questions; the course's
 * pass mark is 50 % while it is a draft, then every lesson and the course are
 * published.
 */
async function authorCourse(page: Page): Promise<Course> {
  const A = "/v1/admin";
  const direction = await ok(
    api(page, "POST", `${A}/directions`, { title: `Терапия ${RUN}` }),
    "direction",
  );
  const expert = await ok(
    api(page, "POST", `${A}/experts`, {
      familyName: `Правилова${RUN}`,
      givenName: "Ирина",
      professionalRole: "Терапевт",
      credentials: "к. м. н.",
      affiliation: "Академия Doctor.School",
      bio: "Ведёт школу терапии.",
    }),
    "expert",
  );
  const project = await ok(
    api(page, "POST", `${A}/projects`, {
      title: `Школа терапии ${RUN}`,
      stage: "running",
      defaultAudience: "doctors",
    }),
    "project",
  );
  const projectId = project.json.id as string;
  const school = await ok(
    api(page, "POST", `${A}/learning/schools`, {
      directionId: direction.json.id,
      leadExpertId: expert.json.id,
      projectId,
      slug: `school-${RUN}`,
      title: `Школа терапии ${RUN}`,
    }),
    "school",
  );
  const course = await ok(
    api(page, "POST", `${A}/learning/courses`, {
      schoolId: school.json.id,
      projectId,
      slug: COURSE_SLUG,
      title: COURSE_TITLE,
    }),
    "course",
  );
  const courseId = course.json.id as string;
  const moduleIds: string[] = [];
  const lessonIds: string[] = [];
  let firstTest: TestStep | undefined;
  for (let m = 1; m <= MODULES; m++) {
    const mod = await ok(
      api(page, "POST", `${A}/learning/modules`, {
        courseId,
        title: `Модуль ${m}`,
      }),
      `module ${m}`,
    );
    moduleIds.push(mod.json.id);
    for (let l = 1; l <= LESSONS_PER_MODULE; l++) {
      const lesson = await ok(
        api(page, "POST", `${A}/learning/lessons`, {
          moduleId: mod.json.id,
          projectId,
          title: `Урок ${m}.${l}`,
        }),
        `lesson ${m}.${l}`,
      );
      lessonIds.push(lesson.json.id);
      const step = await ok(
        api(page, "POST", `${A}/learning/steps`, {
          lessonId: lesson.json.id,
          type: "test",
          title: "Итоговый тест",
          durationMin: 3,
          payload: {
            kind: "exit",
            questions: [1, 2].map((q) => ({
              text: `Вопрос ${q}`,
              options: [
                { text: "Верно", correct: true },
                { text: "Неверно", correct: false },
              ],
            })),
          },
        }),
        `test ${m}.${l}`,
      );
      firstTest ??= step.json as TestStep;
    }
  }
  // The pass mark while the course is a draft: its editors set it.
  const rules = await ok(
    api(page, "GET", `${A}/learning/rules/course/${courseId}`),
    "course rules",
  );
  await ok(
    api(
      page,
      "PUT",
      `${A}/learning/rules/course/${courseId}`,
      { values: { ...rules.json.values, "test.threshold": 50 } },
      rules.etag,
    ),
    "course pass mark 50",
  );
  for (const id of lessonIds) {
    const read = await ok(
      api(page, "GET", `${A}/learning/lessons/${id}`),
      "lesson",
    );
    await ok(
      api(
        page,
        "POST",
        `${A}/learning/lessons/${id}/publish`,
        undefined,
        read.etag,
      ),
      "lesson publish",
    );
  }
  const read = await ok(
    api(page, "GET", `${A}/learning/courses/${courseId}`),
    "course",
  );
  await ok(
    api(
      page,
      "POST",
      `${A}/learning/courses/${courseId}/publish`,
      undefined,
      read.etag,
    ),
    "course publish",
  );
  return { courseId, moduleIds, lessonIds, firstTest: firstTest! };
}

/** A fresh doctor passes lesson 1's exit test with one answer of two right (50 %). */
async function doctorPassesAtHalf(
  browser: Browser,
  course: Course,
  n: number,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: ADMIN_ORIGIN });
  const page = await context.newPage();
  await page.goto("/login");
  await signInDoctorOnAdminOrigin(page, `rules-doctor-${n}`);
  const attempt = await ok(
    api(page, "POST", `/v1/me/learning/tests/${course.firstTest.id}/attempts`),
    `doctor ${n} attempt`,
  );
  const answers = (attempt.json.questions as { id: string }[]).map((q, i) => {
    const known = course.firstTest.questions.find((k) => k.id === q.id)!;
    return {
      questionId: q.id,
      optionId: known.options.find((o) => o.correct === (i === 0))!.id,
    };
  });
  const submitted = await ok(
    api(
      page,
      "POST",
      `/v1/me/learning/attempts/${attempt.json.attemptId}/submit`,
      {
        answers,
      },
    ),
    `doctor ${n} submit`,
  );
  expect(submitted.json.passed, JSON.stringify(submitted.json)).toBe(true);
  expect(await lessonStatus(page, course.lessonIds[0]!)).toBe("done");
  return page;
}

async function lessonStatus(page: Page, lessonId: string): Promise<string> {
  const read = await ok(
    api(page, "GET", `/v1/learning/lessons/${lessonId}`),
    "lesson read",
  );
  return read.json.lesson.state.status as string;
}

async function shots(page: Page, name: string): Promise<void> {
  await page.setViewportSize(NARROW);
  await expectNoPageSideScroll(page);
  await page.setViewportSize(WIDE);
  await evidenceShot(page, `admin-${name}`);
}

test("024 EARS-29/30/31 — a rules editor changes a published course's rules; staff without the role are refused", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize(WIDE);
  await signInAsAdmin(page, await bootstrapRulesEditorAccount(ADMIN_ORIGIN));
  await page.goto("/learning");
  const course = await authorCourse(page);
  const doctors: Page[] = [];
  for (let n = 1; n <= DOCTORS; n++)
    doctors.push(await doctorPassesAtHalf(browser, course, n));

  // The course screen links its rules; the editor shows the pass mark set here.
  await page.goto(`/learning/courses/${course.courseId}`);
  await expect(page.getByTestId(`module-${MODULES}`)).toBeVisible();
  await page.getByRole("link", { name: "Правила курса" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/learning/rules/course/${course.courseId}$`, "u"),
  );
  const editor = page.getByTestId("rules-editor");
  await expect(editor.getByRole("heading", { level: 1 })).toHaveText(
    "Правила курса",
  );
  await expect(page.getByTestId("rules-read-only")).toHaveCount(0);
  const threshold = page.getByTestId("setting-test.threshold");
  await expect(threshold).toContainText("50 %");
  await expect(threshold).toContainText("Задано здесь");

  // Reject: a pass mark over 100 is refused in words and changes nothing.
  await threshold
    .getByRole("button", { name: "Изменить: Порог теста" })
    .click();
  await threshold.getByRole("spinbutton", { name: "Порог теста" }).fill("900");
  await page.getByRole("button", { name: "Сохранить правила" }).click();
  const dialog = page.getByTestId("rule-change-dialog");
  const refusal = page.getByTestId("write-refusal");
  // The preview validates first: invalid values never reach the change dialog.
  await expect(refusal).toContainText("Правила не сохранены:");
  await expect(dialog).toHaveCount(0);
  await expect(refusal.getByRole("listitem").first()).toContainText(
    "Порог теста",
  );
  await shots(page, "rules-refused");
  await page.reload();
  await expect(threshold).toContainText("50 %");

  // Accept: 50 % → 80 %. The dialog names the doctors whose status changes.
  await threshold
    .getByRole("button", { name: "Изменить: Порог теста" })
    .click();
  await threshold.getByRole("spinbutton", { name: "Порог теста" }).fill("80");
  await page.getByRole("button", { name: "Сохранить правила" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Изменится статус у ${DOCTORS} врачей.`);
  await expect(dialog).toContainText(
    `Станут пройденными: 0 · перестанут быть пройденными: ${DOCTORS}.`,
  );
  await expect(
    dialog.getByLabel("Сохранить заработанные зачёты"),
  ).toBeChecked();
  await shots(page, "rules-change-dialog");
  await dialog.getByRole("button", { name: "Применить изменение" }).click();
  await expect(editor.getByText("Правила сохранены.")).toBeVisible();
  await expect(threshold).toContainText("80 %");
  // D16 keep: every doctor who passed at 50 % keeps the lesson done.
  for (const doctor of doctors)
    await expect
      .poll(() => lessonStatus(doctor, course.lessonIds[0]!))
      .toBe("done");

  // «ДПО / аккредитация» on the published course: a preview, then keep.
  const panel = page.getByTestId("preset-panel");
  const dpo = panel.getByLabel("ДПО / аккредитация");
  await dpo.locator("xpath=ancestor::label[1]").click();
  await panel.getByRole("button", { name: "Применить пресет" }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel("Сохранить заработанные зачёты"),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Применить изменение" }).click();
  await expect(panel.getByText("Применён: ДПО / аккредитация")).toBeVisible();
  await shots(page, "rules-course-preset");

  // A module overridden to «в любом порядке».
  await page.goto(`/learning/rules/module/${course.moduleIds[1]}`);
  await expect(editor.getByRole("heading", { level: 1 })).toHaveText(
    "Правила модуля",
  );
  const order = page.getByTestId("setting-order");
  await expect(order).toContainText("Унаследовано от:");
  await order.getByRole("button", { name: "Изменить: Порядок шагов" }).click();
  await order
    .getByRole("combobox", { name: "Порядок шагов" })
    .selectOption({ label: "в любом порядке" });
  await page.getByRole("button", { name: "Сохранить правила" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Применить изменение" }).click();
  await expect(editor.getByText("Правила сохранены.")).toBeVisible();
  await expect(order).toContainText("в любом порядке");
  await expect(order).toContainText("Задано здесь");

  // A lesson of that module inherits it.
  const lessonOfModule = course.lessonIds[LESSONS_PER_MODULE]!;
  await page.goto(`/learning/rules/lesson/${lessonOfModule}`);
  await expect(editor.getByRole("heading", { level: 1 })).toHaveText(
    "Правила урока",
  );
  await expect(page.getByTestId("setting-order")).toContainText(
    "в любом порядке",
  );
  await expect(page.getByTestId("setting-order")).toContainText(
    "Унаследовано от: модуль",
  );
  await shots(page, "rules-lesson-inherited");

  // EARS-30: a staff member without the role — read-only, and the API refuses.
  const other = await browser.newContext({ baseURL: ADMIN_ORIGIN });
  const staff = await other.newPage();
  await staff.setViewportSize(WIDE);
  await signInAsAdmin(staff, await bootstrapAdminSession(ADMIN_ORIGIN));
  await staff.goto(`/learning/rules/course/${course.courseId}`);
  await expect(staff.getByTestId("rules-read-only")).toContainText(
    "Правила опубликованного курса меняет только редактор правил обучения.",
  );
  await expect(
    staff.getByRole("button", { name: "Сохранить правила" }),
  ).toHaveCount(0);
  await expect(
    staff.getByRole("button", { name: "Изменить: Порог теста" }),
  ).toHaveCount(0);
  await shots(staff, "rules-read-only");
  const current = await ok(
    api(staff, "GET", `/v1/admin/learning/rules/course/${course.courseId}`),
    "staff read",
  );
  const refused = await api(
    staff,
    "PUT",
    `/v1/admin/learning/rules/course/${course.courseId}`,
    { values: { ...current.json.values, "test.threshold": 60 } },
    current.etag,
  );
  expect(refused.status).toBe(403);
  await staff.goto("/learning/rules/platform/platform");
  await expect(staff.getByTestId("rules-read-only")).toContainText(
    "Правила платформы и пресеты меняет только редактор правил обучения.",
  );
  // The course screen's preset choice is read-only for them too, same reason.
  await staff.goto(`/learning/courses/${course.courseId}`);
  const presetPanel = staff.getByTestId("preset-panel");
  await expect(presetPanel.getByTestId("rules-read-only")).toContainText(
    "Правила опубликованного курса меняет только редактор правил обучения.",
  );
  await expect(
    presetPanel.getByRole("button", { name: "Применить пресет" }),
  ).toBeDisabled();
  await shots(staff, "course-preset-read-only");
  await other.close();
  for (const doctor of doctors) await doctor.context().close();
});
