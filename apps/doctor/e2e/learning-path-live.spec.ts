import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { expect, test, type Page } from "@playwright/test";
import {
  provisionConfirmedAccount,
  signInPageThroughHost,
} from "@ds/e2e/host-sign-in";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 024 EARS-14…18, EARS-26, EARS-27 (#4011) — the doctor's course path and step
 * screens driven end to end on a live stand: a guest sees the path and the
 * registration gate; a signed-in doctor opens the «Вы здесь» video step, the
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
]);

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");
const PORTAL_URL = (process.env.E2E_PORTAL_URL ?? "").replace(/\/$/, "");
const SLUG = process.env.E2E_LEARNING_COURSE_SLUG ?? "";
const SHOT_DIR = process.env.E2E_SHOT_DIR;

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

async function shoot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true });
}

async function axeClean(page: Page) {
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

/** A YouTube embed stand-in on the provider origin: ready, then the clock at 2× real time. */
const YOUTUBE_FIXTURE = `<!doctype html><html><body style="margin:0;background:#000"><script>
  const post = (m) => parent.postMessage(JSON.stringify(m), "*");
  post({ event: "onReady" });
  const t0 = Date.now();
  setInterval(() => {
    const currentTime = Math.min(60, ((Date.now() - t0) / 1000) * 2);
    post({ event: "infoDelivery", info: { playerState: 1, currentTime } });
  }, 500);
</script></body></html>`;

const newEmail = () => `e2e-4011-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
const livePassword = () => `Doc-${Date.now()}-aA1!`;

test.describe("024 — the doctor's course path and step screens", () => {
  test.describe.configure({ mode: "serial" });

  test("EARS-14 / EARS-15: a guest sees the path with its states and meets the registration gate on a step", async ({ page }) => {
    for (const [size, tag] of [[DESKTOP, "1280"], [PHONE, "390"]] as const) {
      await page.setViewportSize(size);
      const res = await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: /Урок 1, шаг 1\. Серия/ })).toBeVisible();
      await expect(page.getByText("Автор курса")).toBeVisible();
      await axeClean(page);
      await shoot(page, `guest-path-${tag}`);
    }
    await page.setViewportSize(DESKTOP);
    await page.getByRole("button", { name: /Урок 1, шаг 1\. Серия/ }).click();
    const open = page.getByTestId("node-summary").getByRole("link", { name: "Открыть" });
    await expect(open).toHaveAttribute("href", /\/register\?returnTo=/);
    await page.getByRole("link", { name: /Урок 1\. / }).first().click();
    await expect(page.getByRole("link", { name: "Зарегистрироваться" })).toHaveAttribute("href", /\/register\?returnTo=%2Fcourses%2F/);
    await axeClean(page);
    await shoot(page, "guest-gate-1280");
  });

  test("EARS-27: the Academy has no course path — /courses/* is its not-found page", async ({ page }) => {
    const res = await page.goto(`${PORTAL_URL}/courses/${SLUG}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("button", { name: /Урок 1, шаг 1/ })).toHaveCount(0);
    await shoot(page, "academy-courses-not-found");
  });

  test("EARS-14…18: a doctor watches, downloads, fails the exit test below the threshold, passes it, and the next lesson opens", async ({ browser }) => {
    test.setTimeout(240_000);
    const doctor = { email: newEmail(), password: livePassword() };
    await provisionConfirmedAccount(browser, "doctor", DOCTOR_URL, doctor);
    const context = await browser.newContext({ locale: "ru-RU", viewport: DESKTOP });
    await context.route("https://www.youtube.com/embed/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: YOUTUBE_FIXTURE }),
    );
    const page = await context.newPage();
    await signInPageThroughHost(page, DOCTOR_URL, doctor);

    // The path: lesson 1's video is «Вы здесь», lesson 2 is locked with its reason.
    await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    await expect(page.getByRole("button", { name: /Урок 1, шаг 1\. Серия\. .*Вы здесь/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Урок 2, шаг 1\. .*Закрыт/ })).toBeVisible();
    await page.getByRole("button", { name: /Урок 2, шаг 1\./ }).click();
    await expect(page.getByTestId("node-summary").getByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeVisible();
    await axeClean(page);
    await shoot(page, "doctor-path-start-1280");
    await page.setViewportSize(PHONE);
    await page.getByRole("button", { name: /Урок 1, шаг 2\./ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await axeClean(page);
    await shoot(page, "doctor-path-sheet-390");
    await page.keyboard.press("Escape");
    await page.setViewportSize(DESKTOP);

    // Video: the provider clock → position facts → 100 %.
    await page.getByRole("link", { name: /Продолжить — урок 1/ }).click();
    await expect(page.getByRole("button", { name: "Смотреть видео" })).toBeVisible();
    await axeClean(page);
    await shoot(page, "step-video-1280");
    const facts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/v1/me/learning/facts")) facts.push(r.postData() ?? "");
    });
    await page.getByRole("button", { name: "Смотреть видео" }).click();
    await expect(page.getByText("Просмотрено 100 %", { exact: true })).toBeVisible({ timeout: 90_000 });
    expect(facts.length).toBeGreaterThanOrEqual(2);
    await shoot(page, "step-video-watched-1280");

    // Download: `opened`.
    await page.reload();
    await page.getByRole("link", { name: "Дальше" }).click();
    const download = page.getByRole("link", { name: "Скачать" });
    await expect(download).toBeVisible();
    const popup = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
    await download.click();
    await (await popup)?.close();
    await expect(page.getByText("Материал открыт", { exact: true })).toBeVisible();
    await axeClean(page);
    await shoot(page, "step-download-opened-1280");

    // Exit test: reject below the threshold, then accept.
    await page.reload();
    await page.getByRole("link", { name: "Дальше" }).click();
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
    await axeClean(page);
    await shoot(page, "doctor-path-next-lesson-1280");
    await page.setViewportSize(PHONE);
    await axeClean(page);
    await shoot(page, "doctor-path-next-lesson-390");
    await page.getByRole("link", { name: /Продолжить — урок 2/ }).click();
    await expect(page.getByRole("button", { name: "Смотреть видео" })).toBeVisible();
    await axeClean(page);
    await shoot(page, "step-video-390");
    await context.close();
  });
});
