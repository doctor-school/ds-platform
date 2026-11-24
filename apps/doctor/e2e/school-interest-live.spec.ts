import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { expect, test, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "@ds/e2e/captcha-stub";
import {
  provisionConfirmedAccount,
  registerOnHostForm,
  signInPageThroughHost,
} from "@ds/e2e/host-sign-in";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 023 EARS-6 / EARS-7 (#4019) — the «скоро» school and the doctor's interest.
 * A guest opens a published school with no published course: the badge
 * «Скоро», «Школа готовится» with the school's note, the empty events and
 * reviews sections, and «Сообщить об открытии». The capture leads to
 * the doctor registration with the school screen as the return target; the new
 * doctor lands back on the school in «Вы в списке» (the capture completed on
 * return) and withdraws it. A signed-in doctor whose interest write fails sees
 * the danger alert and keeps the capture. Axe clean, no side scroll, 1280 / 390.
 *
 * Seed: a published school with no published course — the golden «скоро»
 * school (`learning-soon-volume.ts`; a slot gets the slug from
 * `tools/staging/live-tiers.mjs`). Run:
 *   E2E_DOCTOR_URL=http://localhost:3004 E2E_LEARNING_SOON_SCHOOL_SLUG=golden-school-heart-failure \
 *   MAILPIT_URL=… IDP_ISSUER=… E2E_SHOT_DIR=.github/ui-evidence/4019 \
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.learning-live.config.ts school-interest
 */

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_LEARNING_SOON_SCHOOL_SLUG",
  "MAILPIT_URL",
  "IDP_ISSUER",
]);

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");
const SLUG = process.env.E2E_LEARNING_SOON_SCHOOL_SLUG ?? "";
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
const CAPTURE = '[data-testid="school-interest-capture"]';
const LISTED = '[data-testid="school-interest-listed"]';

async function shoot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: join(SHOT_DIR, `${name}${DARK ? "-dark" : ""}.png`),
    fullPage: true,
  });
}

