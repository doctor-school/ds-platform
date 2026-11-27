import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  bootstrapAdminSession,
  bootstrapRulesEditorAccount,
  chooseEventClassification,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { expectNoPageSideScroll } from "./support/admin-write";
import { evidenceShot } from "./support/evidence-shot";
import { searchRelationshipCombobox } from "./support/relationship-combobox";

/**
 * 023 EARS-1 / EARS-2 / EARS-27 / EARS-28 (#4282) — a module's club and the
 * module reward on the REAL Refine → NestJS → Postgres path:
 *
 *  - in the course editor a staff member picks a 020 event as a module's club
 *    through the events picker; the module shows the event and its start, a
 *    reload keeps it, «Убрать клуб» turns the club off; an unknown event is
 *    refused by the API naming `clubEventId`;
 *  - the course's «Клуб входит в прохождение» and «Награда за модуль» are 024
 *    rule settings: set on the draft course without a dialog, then — once the
 *    course is published — a module's «Документ» over the course's value goes
 *    through the change dialog of a `learning_rules_editor`;
 *  - a staff member without that role reads the published course's reward
 *    read-only with the reason, and the API refuses their write (403).
 *
 * The event is created through the admin's own event form; the school, course,
 * modules and the lesson the course publish needs are authored through the
 * admin API (their editors are `learning-structure-editor.spec.ts`'s). No
 * fixture SQL.
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec: run with
 * `--config=playwright.flows.config.ts` against a booted admin + api.
 * `E2E_SHOT_DIR` opts into the captures the PR body cites.
 */
const NARROW = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 900 };

const RUN = Date.now().toString(36);
const EVENT_TITLE = `Клуб по ритму ${RUN}`;
const COURSE_TITLE = `Ритм сердца ${RUN}`;
const A = "/v1/admin";

