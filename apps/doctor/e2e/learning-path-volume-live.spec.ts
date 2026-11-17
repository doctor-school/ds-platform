import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { expect, test, type Page } from "@playwright/test";
import { provisionConfirmedAccount, signInPageThroughHost } from "@ds/e2e/host-sign-in";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 024 EARS-14 (#4011) — the course path at the canvas's volume
 * (`design-source/doctor-course.dc.html` v16 is multi-module by default): a
 * plate per module on the path, the «Модули и уроки» outline with ONE module
 * open — the one in view, followed by the scroll-spy — a module row that opens
 * its module and brings its plate into view, the Sheet on the phone, no side
 * scroll, axe clean. A guest journey: the outline needs no progress. A
 * signed-in doctor in progress (lesson 1's video watched through the real
 * position endpoint, its server clock included): «Продолжить — урок 1», one
 * «Вы здесь», and «Откроется после предыдущего шага» only under the first
 * locked step (canvas `reason`); a locked step's Sheet names its reason.
 *
 * Seed: a published course of several modules (the PR drive seeds 6 and 26
 * modules, 2–5 lessons each, through the admin API). Run against the stand of
 * `learning-path-live.spec.ts` (the signed-in journey provisions its doctor
 * through `/register` + Mailpit):
 *   E2E_DOCTOR_URL=http://localhost:3004 E2E_LEARNING_MULTI_COURSE_SLUG=<slug> \
 *   MAILPIT_URL=… IDP_ISSUER=… \
 *   E2E_SHOT_DIR=.github/ui-evidence/4011 \
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.learning-live.config.ts learning-path-volume
 */

requireLiveStandEnv(["E2E_DOCTOR_URL", "E2E_LEARNING_MULTI_COURSE_SLUG", "MAILPIT_URL", "IDP_ISSUER"]);

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");
const SLUG = process.env.E2E_LEARNING_MULTI_COURSE_SLUG ?? "";
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

async function shoot(page: Page, name: string, fullPage = false) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}${DARK ? "-dark" : ""}.png`), fullPage });
}

async function axeClean(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: MAIN_LANDMARK_RULES })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude('[data-testid="shell-topbar"]')
    .exclude('[data-testid="footer-giant"]')
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test.describe("024 — the course path at volume", () => {
  test.beforeEach(async ({ context }) => {
    if (DARK) await context.addInitScript(DARK_INIT);
  });

  test("EARS-14: the outline opens the module in view and follows the scroll through every module", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(DESKTOP);
    const res = await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    expect(res?.status()).toBe(200);
    const plates = page.getByRole("heading", { level: 3, name: /^Модуль \d+\. / });
    const count = await plates.count();
    expect(count).toBeGreaterThan(1);
    const outline = page.getByRole("navigation", { name: "Модули и уроки" });
    const row = (n: number) => outline.getByRole("button", { name: new RegExp(`^Модуль ${n}\\. `) });
    await expect(row(1)).toHaveAttribute("aria-expanded", "true");
    for (let n = 2; n <= count; n++) await expect(row(n)).toHaveAttribute("aria-expanded", "false");
    await axeClean(page);
    await shoot(page, `path-${count}-modules-top-1280`);

    // Scrolling down the path: each module's plate passing the middle of the
    // viewport opens that module in the outline and closes the one before.
    for (let n = 2; n <= count; n++) {
      await plates.nth(n - 1).evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.mouse.wheel(0, 200);
      await expect(row(n)).toHaveAttribute("aria-expanded", "true");
      await expect(row(n - 1)).toHaveAttribute("aria-expanded", "false");
      await expect(outline.locator('a[aria-current="true"]')).toHaveCount(1);
    }
    await shoot(page, `path-${count}-modules-end-1280`);

    // A module row opens its module and brings its plate into view.
    const mid = Math.ceil(count / 2);
    await row(mid).click();
    await expect(row(mid)).toHaveAttribute("aria-expanded", "true");
    await expect(plates.nth(mid - 1)).toBeInViewport();
    await axeClean(page);
    await shoot(page, `path-${count}-modules-outline-1280`);
  });

  test("EARS-14/25: on the phone the path has its plates, no outline, a node's Sheet and no side scroll", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    const plates = page.getByRole("heading", { level: 3, name: /^Модуль \d+\. / });
    const count = await plates.count();
    expect(count).toBeGreaterThan(1);
    await expect(page.getByRole("navigation", { name: "Модули и уроки" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await plates.nth(count - 1).scrollIntoViewIfNeeded();
    await shoot(page, `path-${count}-modules-390`);
    const node = page.getByRole("button", { name: /^Урок \d+, шаг 1\./ }).last();
    await node.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await axeClean(page);
    await shoot(page, `path-${count}-modules-sheet-390`);
  });

  test("EARS-14: a doctor in progress — «Продолжить», one «Вы здесь», the lock line only under the first locked step", async ({ browser }) => {
    test.setTimeout(420_000);
    const doctor = {
      email: `e2e-4011-vol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`,
      password: `Doc-${Date.now()}-aA1!`,
    };
    await provisionConfirmedAccount(browser, "doctor", DOCTOR_URL, doctor);
    const context = await browser.newContext({ locale: "ru-RU", viewport: DESKTOP });
    if (DARK) await context.addInitScript(DARK_INIT);
    const page = await context.newPage();
    await signInPageThroughHost(page, DOCTOR_URL, doctor);
    await page.goto(`${DOCTOR_URL}/courses/${SLUG}`);
    const count = await page.getByRole("heading", { level: 3, name: /^Модуль \d+\. / }).count();
    const first = page.getByRole("button", { name: /^Урок 1, шаг 1\. Серия\. .*Открыт$/ });
    const stepId = (await first.getAttribute("id"))!.replace(/^node-/, "");

    // Lesson 1's video, watched through the doctor's own position endpoint:
    // the server allows only the position its clock has seen (EARS-10), so
    // the report repeats until the step reads 100 %.
    // Sent from the page as the step screen sends it (the session cookie rides `credentials: "include"`).
    const report = async (positionSec: number) => {
      const { status, watched } = await page.evaluate(
        async (fact) => {
          const res = await fetch("/v1/me/learning/facts", {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(fact),
            credentials: "include",
            cache: "no-store",
          });
          const body = (await res.json().catch(() => null)) as { progress?: { watchedPercent: number } | null } | null;
          return { status: res.status, watched: body?.progress?.watchedPercent ?? 0 };
        },
        { eventId: `e2e-${randomUUID()}`, stepId, source: "web", kind: "position", data: { positionSec } },
      );
      expect(status).toBe(200);
      return watched;
    };
    await report(0);
    await expect.poll(() => report(86_400), { timeout: 360_000, intervals: [10_000] }).toBe(100);

    await page.reload();
    await expect(page.getByRole("button", { name: /^Урок 1, шаг 1\. .*Пройден$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Урок 1, шаг 2\. .*Вы здесь$/ })).toBeVisible();
    await expect(page.getByText("Вы здесь", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Продолжить — урок 1" }).first()).toBeVisible();
    // Canvas `reason`: one line on the path, under the first locked step only.
    const line = page.getByText("Откроется после предыдущего шага", { exact: true });
    await expect(line).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Урок 1, шаг 3\. .*Закрыт$/ })).toBeVisible();
    await expect(page.getByText(/^Шаг откроется/)).toHaveCount(0);
    await axeClean(page);
    await shoot(page, `path-${count}-modules-signed-in-continue-1280`);

    await page.setViewportSize(PHONE);
    await expect(line).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: /^Урок 1, шаг 2\. .*Вы здесь$/ }).scrollIntoViewIfNeeded();
    await axeClean(page);
    await shoot(page, `path-${count}-modules-signed-in-continue-390`);
    // A selected locked step's Sheet names its reason (canvas `sum.hasReason`) and offers no action.
    await page.getByRole("button", { name: /^Урок 2, шаг 1\. .*Закрыт$/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeVisible();
    await expect(sheet.getByRole("link")).toHaveCount(0);
    await axeClean(page);
    await shoot(page, `path-${count}-modules-signed-in-sheet-390`);
    await context.close();
  });
});
