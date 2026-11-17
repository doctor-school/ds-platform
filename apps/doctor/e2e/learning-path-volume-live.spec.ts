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
 * scroll, axe clean, no label overlapping another at 390 and 1280 (a row grows
 * with a label taller than the 96 px pitch). A guest journey: the outline needs no progress. A
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

/**
 * Every title the snake clamps to two lines ends with «…», on either side of
 * the axis. Chrome right-aligns a clamped line without its «…» and draws the
 * «…» after the line's end, past a right-aligned box's edge; a clamped title
 * on the left of the axis is therefore left-aligned and draws it inside its
 * box. Returns how many titles are clamped on each side.
 */
async function clampedTitlesKeepTheirEllipsis(page: Page): Promise<{ left: number; right: number }> {
  const titles = await page.locator("span.line-clamp-2[title]").evaluateAll((els) => {
    // Chrome draws a clamped line's «…» after the line's end: inside the box
    // only when the clamped line is start-aligned, never when right-aligned.
    return els
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map((el) => ({
        title: el.getAttribute("title"),
        left: getComputedStyle(el.parentElement!).textAlign === "right",
        fits: !["right", "end"].includes(getComputedStyle(el).textAlign),
      }));
  });
  expect(titles.filter((t) => !t.fits).map((t) => t.title)).toEqual([]);
  return { left: titles.filter((t) => t.left).length, right: titles.filter((t) => !t.left).length };
}

/**
 * No two labels of the snake overlap: every row's node, its lesson chip and
 * each part of its label (kicker, title, «Вы здесь», the lock note) is boxed,
 * and no box of one row intersects a box of another row. A row is at least
 * one pitch (96 px) and grows with a taller label. Returns how many rows grew.
 */
