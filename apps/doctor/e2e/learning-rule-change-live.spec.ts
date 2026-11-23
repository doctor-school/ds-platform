import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import {
  ADMIN_ORIGIN,
  bootstrapRulesEditorAccount,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import {
  provisionConfirmedAccount,
  signInPageThroughHost,
} from "@ds/e2e/host-sign-in";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 024 EARS-24 (#4012) — the doctor sees why a lesson's status changed under
 * them, on the REAL admin → NestJS → Postgres → doctor-host path:
 *
 *  - a `learning_rules_editor` authors a course of three modules × two lessons
 *    (lesson 1 = a video, then an exit test of two questions) with a 50 % pass
 *    mark and publishes it; three doctors watch lesson 1's video and pass its
 *    test at 50 % on the doctor host;
 *  - the editor raises the published course's pass mark to 80 % in the admin
 *    rules editor and chooses «Потребовать заново» (EARS-31);
 *  - each doctor's lesson 1 is open again: its test node carries the line
 *    «Условия урока изменились», the node summary and the lesson show the info
 *    Alert — what changed (70 → 80 is built from the rule change, here 50 → 80)
 *    and what to do now — the last attempt reads against the new mark, and the
 *    progress counts no done lesson; lesson 2, locked again, keeps its unlock
 *    line on the path; its summary names what changed beside the lock Alert;
 *  - one doctor fails the test at 0 % — «не сдан», also after a reload — then
 *    re-passes it at 100 %: the reason leaves the lesson in
 *    place and the path, the lesson counts again; another doctor still sees it;
 *  - the third doctor had passed lesson 2 at 50 % too, so the change reopens
 *    two lessons: lesson 2, locked behind lesson 1, carries its reason in the
 *    summary; once the doctor re-passes lesson 1, lesson 2 opens and keeps the
 *    reason — on its path line and in the summary — until it is passed again.
 *
 * Canvas state `причина = правило изменилось` of `design-source/doctor-course.dc.html`
 * and `design-source/doctor-lesson.dc.html`. Every row is written by the
 * production admin and doctor paths — no fixture SQL. Desktop 1280 px and phone
 * 390 px, axe clean; `E2E_THEME=dark` runs it in the dark theme.
 *
 * Harness: the `learning-path-live.spec.ts` stand (api, doctor host, sign-in
 * host) plus the admin host at `E2E_ADMIN_URL`; IdP service token for the role
 * grant (`IDP_SERVICE_TOKEN`).
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.learning-live.config.ts learning-rule-change
 */

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_ADMIN_URL",
  "MAILPIT_URL",
  "IDP_ISSUER",
  "IDP_SERVICE_TOKEN",
]);

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const DARK = process.env.E2E_THEME === "dark";
const DARK_INIT = () => {
  try {
    localStorage.setItem("ds-theme", "dark");
  } catch {
    /* storage blocked: the class below still applies */
  }
  document.documentElement.classList.add("dark");
};

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const RUN = Date.now().toString(36);
const SLUG = `rule-change-${RUN}`;
const MODULES = 3;
const LESSONS_PER_MODULE = 2;
const DOCTORS = 3;
const VIDEO_SEC = 10;
const TITLE = "Условия урока изменились";
const BODY =
  "Теперь для зачёта нужно набрать в тесте 80 % вместо 50 %. Пройдите тест ещё раз — остальные шаги урока засчитаны.";
/** Lesson 2, locked again behind lesson 1: what changed, then what opens it. */
// The lock Alert beside it says how the lesson opens; the reason names only what changed.
const LOCKED_BODY = "Теперь для зачёта нужно набрать в тесте 80 % вместо 50 %.";
const UNLOCK_LINE = "Откроется после предыдущего шага";

/** The YouTube stand-in of `learning-path-live.spec.ts`: ready, then the clock at 2× once asked to play. */
const YOUTUBE_FIXTURE = `<!doctype html><html><body style="margin:0;background:#000"><script>
  const post = (m) => parent.postMessage(JSON.stringify(m), "*");
  post({ event: "onReady" });
  const autoplay = new URLSearchParams(location.search).get("autoplay") === "1";
  const t0 = Date.now();
  setInterval(() => {
    if (!autoplay) return post({ event: "infoDelivery", info: { playerState: 5, currentTime: 0 } });
    const currentTime = Math.min(${VIDEO_SEC}, ((Date.now() - t0) / 1000) * 2);
    post({ event: "infoDelivery", info: { playerState: 1, currentTime } });
  }, 500);
</script></body></html>`;

