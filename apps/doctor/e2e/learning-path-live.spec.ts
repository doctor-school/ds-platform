import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { expect, test, type Page } from "@playwright/test";
import {
  provisionConfirmedAccount,
  signInPageThroughHost,
} from "@ds/e2e/host-sign-in";
import { signInWithPassword } from "@ds/e2e/sign-in";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 024 EARS-14…18, EARS-26, EARS-27 (#4011) — the doctor's course path and step
 * screens driven end to end on a live stand: a guest sees the path and the
 * registration gate (every step plain, no «Вы здесь»); a signed-in doctor who
 * has not started sees step 1 open and «Начать курс», opens the video step, the
 * provider clock records progress, the download records `opened`, the exit
 * test fails below the threshold (reject) and passes on a retry (accept), the
 * lesson is done and the next lesson opens; the Academy answers `/courses/*`
 * with its not-found page. Desktop 1280 px and phone 390 px, axe clean.
 *
 * The YouTube embed is answered by a fixture frame on the provider's origin
 * that speaks the IFrame Player API messages (`onReady`, `infoDelivery`
 * `currentTime`) at twice real time — the server's `progress.maxPlaybackRate`
 * — so the run is deterministic and offline-safe; the real-embed clock is a
 * separate manual drive recorded in the PR.
 *
 * Seed (admin API, `apps/api/test/learning/harness.ts` `buildCourse` + a second
 * lesson, «Путь (Duolingo)» applied, published): lesson 1 = video (youtube,
 * 60 s) → download → exit test of 2 questions («Верно» is right); lesson 2 =
 * video → test.
 * On a stage slot the course is the golden one (`golden.learning.course`,
 * #4059: the same shape, lesson 2 in a second module), handed to the leg as
 * `E2E_LEARNING_COURSE_SLUG` by `tools/staging/live-tiers.mjs`, its school
 * (`golden.learning.school`, 023 #4017) as `E2E_LEARNING_SCHOOL_SLUG`.
 *
 * Harness (production builds; api :3000, doctor :3004 bound to 127.0.0.1,
 * sign-in host :3005, portal :3001):
 *   E2E_DOCTOR_URL=http://localhost:3004 E2E_PORTAL_URL=http://localhost:3001 \
 *   MAILPIT_URL=… IDP_ISSUER=… E2E_LEARNING_COURSE_SLUG=<seeded slug> \
 *   E2E_SHOT_DIR=.github/ui-evidence/4011 \
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.learning-live.config.ts
 */

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_PORTAL_URL",
  "MAILPIT_URL",
  "IDP_ISSUER",
  "E2E_LEARNING_COURSE_SLUG",
  "E2E_LEARNING_SCHOOL_SLUG",
]);

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");
const PORTAL_URL = (process.env.E2E_PORTAL_URL ?? "").replace(/\/$/, "");
const SLUG = process.env.E2E_LEARNING_COURSE_SLUG ?? "";
/** 023 — the published school of that course; the journey enters the course from it. */
const SCHOOL_SLUG = process.env.E2E_LEARNING_SCHOOL_SLUG ?? "";
const SHOT_DIR = process.env.E2E_SHOT_DIR;
/** `E2E_THEME=dark` runs the same journey in the dark theme (the dark evidence renders). */
const DARK = process.env.E2E_THEME === "dark";
/** The doctor host's theme is class-based: the persisted choice, applied before first paint. */
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

async function shoot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}${DARK ? "-dark" : ""}.png`), fullPage: true });
}

async function axeClean(page: Page) {
  // Contrast is read on settled colours: a hydrated action leaving its disabled
  // state, or a footer action swapped in place by the re-read, runs the
  // primitives' 150 ms colour transition, and a mid-transition sample is no
  // colour the reader is left with.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: MAIN_LANDMARK_RULES })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // The provider frame is the provider's document, not ours.
    .exclude('[data-testid="recording-player-youtube"]')
    // #2189 / #2180 — the shared shell's topbar contrast and the footer's
    // aria-hidden giant wordmark, the same leaf exclusions as a11y-axe.e2e.spec.ts.
    .exclude('[data-testid="shell-topbar"]')
    .exclude('[data-testid="footer-giant"]')
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/**
 * A YouTube embed stand-in on the provider origin: ready, then — only when the
 * embed asked to start playing (`autoplay=1`, EARS-16) — the clock at 2× real
 * time. Without it the stand-in sits cued at 0, as the real player waits for a
 * second tap on its own play button.
 */
const YOUTUBE_FIXTURE = `<!doctype html><html><body style="margin:0;background:#000"><script>
  const post = (m) => parent.postMessage(JSON.stringify(m), "*");
  post({ event: "onReady" });
  const autoplay = new URLSearchParams(location.search).get("autoplay") === "1";
  const t0 = Date.now();
  setInterval(() => {
    if (!autoplay) return post({ event: "infoDelivery", info: { playerState: 5, currentTime: 0 } });
    const currentTime = Math.min(60, ((Date.now() - t0) / 1000) * 2);
    post({ event: "infoDelivery", info: { playerState: 1, currentTime } });
  }, 500);