async function labelsNeverOverlap(page: Page): Promise<number> {
  const { overlaps, short, grown, rows } = await page.evaluate(() => {
    const rowEls = [...document.querySelectorAll<HTMLElement>("[data-snake-row]")];
    const boxes = rowEls.flatMap((row, r) => {
      const label = row.lastElementChild as HTMLElement;
      const parts = [...row.querySelectorAll<HTMLElement>(":scope > div > span, :scope > button"), ...label.children];
      return parts
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.width > 0 && b.height > 0)
        .map((b) => ({ r, x0: b.left, x1: b.right, y0: b.top + window.scrollY, y1: b.bottom + window.scrollY }));
    });
    boxes.sort((a, b) => a.y0 - b.y0);
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i]!;
      for (let j = i + 1; j < boxes.length && boxes[j]!.y0 < a.y1 - 0.5; j++) {
        const b = boxes[j]!;
        if (b.r !== a.r && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5) {
          overlaps.push(rowEls[a.r]!.querySelector("button")!.getAttribute("aria-label") ?? String(a.r));
        }
      }
    }
    const heights = rowEls.map((row) => row.getBoundingClientRect().height);
    return {
      overlaps: [...new Set(overlaps)],
      short: heights.filter((h) => h < 95.5).length,
      grown: heights.filter((h) => h > 96.5).length,
      rows: rowEls.length,
    };
  });
  expect(rows).toBeGreaterThan(0);
  expect(overlaps).toEqual([]);
  expect(short).toBe(0);
  return grown;
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
    // A plate's meta counts its lessons and names its club as the canvas does.
    await expect(page.getByText(/^\d+ урок\S* (и клуб )?· /).first()).toBeVisible();
    // On load the outline column shows its top: the summary of the first step,
    // which names where it sits, and the start of the outline.
    const aside = page.getByRole("complementary", { name: "Навигация по пути курса" });
    const summary = aside.getByTestId("node-summary");
    await expect(summary.getByText(/^Урок 1 · модуль 1 · шаг 1 из \d+$/)).toBeVisible();
    await page.waitForTimeout(600);
    expect(await aside.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(summary).toBeInViewport();
    const clamped = await clampedTitlesKeepTheirEllipsis(page);
    console.log(`clamped titles at 1280: left ${clamped.left}, right ${clamped.right}`);
    console.log(`guest rows grown at 1280: ${await labelsNeverOverlap(page)}`);
    await axeClean(page);
    await shoot(page, `path-${count}-modules-top-1280`);

    // Scrolling down the path: each module's plate reaching the top of the
    // viewport — its first step still below the spy line, the plate being
    // taller than it — opens that module in the outline, closes the one
    // before and marks the module's first lesson.
    for (let n = 2; n <= count; n++) {
      await plates.nth(n - 1).evaluate((el) => {
        el.scrollIntoView({ block: "start" });
        window.scrollBy(0, -12);
      });
      await expect(row(n)).toHaveAttribute("aria-expanded", "true");
      await expect(row(n - 1)).toHaveAttribute("aria-expanded", "false");
      await expect(outline.locator('a[aria-current="true"]')).toHaveCount(1);
      await expect(
        outline.locator('[data-outline-module="open"] a[aria-label^="Урок "]').first(),
      ).toHaveAttribute("aria-current", "true");
    }
    // The column has followed the scroll to the last module.
    const open = aside.locator('[data-outline-module="open"]');
    const openInColumn = async () => {
      const [c, b] = await Promise.all([aside.boundingBox(), open.boundingBox()]);
      return !!c && !!b && b.y >= c.y - 1 && b.y + b.height <= c.y + c.height + 1;
    };
    await expect.poll(openInColumn).toBe(true);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    await page.waitForTimeout(600);
    await shoot(page, `path-${count}-modules-end-1280`);

    // A module row opens its module and brings its plate into view.
    const mid = Math.ceil(count / 2);
    await row(mid).click();
    await expect(row(mid)).toHaveAttribute("aria-expanded", "true");
    await expect(plates.nth(mid - 1)).toBeInViewport();
    // The column brings the open module into its own view.
    await expect.poll(openInColumn).toBe(true);
    // A lesson row picked deeper in that module stays the lesson in view once
    // the jump lands, and while the reader nudges the page — the lesson at
    // the top of the viewport is the one in view.
    const lessons = open.getByRole("link", { name: /^Урок \d+\. / });
    const pick = lessons.nth(Math.min(1, (await lessons.count()) - 1));
    const picked = (await pick.getAttribute("aria-label"))!.match(/^Урок (\d+)\./)![1];
    await pick.click();
    await page.waitForTimeout(1_600);
    const inView = outline.locator('a[aria-current="true"]');
    await expect(inView).toHaveAttribute("aria-label", new RegExp(`^Урок ${picked}\\. `));
    await page.mouse.move(200, 450);
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(400);
    await expect(inView).toHaveAttribute("aria-label", new RegExp(`^Урок ${picked}\\. `));
    await expect(summary.getByText(new RegExp(`^Урок ${picked} · модуль ${mid} · шаг 1 из \\d+$`))).toBeVisible();
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
    const clamped = await clampedTitlesKeepTheirEllipsis(page);
    console.log(`clamped titles at 390: left ${clamped.left}, right ${clamped.right}`);
    console.log(`guest rows grown at 390: ${await labelsNeverOverlap(page)}`);
    await plates.nth(count - 1).scrollIntoViewIfNeeded();
    await shoot(page, `path-${count}-modules-390`);
    const node = page.getByRole("button", { name: /^Урок \d+, шаг 1\./ }).last();
    await node.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The Sheet names where the step sits and lists the lesson's steps.
    await expect(dialog.getByText(/^Урок \d+ · модуль \d+ · шаг 1 из \d+$/)).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Шаги урока" }).getByRole("listitem").first()).toBeVisible();
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
    await expect(first).toBeVisible();
    // Not started: the lock note under the first locked step.
    console.log(`not-started rows grown at 1280: ${await labelsNeverOverlap(page)}`);
    await page.setViewportSize(PHONE);
    console.log(`not-started rows grown at 390: ${await labelsNeverOverlap(page)}`);
    await page.setViewportSize(DESKTOP);
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
    console.log(`in-progress rows grown at 1280: ${await labelsNeverOverlap(page)}`);
    // «Продолжить» right after load: the module of «Вы здесь» is already the
    // open one, yet the click still brings it into the outline column — here
    // after the reader has scrolled the column away from it.
    const aside = page.getByRole("complementary", { name: "Навигация по пути курса" });
    const open = aside.locator('[data-outline-module="open"]');
    await aside.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => aside.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const openInColumn = async () => {
      const [c, b] = await Promise.all([aside.boundingBox(), open.boundingBox()]);
      return !!c && !!b && b.y >= c.y - 1 && b.y + b.height <= c.y + c.height + 1;
    };
    // A column of a few modules may be too short to scroll the open one out;
    // at the canvas's volume it always can.
    const hidden = !(await openInColumn());
    if (count >= 12) expect(hidden).toBe(true);
    console.log(`open module scrolled out of the column before «Продолжить»: ${hidden}`);
    await page.getByRole("link", { name: "Продолжить — урок 1" }).first().click();
    await expect.poll(openInColumn).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await axeClean(page);
    await shoot(page, `path-${count}-modules-signed-in-continue-1280`);

    await page.setViewportSize(PHONE);
    await expect(line).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    console.log(`in-progress rows grown at 390: ${await labelsNeverOverlap(page)}`);
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