interface Reply {
  status: number;
  etag: string | null;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** One admin API call from `page`: CSRF + `Idempotency-Key` on a write. */
async function api(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH",
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

/** A draft 020 event through the admin's event form; returns its id. */
async function createEvent(page: Page): Promise<string> {
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(EVENT_TITLE);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill("2026-12-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await chooseEventClassification(page);
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/u);
  return page.url().split("/").pop()!;
}

interface Course {
  courseId: string;
  moduleIds: string[];
}

/**
 * Direction, expert, project, school, then a draft course of two modules; the
 * first holds one published lesson (an exit test), so the course can publish.
 */
async function authorCourse(page: Page): Promise<Course> {
  const direction = await ok(
    api(page, "POST", `${A}/directions`, { title: `Кардиология ${RUN}` }),
    "direction",
  );
  const expert = await ok(
    api(page, "POST", `${A}/experts`, {
      familyName: `Клубова${RUN}`,
      givenName: "Анна",
      professionalRole: "Кардиолог",
      credentials: "к. м. н.",
      affiliation: "Академия Doctor.School",
      bio: "Ведёт школу кардиологии.",
    }),
    "expert",
  );
  const project = await ok(
    api(page, "POST", `${A}/projects`, {
      title: `Школа кардиологии ${RUN}`,
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
      slug: `club-school-${RUN}`,
      title: `Школа кардиологии ${RUN}`,
    }),
    "school",
  );
  const course = await ok(
    api(page, "POST", `${A}/learning/courses`, {
      schoolId: school.json.id,
      projectId,
      slug: `club-course-${RUN}`,
      title: COURSE_TITLE,
    }),
    "course",
  );
  const courseId = course.json.id as string;
  const moduleIds: string[] = [];
  for (const title of ["Синусовый ритм", "Аритмии"]) {
    const mod = await ok(
      api(page, "POST", `${A}/learning/modules`, { courseId, title }),
      `module ${title}`,
    );
    moduleIds.push(mod.json.id);
  }
  const lesson = await ok(
    api(page, "POST", `${A}/learning/lessons`, {
      moduleId: moduleIds[0],
      projectId,
      title: "Основы ритма",
    }),
    "lesson",
  );
  await ok(
    api(page, "POST", `${A}/learning/steps`, {
      lessonId: lesson.json.id,
      type: "test",
      title: "Итоговый тест",
      durationMin: 3,
      payload: {
        kind: "exit",
        questions: [
          {
            text: "Нормальная ЧСС в покое?",
            options: [
              { text: "60–90", correct: true },
              { text: "120–150", correct: false },
            ],
          },
        ],
      },
    }),
    "test step",
  );
  const read = await ok(
    api(page, "GET", `${A}/learning/lessons/${lesson.json.id}`),
    "lesson read",
  );
  await ok(
    api(
      page,
      "POST",
      `${A}/learning/lessons/${lesson.json.id}/publish`,
      undefined,
      read.etag,
    ),
    "lesson publish",
  );
  return { courseId, moduleIds };
}

async function shots(page: Page, name: string): Promise<void> {
  await page.setViewportSize(NARROW);
  await expectNoPageSideScroll(page);
  await page.setViewportSize(WIDE);
  await evidenceShot(page, `admin-${name}`);
}

test("023 EARS-1/2/27/28 — a staff member sets a module's club and the module reward; a published course's reward goes through the change dialog", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize(WIDE);
  await signInAsAdmin(page, await bootstrapRulesEditorAccount(ADMIN_ORIGIN));
  await page.goto("/learning");
  const eventId = await createEvent(page);
  const course = await authorCourse(page);
  const [firstModule, secondModule] = course.moduleIds as [string, string];

  // The module has no club yet.
  await page.goto(`/learning/courses/${course.courseId}`);
  const module1 = page.getByTestId("module-1");
  await expect(module1.getByTestId("module-club-now")).toHaveText(
    "Клуб не выбран",
  );
  const saveClub = module1.getByRole("button", { name: "Сохранить клуб" });
  await expect(saveClub).toBeDisabled();
  await expect(
    module1.getByRole("button", { name: "Убрать клуб" }),
  ).toHaveCount(0);

  // Accept: the event is picked through the events picker and saved.
  const panel = await searchRelationshipCombobox(
    page,
    `module-${firstModule}-club`,
    EVENT_TITLE,
  );
  await panel.getByText(EVENT_TITLE, { exact: true }).click();
  await saveClub.click();
  const clubNow = `${EVENT_TITLE} · 17 декабря 2026, 19:00 МСК`;
  await expect(module1.getByTestId("module-club-now")).toHaveText(clubNow);
  await expect(page.getByTestId("write-refusal")).toHaveCount(0);
  await page.reload();
  await expect(module1.getByTestId("module-club-now")).toHaveText(clubNow);
  await expect(page.locator(`#module-${firstModule}-club`)).toContainText(
    EVENT_TITLE,
  );
  await expect(
    page.getByTestId("module-2").getByTestId("module-club-now"),
  ).toHaveText("Клуб не выбран");
  const saved = await ok(
    api(page, "GET", `${A}/learning/courses/${course.courseId}`),
    "course read",
  );
  expect(saved.json.modules[0].clubEventId).toBe(eventId);
  await shots(page, "course-module-club");

  // Reject: an event that does not exist is refused naming the module's club.
  const moduleRead = saved.json.modules[1] as { id: string; version: number };
  const unknown = await api(
    page,
    "PATCH",
    `${A}/learning/modules/${secondModule}`,
    { clubEventId: crypto.randomUUID() },
    `W/"${moduleRead.version}"`,
  );
  expect(unknown.status).toBe(400);
  expect(JSON.stringify(unknown.json)).toContain("clubEventId");

  // «Убрать клуб» turns the club off, and a reload keeps it off.
  await module1.getByRole("button", { name: "Убрать клуб" }).click();
  await expect(module1.getByTestId("module-club-now")).toHaveText(
    "Клуб не выбран",
  );
  await page.reload();
  await expect(module1.getByTestId("module-club-now")).toHaveText(
    "Клуб не выбран",
  );

  // The draft course's club in completion and reward: no change dialog.
  await page.goto(`/learning/rules/course/${course.courseId}`);
  const editor = page.getByTestId("rules-editor");
  await expect(editor.getByRole("heading", { level: 1 })).toHaveText(
    "Правила курса",
  );
  const dialog = page.getByTestId("rule-change-dialog");
  const clubInCompletion = page.getByTestId("setting-course.clubInCompletion");
  await expect(clubInCompletion).toContainText("нет");
  await clubInCompletion
    .getByRole("button", { name: "Изменить: Клуб входит в прохождение" })
    .click();
  await clubInCompletion
    .getByText("Клуб входит в прохождение", { exact: true })
    .last()
    .click();
  const reward = page.getByTestId("setting-module.reward");
  await expect(reward).toContainText("Баллы");
  await expect(reward).toContainText("Унаследовано от:");
  await reward
    .getByRole("button", { name: "Изменить: Награда за модуль" })
    .click();
  await reward
    .getByRole("combobox", { name: "Награда за модуль" })
    .selectOption({ label: "Баллы и документ" });
  await page.getByRole("button", { name: "Сохранить правила" }).click();
  await expect(editor.getByText("Правила сохранены.")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(reward).toContainText("Баллы и документ");
  await expect(reward).toContainText("Задано здесь");
  await expect(clubInCompletion).toContainText("да");

  // The course is published; a module's «Документ» over the course's value
  // now goes through the change dialog.
  const draft = await ok(
    api(page, "GET", `${A}/learning/courses/${course.courseId}`),
    "course read",
  );
  await ok(
    api(
      page,
      "POST",
      `${A}/learning/courses/${course.courseId}/publish`,
      undefined,
      draft.etag,
    ),
    "course publish",
  );
  await page.goto(`/learning/rules/module/${secondModule}`);
  await expect(editor.getByRole("heading", { level: 1 })).toHaveText(
    "Правила модуля",
  );
  await expect(reward).toContainText("Баллы и документ");
  await expect(reward).toContainText("Унаследовано от: курс");
  await reward
    .getByRole("button", { name: "Изменить: Награда за модуль" })
    .click();
  await reward
    .getByRole("combobox", { name: "Награда за модуль" })
    .selectOption({ label: "Документ" });
  await page.getByRole("button", { name: "Сохранить правила" }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel("Сохранить заработанные зачёты"),
  ).toBeChecked();
  await shots(page, "rules-reward-change-dialog");
  await dialog.getByRole("button", { name: "Применить изменение" }).click();
  await expect(editor.getByText("Правила сохранены.")).toBeVisible();
  await expect(reward).toContainText("Документ");
  await expect(reward).toContainText("Задано здесь");

  // Reject (EARS-28): without `learning_rules_editor` the published course's
  // reward is read-only with the reason, and the API refuses the write.
  const other = await browser.newContext({ baseURL: ADMIN_ORIGIN });
  const staff = await other.newPage();
  await staff.setViewportSize(WIDE);
  await signInAsAdmin(staff, await bootstrapAdminSession(ADMIN_ORIGIN));
  await staff.goto(`/learning/rules/module/${secondModule}`);
  await expect(staff.getByTestId("rules-read-only")).toContainText(
    "Правила опубликованного курса меняет только редактор правил обучения.",
  );
  await expect(staff.getByTestId("setting-module.reward")).toContainText(
    "Документ",
  );
  await expect(
    staff.getByRole("button", { name: "Изменить: Награда за модуль" }),
  ).toHaveCount(0);
  await shots(staff, "rules-reward-read-only");
  const current = await ok(
    api(staff, "GET", `${A}/learning/rules/module/${secondModule}`),
    "staff read",
  );
  const refused = await api(
    staff,
    "PUT",
    `${A}/learning/rules/module/${secondModule}`,
    { values: { ...current.json.values, "module.reward": "points" } },
    current.etag,
  );
  expect(refused.status).toBe(403);
  await other.close();
});
