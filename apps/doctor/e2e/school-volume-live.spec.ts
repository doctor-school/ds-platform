import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { expect, test, type Page } from "@playwright/test";
import { provisionConfirmedAccount, signInPageThroughHost } from "@ds/e2e/host-sign-in";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 023 EARS-5 (#4017) — the school screen at the canvas's volume switch
 * (`design-source/doctor-school.dc.html` `courseCount` 3 / 22 / 62): up to six
 * courses are all cards; more are rows in school order, ten at a time behind
 * «Показать ещё 10», «Найти курс» filters by title over the whole list, a
 * no-match message names the query. A guest has no «Вы учитесь»; a signed-in
 * doctor with a started and a done course (each made through the real fact
 * endpoint) sees both as cards under «Вы учитесь» — «Продолжить — урок N →»,
 * «Открыть путь курса →» — and the rest as rows. Axe clean and no side scroll
 * at 1280 and 390.
 *
 * Seed: published schools of N courses whose 2nd course has a download step
 * first and whose 6th course is one download under a rule layer with no exit
 * test and no club (the PR drive seeds 3, 22 and 62 on the branch DB). Run:
 *   E2E_DOCTOR_URL=http://localhost:3004 \
 *   E2E_LEARNING_VOLUME_SCHOOL_SLUGS=volume-school-3,volume-school-22,volume-school-62 \
 *   MAILPIT_URL=… IDP_ISSUER=… E2E_SHOT_DIR=.github/ui-evidence/4017 \
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.learning-live.config.ts school-volume
 */

requireLiveStandEnv(["E2E_DOCTOR_URL", "E2E_LEARNING_VOLUME_SCHOOL_SLUGS", "MAILPIT_URL", "IDP_ISSUER"]);

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");
const SLUGS = (process.env.E2E_LEARNING_VOLUME_SCHOOL_SLUGS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
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
const ROWS = '[data-feed-card="content-row"]';
const CARDS = '[data-feed-card="content"]';

async function shoot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}${DARK ? "-dark" : ""}.png`), fullPage: true });
}

async function axeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: MAIN_LANDMARK_RULES })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude('[data-testid="shell-topbar"]')
    .exclude('[data-testid="footer-giant"]')
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** The read's course count, from the school read the page itself serves. */
async function courseSlugs(page: Page, slug: string): Promise<string[]> {
  return page.evaluate(async (s) => {
    const res = await fetch(`/v1/learning/schools/${s}`, { credentials: "include", cache: "no-store" });
    const body = (await res.json()) as { courses: { slug: string }[] };
    return body.courses.map((c) => c.slug);
  }, slug);
}

test.describe("023 — the school screen at volume", () => {
  test.beforeEach(async ({ context }) => {
    if (DARK) await context.addInitScript(DARK_INIT);
  });

  for (const slug of SLUGS) {
    test(`EARS-5: a guest reads ${slug} — cards up to six, else rows, search and «Показать ещё 10»`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(DESKTOP);
      await page.goto(`${DOCTOR_URL}/schools/${slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const all = await courseSlugs(page, slug);
      const n = all.length;
      const search = page.getByRole("searchbox", { name: "Найти курс" });
      await expect(page.getByText("Вы учитесь", { exact: true })).toHaveCount(0);

      if (n <= 6) {
        await expect(page.locator(CARDS)).toHaveCount(n);
        await expect(page.locator(ROWS)).toHaveCount(0);
        await expect(search).toHaveCount(0);
      } else {
        await expect(page.locator(CARDS)).toHaveCount(0);
        await expect(page.getByText(`Все курсы школы · ${n}`, { exact: true })).toBeVisible();
        await expect(page.locator(ROWS)).toHaveCount(10);
        expect(await page.locator(ROWS).evaluateAll((els) => els.map((a) => a.getAttribute("href")))).toEqual(
          all.slice(0, 10).map((s) => `/courses/${s}`),
        );
        await expect(page.getByRole("button", { name: `Показать ещё 10 · осталось ${n - 10}` })).toBeVisible();
      }
      await axeClean(page);
      await noSideScroll(page);
      await shoot(page, `school-volume-${n}-guest-1280`);
      await page.setViewportSize(PHONE);
      await noSideScroll(page);
      await axeClean(page);
      await shoot(page, `school-volume-${n}-guest-390`);
      await page.setViewportSize(DESKTOP);
      if (n <= 6) return;

      // «Показать ещё 10» until none is left.
      for (let shown = 10; shown < n; shown += 10) {
        const left = n - shown;
        await page.getByRole("button", { name: `Показать ещё ${Math.min(10, left)} · осталось ${left}` }).click();
        await expect(page.locator(ROWS)).toHaveCount(Math.min(n, shown + 10));
      }
      await expect(page.getByRole("button", { name: /^Показать ещё/ })).toHaveCount(0);

      // «Найти курс» over the whole list, then a query with no match.
      await search.fill("ахиллова");
      const found = await page.locator(ROWS).allTextContents();
      expect(found.length).toBeGreaterThan(0);
      for (const t of found) expect(t.toLowerCase()).toContain("ахиллова");
      await expect(page.getByText(`Все курсы школы · ${found.length}`, { exact: true })).toBeVisible();
      await shoot(page, `school-volume-${n}-search-1280`);
      await search.fill("гастро");
      await expect(page.locator(ROWS)).toHaveCount(0);
      await expect(
        page.getByText("По запросу «гастро» курсов в этой школе нет. Попробуйте другое слово.", { exact: true }),
      ).toBeVisible();
      await axeClean(page);
      await shoot(page, `school-volume-${n}-no-match-1280`);
      await page.setViewportSize(PHONE);
      await axeClean(page);
      await shoot(page, `school-volume-${n}-no-match-390`);

      // A row leads to its course path — no dead end.
      await page.setViewportSize(DESKTOP);
      await search.fill("");
      await page.locator(ROWS).first().click();
      await expect(page).toHaveURL(new RegExp(`/courses/${all[0]}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }

  test("EARS-5: a doctor's started and done courses are cards under «Вы учитесь», the rest rows", async ({ browser }) => {
    test.setTimeout(240_000);
    const many = SLUGS.filter((s) => !/-[1-6]$/.test(s));
    test.skip(many.length === 0, "no school of more than six courses in E2E_LEARNING_VOLUME_SCHOOL_SLUGS");
    const doctor = {
      email: `e2e-4017-vol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`,
      password: `Doc-${Date.now()}-aA1!`,
    };
    await provisionConfirmedAccount(browser, "doctor", DOCTOR_URL, doctor);
    const context = await browser.newContext({ locale: "ru-RU", viewport: DESKTOP });
    if (DARK) await context.addInitScript(DARK_INIT);
    const page = await context.newPage();
    await signInPageThroughHost(page, DOCTOR_URL, doctor);

    for (const slug of many) {
      await page.goto(`${DOCTOR_URL}/schools/${slug}`);
      const all = await courseSlugs(page, slug);
      const n = all.length;
      // Open the first download of courses 2 and 6 through the doctor's own fact endpoint.
      for (const course of [all[1]!, all[5]!]) {
        const status = await page.evaluate(
          async ({ course, eventId }) => {
            const path = (await (
              await fetch(`/v1/learning/courses/${course}/path`, { credentials: "include", cache: "no-store" })
            ).json()) as { modules: { lessons: { steps: { id: string; type: string }[] }[] }[] };
            const step = path.modules[0]!.lessons[0]!.steps.find((s) => s.type === "download")!;
            const res = await fetch("/v1/me/learning/facts", {
              method: "POST",
              headers: { accept: "application/json", "content-type": "application/json" },
              body: JSON.stringify({ eventId, stepId: step.id, source: "web", kind: "opened", data: {} }),
              credentials: "include",
            });
            return res.status;
          },
          { course, eventId: `e2e-${randomUUID()}` },
        );
        expect(status).toBe(200);
      }
      await page.reload();
      await expect(page.getByRole("heading", { level: 3, name: "Вы учитесь" })).toBeVisible();
      const mine = page.locator(CARDS);
      await expect(mine).toHaveCount(2);
      await expect(mine.nth(0)).toHaveAttribute("href", `/courses/${all[1]}`);
      await expect(mine.nth(0)).toContainText("Продолжить — урок 1 →");
      await expect(mine.nth(0)).not.toContainText("%");
      await expect(mine.nth(1)).toHaveAttribute("href", `/courses/${all[5]}`);
      await expect(mine.nth(1)).toContainText("✓ Завершено");
      await expect(mine.nth(1)).toContainText("Открыть путь курса →");
      await expect(page.getByText(`Остальные курсы школы · ${n - 2}`, { exact: true })).toBeVisible();
      const rows = await page.locator(ROWS).evaluateAll((els) => els.map((a) => a.getAttribute("href")));
      expect(rows).toHaveLength(10);
      expect(rows).not.toContain(`/courses/${all[1]}`);
      expect(rows).not.toContain(`/courses/${all[5]}`);
      await expect(page.getByRole("link", { name: "Зарегистрироваться" })).toHaveCount(0);
      await axeClean(page);
      await noSideScroll(page);
      await shoot(page, `school-volume-${n}-doctor-1280`);
      await page.setViewportSize(PHONE);
      await axeClean(page);
      await noSideScroll(page);
      await shoot(page, `school-volume-${n}-doctor-390`);
      await page.setViewportSize(DESKTOP);

      // The started card's CTA leads to the course path — no dead end.
      await mine.nth(0).click();
      await expect(page).toHaveURL(new RegExp(`/courses/${all[1]}$`));
      await expect(page.getByRole("link", { name: "Продолжить — урок 1" }).first()).toBeVisible();
    }
    await context.close();
  });
});