async function axeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: MAIN_LANDMARK_RULES })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude('[data-testid="shell-topbar"]')
    .exclude('[data-testid="footer-giant"]')
    .analyze();
  expect(
    violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

async function noSideScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

/** Both widths: axe, no side scroll, a capture each. */
async function checkWidths(page: Page, name: string) {
  await page.setViewportSize(DESKTOP);
  await axeClean(page);
  await noSideScroll(page);
  await shoot(page, `${name}-1280`);
  await page.setViewportSize(PHONE);
  await axeClean(page);
  await noSideScroll(page);
  await shoot(page, `${name}-390`);
  await page.setViewportSize(DESKTOP);
}

/** The school read the page itself serves, with the caller's session. */
async function schoolRead(
  page: Page,
): Promise<{
  id: string;
  status: string;
  soonNote: string | null;
  interested: boolean | null;
}> {
  return page.evaluate(async (s) => {
    const res = await fetch(`/v1/learning/schools/${s}`, {
      credentials: "include",
      cache: "no-store",
    });
    const body = (await res.json()) as {
      school: { id: string; status: string; soonNote: string | null };
      interested: boolean | null;
    };
    return { ...body.school, interested: body.interested };
  }, SLUG);
}

function freshDoctor(tag: string) {
  return {
    email: `e2e-4019-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`,
    password: `Doc-${Date.now()}-aA1!`,
  };
}

test.describe("023 EARS-6/7 — the «скоро» school and the doctor's interest", () => {
  test.beforeEach(async ({ context }) => {
    if (DARK) await context.addInitScript(DARK_INIT);
  });

  test("EARS-6, EARS-7: a guest joins a «скоро» school's list through registration and withdraws", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    // The guest registers in this test's own page, so the captcha adapter goes on
    // its context: the stub on a slot, nothing on a local stand booted with bot
    // protection off (`@ds/e2e/captcha-stub`). The fresh contexts of
    // `provisionConfirmedAccount` prepare their own.
    await prepareCaptchaForJourney(
      context,
      DOCTOR_URL,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await page.setViewportSize(DESKTOP);
    await page.goto(`${DOCTOR_URL}/schools/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const school = await schoolRead(page);
    expect(school.status).toBe("soon");
    expect(school.interested).toBeNull();

    // EARS-6 — the soon state.
    await expect(page.getByText("Скоро", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Школа готовится", { exact: true }),
    ).toBeVisible();
    if (school.soonNote)
      await expect(
        page.getByText(school.soonNote, { exact: true }),
      ).toBeVisible();
    await expect(
      page.getByText("Событий школы пока нет", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Отзывов пока нет", { exact: false }),
    ).toBeVisible();
    const capture = page.locator(CAPTURE);
    await expect(capture).toBeVisible();
    await checkWidths(page, "school-soon-guest");

    // EARS-7 — the guest capture leads to registration with the school as the return target.
    const doctor = freshDoctor("guest");
    await capture.getByRole("link", { name: "Сообщить об открытии" }).click();
    await registerOnHostForm(page, "doctor", DOCTOR_URL, doctor);
    await page.waitForURL((url) => url.pathname === `/schools/${SLUG}`);
    const listed = page.locator(LISTED);
    await expect(listed).toBeVisible();
    await expect(
      listed.getByText("Вы в списке", { exact: true }),
    ).toBeVisible();
    // The marker is dropped from the address, so a reload never registers again.
    await expect.poll(() => new URL(page.url()).search).toBe("");
    expect((await schoolRead(page)).interested).toBe(true);
    await page.reload();
    await expect(page.locator(LISTED)).toBeVisible();
    await checkWidths(page, "school-soon-listed");

    // Withdraw: the capture shows again, and the read agrees.
    await page
      .locator(LISTED)
      .getByRole("button", { name: "Не сообщать" })
      .click();
    await expect(page.locator(CAPTURE)).toBeVisible();
    await expect(page.locator(LISTED)).toHaveCount(0);
    expect((await schoolRead(page)).interested).toBe(false);
  });

  test("EARS-7: a signed-in doctor whose interest write fails sees the alert and keeps the capture", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const doctor = freshDoctor("fail");
    await provisionConfirmedAccount(browser, "doctor", DOCTOR_URL, doctor);
    const context = await browser.newContext({
      locale: "ru-RU",
      viewport: DESKTOP,
    });
    if (DARK) await context.addInitScript(DARK_INIT);
    const page = await context.newPage();
    await signInPageThroughHost(page, DOCTOR_URL, doctor);
    await page.goto(`${DOCTOR_URL}/schools/${SLUG}`);
    const capture = page.locator(CAPTURE);
    await expect(capture).toBeVisible();
    expect((await schoolRead(page)).interested).toBe(false);

    // Reject: the write answers 503 — the danger alert, the capture stays, nothing stored.
    await page.route(`**/v1/me/learning/schools/*/interest`, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: "{}",
          })
        : route.continue(),
    );
    await capture.getByRole("button", { name: "Сообщить об открытии" }).click();
    const failed = page
      .getByRole("alert")
      .filter({
        hasText: "Не удалось записать вас в список. Попробуйте ещё раз.",
      });
    await expect(failed).toBeVisible();
    await expect(page.locator(CAPTURE)).toBeVisible();
    await expect(page.locator(LISTED)).toHaveCount(0);
    await checkWidths(page, "school-soon-write-failed");
    await page.unroute(`**/v1/me/learning/schools/*/interest`);
    expect((await schoolRead(page)).interested).toBe(false);

    // Accept: the retry stores it, a repeat answers the same interest.
    await page
      .locator(CAPTURE)
      .getByRole("button", { name: "Сообщить об открытии" })
      .click();
    await expect(page.locator(LISTED)).toBeVisible();
    await expect(failed).toHaveCount(0);
    const repeat = await page.evaluate(
      async (id) => {
        const res = await fetch(`/v1/me/learning/schools/${id}/interest`, {
          method: "PUT",
          headers: { accept: "application/json" },
          credentials: "include",
        });
        return {
          status: res.status,
          body: (await res.json()) as { state: string },
        };
      },
      (await schoolRead(page)).id,
    );
    expect(repeat.status).toBe(200);
    expect(repeat.body.state).toBe("active");
    await context.close();
  });
});