</script></body></html>`;

const newEmail = () => `e2e-4011-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
const livePassword = () => `Doc-${Date.now()}-aA1!`;

test.describe("024 — the doctor's course path and step screens", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ context }) => {
    if (DARK) await context.addInitScript(DARK_INIT);
  });

  test("023 EARS-4/5/8/11: a guest enters from the school screen, opens a course card and reaches its path under the course header", async ({ page }) => {
    for (const [size, tag] of [[DESKTOP, "1280"], [PHONE, "390"]] as const) {
      await page.setViewportSize(size);
      const res = await page.goto(`${DOCTOR_URL}/schools/${SCHOOL_SLUG}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(/^\d+ курс(а|ов)? · \d+ урок(а|ов)?$/)).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Курсы школы" })).toBeVisible();
      // EARS-8 — a guest reads every course and meets the gate returning to the school.
      await expect(page.getByRole("link", { name: "Зарегистрироваться" })).toHaveAttribute(
        "href",
        `/register?returnTo=${encodeURIComponent(`/schools/${SCHOOL_SLUG}`)}`,
      );
      // No phone horizontal scroll (EARS-25).
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await axeClean(page);
      await shoot(page, `guest-school-${tag}`);
    }
    await page.setViewportSize(DESKTOP);
    const card = page.locator(`a[href="/courses/${SLUG}"]`);
    await expect(card).toContainText(/академическ/);
    await card.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/courses/${SLUG}`);
    // EARS-11 — the course header: the breadcrumb back to the school, the rules summary with the certificate sentence.
    await expect(
      page.getByRole("navigation", { name: "Вы здесь" }).getByRole("link"),
    ).toHaveAttribute("href", `/schools/${SCHOOL_SLUG}`);
    await expect(page.getByText(/Сертификат выдаётся за весь курс/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Урок 1, шаг 1\. Серия/ })).toBeVisible();
    await axeClean(page);
    await shoot(page, "guest-course-header-1280");
  });

  test("023 EARS-8: a guest gated on the school signs in and lands back on the school screen", async ({ browser }) => {
    const doctor = { email: newEmail(), password: livePassword() };
    await provisionConfirmedAccount(browser, "doctor", DOCTOR_URL, doctor);
    const context = await browser.newContext({ locale: "ru-RU", viewport: DESKTOP });
    if (DARK) await context.addInitScript(DARK_INIT);
    const page = await context.newPage();
    await page.goto(`${DOCTOR_URL}/schools/${SCHOOL_SLUG}`);
    const gateHref = (await page.getByRole("link", { name: "Зарегистрироваться" }).getAttribute("href"))!;
    const returnTo = new URL(gateHref, DOCTOR_URL).searchParams.get("returnTo")!;
    expect(returnTo).toBe(`/schools/${SCHOOL_SLUG}`);
    await signInWithPassword(page, { loginPath: `/login?returnTo=${encodeURIComponent(returnTo)}` }, doctor, DOCTOR_URL);
    await expect.poll(() => new URL(page.url()).pathname).toBe(returnTo);
    // Signed in: no gate, the card carries the doctor's state.
    await expect(page.getByRole("link", { name: "Зарегистрироваться" })).toHaveCount(0);
    await expect(page.locator(`a[href="/courses/${SLUG}"]`)).toBeVisible();
    await axeClean(page);
    await shoot(page, "doctor-school-1280");
    await context.close();
  });

  test("023 EARS-24: the Academy has no school screen — /schools/* is its not-found page", async ({ page }) => {
    const res = await page.goto(`${PORTAL_URL}/schools/${SCHOOL_SLUG}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("link", { name: "Зарегистрироваться" })).toHaveCount(0);
    await shoot(page, "academy-schools-not-found");
  });

  test("EARS-14/15: a guest sees the path with its states and meets the registration gate on a step", async ({ page }) => {
    for (const [size, tag] of [[DESKTOP, "1280"], [PHONE, "390"]] as const) {
      await page.setViewportSize(size);
      const res = await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: /Урок 1, шаг 1\. Серия/ })).toBeVisible();
      // Canvas guest: every lesson step `plain` — no state word, no «Вы здесь», no locked reason.
      await expect(page.getByRole("button", { name: /\. (Вы здесь|Открыт|Закрыт|Пройден)$/ })).toHaveCount(0);
      await expect(page.getByText("Вы здесь", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/^Шаг откроется/)).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^Продолжить/ })).toHaveCount(0);
      // The kicker carries the canvas metas: «Серия · видео · N минут», the
      // download's file «PDF · <size>», the test's «2 вопроса · порог P %».
      await expect(page.getByText(/Серия · видео · \d+ минут/).first()).toBeVisible();
      await expect(page.getByText(/^Материал для скачивания · PDF · \d+(,\d)? [КМ]Б$/).first()).toBeVisible();
      await expect(page.getByText(/^Тест · 2 вопроса · порог \d+ %$/).first()).toBeVisible();
      await expect(page.getByText("Автор курса")).toBeVisible();
      // EARS-14 — the points plate: a guest has no balance, every kind reads «—».
      const guestPlate = page.getByTestId("points-plate");
      await expect(guestPlate.getByRole("heading", { name: "Очки внимания" })).toBeVisible();
      await expect(guestPlate.getByTestId("points-plate-value")).toHaveCount(3);
      for (const value of await guestPlate.getByTestId("points-plate-value").allTextContents()) {
        expect(value).toMatch(/^— /);
      }
      await axeClean(page);
      await shoot(page, `guest-path-${tag}`);
    }
    await page.setViewportSize(DESKTOP);
    await page.getByRole("button", { name: /Урок 1, шаг 1\. Серия/ }).click();
    const open = page.getByTestId("node-summary").getByRole("link", { name: "Открыть" });
    await expect(open).toHaveAttribute("href", /\/register\?returnTo=/);
    // The step route itself answers a guest with the registration gate.
    const firstStep = (await page.getByRole("button", { name: /Урок 1, шаг 1\. Серия/ }).getAttribute("id"))!.replace(/^node-/, "");
    await page.goto(`${DOCTOR_URL}/courses/${SLUG}/steps/${firstStep}`);
    await expect(page.getByRole("link", { name: "Зарегистрироваться" })).toHaveAttribute("href", /\/register\?returnTo=%2Fcourses%2F/);
    await axeClean(page);
    await shoot(page, "guest-gate-1280");
  });

  test("EARS-22: a guest gated on a step or the course signs in and lands back on it, not on the feed", async ({ browser }) => {
    const doctor = { email: newEmail(), password: livePassword() };
    await provisionConfirmedAccount(browser, "doctor", DOCTOR_URL, doctor);
    const context = await browser.newContext({ locale: "ru-RU", viewport: DESKTOP });
    if (DARK) await context.addInitScript(DARK_INIT);
    const page = await context.newPage();
    await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    const firstStep = (await page.getByRole("button", { name: /Урок 1, шаг 1\. Серия/ }).getAttribute("id"))!.replace(/^node-/, "");
    const stepPath = `/courses/${SLUG}/steps/${firstStep}`;
    // The gate «… Вернём вас сюда.» names this step as the return target.
    await page.goto(`${DOCTOR_URL}${stepPath}`);
    const gateHref = (await page.getByRole("link", { name: "Зарегистрироваться" }).getAttribute("href"))!;
    const returnTo = new URL(gateHref, DOCTOR_URL).searchParams.get("returnTo");
    expect(returnTo).toBe(stepPath);
    // The doors carry it (rule S3): signing in with that target lands on the step.
    await signInWithPassword(page, { loginPath: `/login?returnTo=${encodeURIComponent(returnTo!)}` }, doctor, DOCTOR_URL);
    await expect.poll(() => new URL(page.url()).pathname).toBe(stepPath);
    await expect(page.getByRole("button", { name: "Смотреть видео" })).toBeVisible();
    await context.close();

    // The course path's own gate («Открыть») returns to the course path.
    const second = await browser.newContext({ locale: "ru-RU", viewport: DESKTOP });
    if (DARK) await second.addInitScript(DARK_INIT);
    const guest = await second.newPage();
    await guest.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    await guest.getByRole("button", { name: /Урок 1, шаг 1\. Серия/ }).click();
    const openHref = (await guest.getByTestId("node-summary").getByRole("link", { name: "Открыть" }).getAttribute("href"))!;
    const courseReturn = new URL(openHref, DOCTOR_URL).searchParams.get("returnTo")!;
    expect(courseReturn).toMatch(new RegExp(`^/courses/${SLUG}(/|$)`));
    await signInWithPassword(guest, { loginPath: `/login?returnTo=${encodeURIComponent(courseReturn)}` }, doctor, DOCTOR_URL);
    await expect.poll(() => new URL(guest.url()).pathname).toBe(courseReturn);
    await second.close();
  });

  test("EARS-27: the Academy has no course path — /courses/* is its not-found page", async ({ page }) => {
    const res = await page.goto(`${PORTAL_URL}/courses/${SLUG}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("button", { name: /Урок 1, шаг 1/ })).toHaveCount(0);
    await shoot(page, "academy-courses-not-found");
  });

  test("EARS-14/15/16/17/18: a doctor watches, downloads, fails the exit test below the threshold, passes it, and the next lesson opens", async ({ browser }) => {
    test.setTimeout(240_000);
    const doctor = { email: newEmail(), password: livePassword() };
    await provisionConfirmedAccount(browser, "doctor", DOCTOR_URL, doctor);
    const context = await browser.newContext({ locale: "ru-RU", viewport: DESKTOP });
    if (DARK) await context.addInitScript(DARK_INIT);
    await context.route("https://www.youtube.com/embed/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: YOUTUBE_FIXTURE }),
    );
    const page = await context.newPage();
    await signInPageThroughHost(page, DOCTOR_URL, doctor);

    // The path, not started: lesson 1's video is open (no «Вы здесь» yet —
    // canvas `notStarted`), lesson 2 is locked with its reason.
    await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    await expect(page.getByRole("button", { name: /Урок 1, шаг 1\. Серия\. .*Открыт$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Урок 2, шаг 1\. .*Закрыт/ })).toBeVisible();
    await expect(page.getByText("Вы здесь", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Продолжить/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Начать курс" })).toHaveAttribute("href", /\/courses\/[^/]+\/steps\//);
    // Canvas `reason`: only the first closed step — right after the doctor's
    // next step — carries «Откроется после предыдущего шага» on the path.
    await expect(page.getByText("Откроется после предыдущего шага", { exact: true })).toHaveCount(1);
    await expect(page.getByText(/^Шаг откроется/)).toHaveCount(0);
    // EARS-14 — the signed-in plate carries the doctor's own balances from 025.
    const plate = page.getByTestId("points-plate");
    await expect(plate.getByTestId("points-plate-value")).toHaveCount(3);
    for (const value of await plate.getByTestId("points-plate-value").allTextContents()) {
      expect(value).toMatch(/^\d[\d\s]* /);
    }
    await page.getByRole("button", { name: /Урок 2, шаг 1\./ }).click();
    await expect(page.getByTestId("node-summary").getByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeVisible();
    await axeClean(page);
    await shoot(page, "doctor-path-start-1280");
    await page.setViewportSize(PHONE);
    await axeClean(page);
    await shoot(page, "doctor-path-start-390");
    await page.getByRole("button", { name: /Урок 1, шаг 2\./ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await axeClean(page);
    await shoot(page, "doctor-path-sheet-390");
    await page.keyboard.press("Escape");
    await page.setViewportSize(DESKTOP);

    // Video: the provider clock → position facts → 100 %. Step 1's summary
    // offers «Начать» (canvas `actStart`); the band's «Начать курс» opens the step.
    await page.getByRole("button", { name: /Урок 1, шаг 1\./ }).click();
    const startHref = await page.getByRole("link", { name: "Начать курс" }).getAttribute("href");
    await expect(page.getByTestId("node-summary").getByRole("link", { name: "Начать" })).toHaveAttribute("href", startHref!);
    await page.getByRole("link", { name: "Начать курс" }).click();
    // Hydrated: the action is armed (it ships disabled from the server render).
    await expect(page.getByRole("button", { name: "Смотреть видео" })).toBeEnabled();
    // 024-design §8 — the step screen carries the same plate.
    await expect(page.getByTestId("points-plate").getByTestId("points-plate-value").first()).toHaveText(/^\d/);
    // The step kicker as `doctor-lesson.dc.html` draws it: «Шаг N из M · type · meta».
    await expect(page.getByText(/^Шаг 1 из 3 · Серия · видео · \d+ минут/)).toBeVisible();
    await axeClean(page);
    await shoot(page, "step-video-1280");
    const strip = page.getByRole("list", { name: "Шаги урока" });
    const facts: string[] = [];
    const pointsReads: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/v1/me/learning/facts")) facts.push(r.postData() ?? "");
      if (r.method() === "GET" && r.url().endsWith("/v1/me/points")) pointsReads.push(r.url());
    });
    // Before the completing fact the order holds the next step: no «Дальше», step 2 closed.
    await expect(page.getByRole("link", { name: "Дальше" })).toHaveCount(0);
    await expect(strip.getByRole("img", { name: /^Шаг 2\. .*Закрыт$/ })).toBeVisible();
    // Enabled only once hydrated — the click is never swallowed by a server-rendered button.
    await expect(page.getByRole("button", { name: "Смотреть видео" })).toBeEnabled();
    await page.getByRole("button", { name: "Смотреть видео" }).click();
    // EARS-16 — one tap: the frame is asked to play, and its clock starts
    // advancing (the first position fact) with no tap on the provider's button.
    await expect(page.getByTestId("recording-player-youtube")).toHaveAttribute("src", /[?&]autoplay=1(&|$)/);
    await expect.poll(() => facts.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByText("Просмотрено 100 %", { exact: true })).toBeVisible({ timeout: 90_000 });
    expect(facts.length).toBeGreaterThanOrEqual(2);
    // EARS-17 — the completing fact updates the screen in place, no reload:
    // «Дальше», the strip (step 2 reachable, one «Вы здесь») and the plate.
    await expect(page.getByRole("link", { name: "Дальше" })).toBeVisible();
    await expect(strip.getByRole("link", { name: /^Шаг 2\. .*Открыт$/ })).toBeVisible();
    await expect(strip.getByRole("link", { name: /Вы здесь$/ })).toHaveCount(1);
    // The plate re-read its balances from 025 after the completing fact.
    await expect.poll(() => pointsReads.length).toBeGreaterThan(0);
    await expect(page.getByTestId("points-plate").getByTestId("points-plate-value").first()).toHaveText(/^\d/);
    await shoot(page, "step-video-watched-1280");
    // After a reload the strip still marks exactly one step «Вы здесь».
    await page.reload();
    await expect(strip.getByRole("link", { name: /Вы здесь$/ })).toHaveCount(1);
    await expect(strip.getByRole("link", { name: /^Шаг 1\. .*Вы здесь$/ })).toHaveAttribute("aria-current", "step");

    // Download: `opened`. EARS-15 — «Дальше» is a client-side move through the
    // app's router: the document is not reloaded, so a window marker survives.
    await page.evaluate(() => {
      (window as unknown as { __stepMarker?: string }).__stepMarker = "kept";
    });
    await page.getByRole("link", { name: "Дальше" }).click();
    const download = page.getByRole("link", { name: "Скачать" });
    await expect(download).toBeVisible();
    await expect(page).toHaveURL(/\/courses\/[^/]+\/steps\//);
    expect(
      await page.evaluate(() => (window as unknown as { __stepMarker?: string }).__stepMarker),
    ).toBe("kept");
    const popup = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
    await download.click();
    await (await popup)?.close();
    await expect(page.getByText("Материал открыт", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Шаг 2 из 3 · Материал для скачивания · PDF · \d+(,\d)? [КМ]Б$/)).toBeVisible();
    await expect(page.getByText(/^PDF · \d+(,\d)? [КМ]Б$/)).toBeVisible();
    // The `opened` fact completes the step: «Дальше» to the test appears in place.
    await expect(page.getByRole("link", { name: "Дальше" })).toBeVisible();
    await expect(strip.getByRole("link", { name: /Вы здесь$/ })).toHaveCount(1);
    await axeClean(page);
    await shoot(page, "step-download-opened-1280");

    // Exit test: reject below the threshold, then accept.
    await page.getByRole("link", { name: "Дальше" }).click();
    await expect(page.getByText(/^Шаг 3 из 3 · Тест · 2 вопроса · порог \d+ %$/)).toBeVisible();
    await page.getByRole("button", { name: "Начать тест" }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByRole("radiogroup").getByText("Неверно", { exact: true }).click();
      await page.getByRole("button", { name: "Ответить" }).click();
    }
    await expect(page.getByText(/Тест не сдан: 0 % при пороге \d+ %/)).toBeVisible();
    await axeClean(page);
    await shoot(page, "step-test-failed-1280");
    await page.getByRole("button", { name: "Повторить тест" }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByRole("radiogroup").getByText("Верно", { exact: true }).click();
      await page.getByRole("button", { name: "Ответить" }).click();
    }
    await expect(page.getByText(/Тест сдан: 100 % при пороге \d+ %/)).toBeVisible();
    await expect(page.getByText("Урок пройден")).toBeVisible();
    await shoot(page, "step-test-passed-1280");

    // The path: lesson 1 done, lesson 2 is «Вы здесь».
    await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    await expect(page.getByRole("button", { name: /Урок 1, шаг 3\. .*Пройден/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Урок 2, шаг 1\. .*Вы здесь/ })).toBeVisible();
    await expect(page.getByText("Пройдено 1 урок из 2").first()).toBeVisible();
    await expect(page.getByText("Откроется после предыдущего шага", { exact: true })).toHaveCount(1);
    await axeClean(page);
    await shoot(page, "doctor-path-next-lesson-1280");
    await page.setViewportSize(PHONE);
    await axeClean(page);
    await shoot(page, "doctor-path-next-lesson-390");
    await page.getByRole("link", { name: /Продолжить — урок 2/ }).click();
    // On the phone the jump selects the node; its Sheet opens the step.
    const here2 = page.getByRole("button", { name: /Урок 2, шаг 1\. .*Вы здесь/ });
    await expect(here2).toHaveAttribute("aria-pressed", "true");
    await here2.click();
    await page.getByRole("dialog").getByRole("link", { name: "Продолжить" }).click();
    // Hydrated: the action is armed (it ships disabled from the server render).
    await expect(page.getByRole("button", { name: "Смотреть видео" })).toBeEnabled();
    await axeClean(page);
    await shoot(page, "step-video-390");
    await context.close();
  });
});