async function shoot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}${DARK ? "-dark" : ""}.png`), fullPage: true });
}

async function axeClean(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: MAIN_LANDMARK_RULES })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude('[data-testid="recording-player-youtube"]')
    // #2189 / #2180 — the same shared-shell leaf exclusions as learning-path-live.spec.ts.
    .exclude('[data-testid="shell-topbar"]')
    .exclude('[data-testid="footer-giant"]')
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

interface Reply {
  status: number;
  etag: string | null;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** One admin API call from the admin origin: CSRF + `Idempotency-Key` on a write. */
async function api(page: Page, method: "GET" | "POST" | "PUT", path: string, payload?: unknown, ifMatch?: string | null): Promise<Reply> {
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
      return { status: res.status, etag: res.headers.get("etag"), json: await res.json().catch(() => null) };
    },
    { method, path, payload, ifMatch },
  );
}

async function ok(reply: Promise<Reply>, what: string): Promise<Reply> {
  const r = await reply;
  expect(r.status, `${what} → ${JSON.stringify(r.json)}`).toBeLessThan(300);
  return r;
}

const twoQuestions = {
  kind: "exit",
  questions: [1, 2].map((q) => ({
    text: `Вопрос ${q}`,
    options: [
      { text: "Верно", correct: true },
      { text: "Неверно", correct: false },
    ],
  })),
};

/** The course of MODULES × LESSONS_PER_MODULE lessons at a 50 % pass mark, published. */
async function authorCourse(page: Page): Promise<string> {
  const A = "/v1/admin";
  const direction = await ok(api(page, "POST", `${A}/directions`, { title: `Кардиология ${RUN}` }), "direction");
  const expert = await ok(
    api(page, "POST", `${A}/experts`, {
      familyName: `Сердцева${RUN}`,
      givenName: "Анна",
      professionalRole: "Кардиолог",
      credentials: "к. м. н.",
      affiliation: "Академия Doctor.School",
      bio: "Ведёт школу кардиологии.",
    }),
    "expert",
  );
  const project = await ok(
    api(page, "POST", `${A}/projects`, { title: `Школа кардиологии ${RUN}`, stage: "running", defaultAudience: "doctors" }),
    "project",
  );
  const projectId = project.json.id as string;
  const school = await ok(
    api(page, "POST", `${A}/learning/schools`, {
      directionId: direction.json.id,
      leadExpertId: expert.json.id,
      projectId,
      slug: `school-${RUN}`,
      title: `Школа кардиологии ${RUN}`,
    }),
    "school",
  );
  const course = await ok(
    api(page, "POST", `${A}/learning/courses`, { schoolId: school.json.id, projectId, slug: SLUG, title: `ЭКГ на приёме ${RUN}` }),
    "course",
  );
  const courseId = course.json.id as string;
  const lessonIds: string[] = [];
  const titles = ["Ритм и проводимость", "Ишемия", "Нарушения ритма", "Блокады", "Электролиты", "Разбор случаев"];
  for (let m = 1; m <= MODULES; m++) {
    const mod = await ok(api(page, "POST", `${A}/learning/modules`, { courseId, title: `Модуль ${m}` }), `module ${m}`);
    for (let l = 1; l <= LESSONS_PER_MODULE; l++) {
      const n = (m - 1) * LESSONS_PER_MODULE + l;
      const lesson = await ok(
        api(page, "POST", `${A}/learning/lessons`, { moduleId: mod.json.id, projectId, title: titles[n - 1] }),
        `lesson ${n}`,
      );
      lessonIds.push(lesson.json.id);
      if (n === 1) {
        const video = await ok(
          api(page, "POST", `${A}/learning/steps`, {
            lessonId: lesson.json.id,
            type: "video",
            title: "Как читать ЭКГ",
            durationMin: 1,
            payload: { durationSec: VIDEO_SEC },
          }),
          "video",
        );
        await ok(
          api(page, "PUT", `${A}/learning/steps/${video.json.id}/source`, { provider: "youtube", embedRef: "dQw4w9WgXcQ" }, video.etag),
          "video source",
        );
      }
      await ok(
        api(page, "POST", `${A}/learning/steps`, {
          lessonId: lesson.json.id,
          type: "test",
          title: "Итоговый тест",
          durationMin: 3,
          payload: twoQuestions,
        }),
        `test ${n}`,
      );
    }
  }
  const rules = await ok(api(page, "GET", `${A}/learning/rules/course/${courseId}`), "course rules");
  await ok(
    api(page, "PUT", `${A}/learning/rules/course/${courseId}`, { values: { ...rules.json.values, "test.threshold": 50 } }, rules.etag),
    "course pass mark 50",
  );
  for (const id of lessonIds) {
    const read = await ok(api(page, "GET", `${A}/learning/lessons/${id}`), "lesson");
    await ok(api(page, "POST", `${A}/learning/lessons/${id}/publish`, undefined, read.etag), "lesson publish");
  }
  const read = await ok(api(page, "GET", `${A}/learning/courses/${courseId}`), "course");
  await ok(api(page, "POST", `${A}/learning/courses/${courseId}/publish`, undefined, read.etag), "course publish");
  return courseId;
}

async function doctorContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ locale: "ru-RU", viewport: DESKTOP });
  if (DARK) await context.addInitScript(DARK_INIT);
  await context.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: YOUTUBE_FIXTURE }),
  );
  return context;
}

/** Answer the open exit test: the first `right` questions right, the rest wrong. */
async function takeTest(page: Page, right: number, start = true) {
  // «Повторить тест» starts the next attempt itself; only a fresh test needs «Начать тест».
  if (start) await page.getByRole("button", { name: "Начать тест" }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("radiogroup").getByText(i < right ? "Верно" : "Неверно", { exact: true }).click();
    await page.getByRole("button", { name: "Ответить" }).click();
  }
}

/** The reason line under the reopened node on the path (canvas `n.reason`). */
const reasonLine = (page: Page) => page.locator("span", { hasText: new RegExp(`^${TITLE}$`) });

const testNode = (page: Page) => page.getByRole("button", { name: /^Урок 1, шаг 2\. Тест\. Итоговый тест\./ });

/** A fresh doctor watches lesson 1's video and passes its test at 50 % on the doctor host. */
async function doctorPassesAtHalf(browser: Browser, n: number): Promise<Page> {
  const doctor = { email: `e2e-4012-${RUN}-${n}@ds.test`, password: `Doc-${RUN}-${n}-aA1!` };
  await provisionConfirmedAccount(browser, "doctor", DOCTOR_URL, doctor);
  const context = await doctorContext(browser);
  const page = await context.newPage();
  await signInPageThroughHost(page, DOCTOR_URL, doctor);
  await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
  await page.getByRole("link", { name: "Начать курс" }).click();
  await expect(page.getByRole("button", { name: "Смотреть видео" })).toBeEnabled();
  await page.getByRole("button", { name: "Смотреть видео" }).click();
  await expect(page.getByText("Просмотрено 100 %", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Дальше" }).click();
  await takeTest(page, 1);
  await expect(page.getByText("Тест сдан: 50 % при пороге 50 %")).toBeVisible();
  await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
  await expect(page.getByText(/^Пройдено 1 урок из 6/).first()).toBeVisible();
  await expect(page.getByText(TITLE)).toHaveCount(0);
  return page;
}

const lessonTwoNode = (page: Page) => page.getByRole("button", { name: /^Урок 2, шаг 1\. Тест\. Итоговый тест\./ });

/** From the path: open a node's step through its summary action and answer its test. */
async function takeFromPath(page: Page, node: (page: Page) => ReturnType<Page["getByRole"]>, right: number, verdict: string) {
  await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
  await node(page).click();
  await page.getByTestId("node-summary").getByRole("link", { name: /^(Начать|Продолжить|Повторить)$/ }).click();
  await expect(page).toHaveURL(/\/courses\/[^/]+\/steps\//);
  await takeTest(page, right);
  await expect(page.getByText(verdict)).toBeVisible();
}

/** The reason Alert: «Условия урока изменились» bold, then the sentence. */
async function expectReasonAlert(scope: ReturnType<Page["getByTestId"]> | Page, body = BODY) {
  const title = scope.getByText(TITLE, { exact: true }).and(scope.locator("b"));
  await expect(title).toBeVisible();
  await expect(title.locator("xpath=ancestor::*[@role='status'][1]")).toContainText(body);
}

test("024 EARS-24 — a rule change reopens a finished lesson and the doctor sees why, until they pass it again", async ({ browser }) => {
  test.setTimeout(480_000);
  const admin = await browser.newContext({ baseURL: ADMIN_ORIGIN, viewport: DESKTOP });
  const editor = await admin.newPage();
  await signInAsAdmin(editor, await bootstrapRulesEditorAccount(ADMIN_ORIGIN));
  const courseId = await authorCourse(editor);

  const doctors: Page[] = [];
  for (let n = 1; n <= DOCTORS; n++) doctors.push(await doctorPassesAtHalf(browser, n));
  // The third doctor passes lesson 2 at 50 % as well: the change will reopen two lessons.
  const third = doctors[2]!;
  await takeFromPath(third, lessonTwoNode, 1, "Тест сдан: 50 % при пороге 50 %");
  await third.goto(`${DOCTOR_URL}/courses/${SLUG}`);
  await expect(third.getByText(/^Пройдено 2 урока из 6/).first()).toBeVisible();

  // The editor raises the pass mark 50 → 80 and lets the new rules decide.
  await editor.goto(`/learning/rules/course/${courseId}`);
  const threshold = editor.getByTestId("setting-test.threshold");
  await expect(threshold).toContainText("50 %");
  await threshold.getByRole("button", { name: "Изменить: Порог теста" }).click();
  await threshold.getByRole("spinbutton", { name: "Порог теста" }).fill("80");
  await editor.getByRole("button", { name: "Сохранить правила" }).click();
  const dialog = editor.getByTestId("rule-change-dialog");
  await expect(dialog).toContainText(`перестанут быть пройденными: ${DOCTORS}.`);
  await dialog.getByLabel("Потребовать заново").locator("xpath=ancestor::label[1]").click();
  await expect(dialog.getByLabel("Потребовать заново")).toBeChecked();
  await dialog.getByRole("button", { name: "Применить изменение" }).click();
  await expect(editor.getByTestId("rules-editor").getByText("Правила сохранены.")).toBeVisible();

  // Every doctor: lesson 1 is open again with the reason; the progress leaves it out.
  for (const page of doctors) {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    await expect(testNode(page)).toHaveAccessibleName(/(Открыт|Вы здесь)$/);
    await expect(page.getByRole("button", { name: /^Урок 1, шаг 1\. Серия\. .*Пройден$/ })).toBeVisible();
    // Lesson 1's test, reopened, names the change; lesson 2's test, locked again
    // behind it, keeps what opens it on the path (its reason is in the summary).
    await expect(page.getByRole("button", { name: /^Урок 2, шаг 1\. Тест\. .*Закрыт$/ })).toBeVisible();
    await expect(reasonLine(page)).toHaveCount(1);
    await expect(page.locator("span", { hasText: new RegExp(`^${UNLOCK_LINE}$`) })).toHaveCount(1);
    await expect(page.getByText(/^Пройдено 0 уроков из 6/).first()).toBeVisible();
  }

  const [first, second] = doctors as [Page, Page, Page];
  // The relocked lesson 2: its summary says what changed and what opens it.
  await first.getByRole("button", { name: /^Урок 2, шаг 1\. Тест\. .*Закрыт$/ }).click();
  await expectReasonAlert(first.getByTestId("node-summary"), LOCKED_BODY);
  await expect(first.getByTestId("node-summary")).not.toContainText("условия курса");
  await axeClean(first);
  await shoot(first, "doctor-path-rule-relocked-1280");
  await testNode(first).click();
  const summary = first.getByTestId("node-summary");
  await expectReasonAlert(summary);
  await axeClean(first);
  await shoot(first, "doctor-path-rule-changed-1280");
  await first.setViewportSize(PHONE);
  expect(await first.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await axeClean(first);
  await shoot(first, "doctor-path-rule-changed-390");
  await testNode(first).click();
  const sheet = first.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expectReasonAlert(sheet.getByTestId("node-summary"));
  await axeClean(first);
  await shoot(first, "doctor-path-rule-changed-sheet-390");
  await sheet.getByRole("link", { name: /^(Начать|Продолжить)$/ }).click();

  // The lesson: the Alert above the step, on the phone and the desktop.
  await expect(first).toHaveURL(/\/courses\/[^/]+\/steps\//);
  await expect(first.getByRole("button", { name: "Начать тест" })).toBeEnabled();
  await expectReasonAlert(first);
  // The attempt passed under the old mark is stated against the new one, never «не сдан».
  await expect(first.getByText("Ваш результат 50 % — теперь нужно 80 %.", { exact: true })).toBeVisible();
  await expect(first.getByText(/не сдан/)).toHaveCount(0);
  expect(await first.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await axeClean(first);
  await shoot(first, "step-rule-changed-390");
  await first.setViewportSize(DESKTOP);
  await axeClean(first);
  await shoot(first, "step-rule-changed-1280");

  // Reject: an attempt that fails under the new mark (0 %, under the old one too) — the reason stays.
  await takeTest(first, 0);
  await expect(first.getByText("Тест не сдан: 0 % при пороге 80 %.", { exact: false })).toBeVisible();
  await expectReasonAlert(first);
  // After a reload that attempt is still «не сдан» — only the attempt the change re-judged reads «теперь нужно».
  await first.reload();
  await expectReasonAlert(first);
  await expect(first.getByText("Тест не сдан: 0 % при пороге 80 %. Пройденные шаги сохранены.", { exact: true })).toBeVisible();
  await expect(first.getByText(/теперь нужно/)).toHaveCount(0);
  // Accept: 100 % completes the lesson — the reason leaves in place.
  await takeTest(first, 2);
  await expect(first.getByText("Тест сдан: 100 % при пороге 80 %")).toBeVisible();
  await expect(first.getByText(TITLE)).toHaveCount(0);
  await shoot(first, "step-rule-change-cleared-1280");

  await first.goto(`${DOCTOR_URL}/courses/${SLUG}`);
  await expect(testNode(first)).toHaveAccessibleName(/Пройден$/);
  await expect(first.getByText(TITLE)).toHaveCount(0);
  await expect(first.getByText(/^Пройдено 1 урок из 6/).first()).toBeVisible();
  await axeClean(first);
  await shoot(first, "doctor-path-rule-change-cleared-1280");

  // Another doctor's reason is theirs: still shown.
  await second.reload();
  await expect(reasonLine(second)).toHaveCount(1);

  // Two reopened lessons: lesson 2, locked behind lesson 1, carries its reason
  // in the summary beside what opens it.
  await third.setViewportSize(DESKTOP);
  await third.goto(`${DOCTOR_URL}/courses/${SLUG}`);
  await expect(lessonTwoNode(third)).toHaveAccessibleName(/Закрыт$/);
  await lessonTwoNode(third).click();
  await expectReasonAlert(third.getByTestId("node-summary"), LOCKED_BODY);
  // Re-passing lesson 1 opens lesson 2, which keeps its reason until it is passed again.
  await takeFromPath(third, testNode, 2, "Тест сдан: 100 % при пороге 80 %");
  await third.goto(`${DOCTOR_URL}/courses/${SLUG}`);
  await expect(testNode(third)).toHaveAccessibleName(/Пройден$/);
  await expect(lessonTwoNode(third)).toHaveAccessibleName(/(Открыт|Вы здесь)$/);
  await expect(reasonLine(third)).toHaveCount(1);
  await lessonTwoNode(third).click();
  await expectReasonAlert(third.getByTestId("node-summary"), LOCKED_BODY);
  await axeClean(third);
  await shoot(third, "doctor-path-rule-change-second-lesson-1280");
  await takeFromPath(third, lessonTwoNode, 2, "Тест сдан: 100 % при пороге 80 %");
  await third.goto(`${DOCTOR_URL}/courses/${SLUG}`);
  await expect(third.getByText(TITLE)).toHaveCount(0);
  await expect(third.getByText(/^Пройдено 2 урока из 6/).first()).toBeVisible();

  for (const page of doctors) await page.context().close();
  await admin.close();
});
