import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { expect, test, type Page } from "@playwright/test";
import { requireLiveStandEnv } from "../support/live-stand-env";
import {
  createCongressEvent,
  openAbstractIntake,
  openPosterIntake,
  provisionDoctor,
  registerForCongress,
  sendTalkThroughApi,
  signInInPage,
} from "../support/congress-stand";

/**
 * 046 V-18 (#2433) — axe-core WCAG 2 A/AA scan of «Мои заявки на Конгресс»
 * (`/account/congress`), its oral-talk form and — 046 V-16 (#2434) — the poster
 * flow (poster form with its birth-date field, the error summary at send, age
 * refusal) and the abstract form (statements, the total counter near and above
 * the limit, the error summary at send), in both themes.
 *
 * The showcase `playwright-axe` gate scans the DS primitives in isolation; this
 * scan covers the composed signed-in section a doctor actually reaches — the
 * list with its status labels and filter, the kind choice, and the oral form
 * with the authors editor, consent and send panel — on the production build.
 * The theme is applied the way the storefront toggle applies it (the `.dark`
 * class on `<html>`), then colour transitions settle before the analyze.
 *
 * Two NODE exclusions, the same as `../a11y-axe.e2e.spec.ts` on every route with
 * the shared shell: the BBM topbar (`[data-testid="shell-topbar"]`), whose
 * contrast the owner accepted as the canvas paints it (Issue #2189), and the
 * footer's aria-hidden giant wordmark (`[data-testid="footer-giant"]`, #2180).
 * No rule is allowlisted.
 *
 * ENV SET / STAND: identical to `../congress-submissions.spec.ts` (its docblock
 * and `../support/congress-stand.ts`). Bare CI → inert green.
 */
requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "MAILPIT_URL",
  "IDP_ISSUER",
  "DATABASE_URL",
]);

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const THEMES = ["light", "dark"] as const;

async function scan(page: Page, what: string) {
  for (const theme of THEMES) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      theme === "dark",
    );
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .options({ rules: MAIN_LANDMARK_RULES })
      .withTags(WCAG_TAGS)
      .exclude('[data-testid="shell-topbar"]')
      // #2180 — the footer's giant wordmark: aria-hidden decoration at the
      // canvas-drawn alpha, its accessible form the logo image beside it.
      .exclude('[data-testid="footer-giant"]')
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target).flat(),
    }));
    expect(summary, `axe violations on ${what} (${theme})`).toEqual([]);
  }
  await expect(page.locator("h1"), `one h1 on ${what}`).toHaveCount(1);
}

test.describe.configure({ mode: "serial" });

test("046 EARS-11: the section list and the kind choice pass WCAG 2 A/AA (both themes)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const eventId = await createCongressEvent();
  const doctor = await provisionDoctor("axe");
  await registerForCongress(doctor, eventId);
  await signInInPage(page, doctor);
  await sendTalkThroughApi(page, eventId, "Доклад для проверки доступности");

  await page.goto("/account/congress");
  await expect(page.getByTestId("congress-row")).toHaveCount(1);
  await page.getByRole("button", { name: "+ Новая заявка" }).click();
  await expect(page.getByTestId("congress-pick-oral")).toBeVisible();
  await scan(page, "the section list + kind choice");

  // 046 EARS-8 — the oral form, with the first author's fields open.
  await page
    .getByTestId("congress-pick-oral")
    .getByRole("button", { name: "Начать заявку →" })
    .click();
  await expect(page.getByLabel("Тема")).toBeVisible();
  await page
    .getByTestId("congress-author")
    .first()
    .getByRole("button", { name: "Изменить" })
    .click();
  await expect(page.getByLabel("Фамилия")).toBeVisible();
  await scan(page, "the oral form");
});

test("046 EARS-18…20: the poster form with its birth-date field and the age refusal pass WCAG 2 A/AA (both themes)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const eventId = await createCongressEvent();
  await openPosterIntake(eventId, 40);
  const doctor = await provisionDoctor("axe-poster");
  await registerForCongress(doctor, eventId);
  await signInInPage(page, doctor);

  await page.goto("/account/congress");
  const poster = page.getByTestId("congress-pick-poster");
  // EARS-18 — the poster form, with the birth date asked in the draft (EARS-19).
  await poster.getByRole("button", { name: "Начать заявку →" }).click();
  await expect(page.getByLabel("Цель")).toBeVisible();
  await expect(page.getByLabel("Дата рождения")).toBeVisible();
  await scan(page, "the poster form");

  // EARS-9/19 — a send with gaps: the error summary over the form and the
  // inline field errors (the empty birth date among them).
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByText("Укажите дату рождения").first()).toBeVisible();
  await expect(page.getByText("Текст заявки сохранён.")).toBeVisible();
  await scan(page, "the poster form with the error summary");

  // EARS-20 — the draft of a holder above the limit: the refusal in place of the send.
  await page.getByLabel("Дата рождения").fill(`${new Date().getFullYear() - 50}-06-15`);
  await page.getByLabel("Дата рождения").blur();
  await expect(page.getByText(/На эту дату вам будет/).first()).toBeVisible();
  await scan(page, "the poster draft with the age refusal");
});

test("046 EARS-21…23: the abstract form with its statements, its total counter near and above the limit and the error summary at send passes WCAG 2 A/AA (both themes)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const eventId = await createCongressEvent();
  await openAbstractIntake(eventId, 3);
  const doctor = await provisionDoctor("axe-abstract");
  await registerForCongress(doctor, eventId);
  await signInInPage(page, doctor);

  await page.goto("/account/congress");
  await page
    .getByTestId("congress-pick-abstract")
    .getByRole("button", { name: "Начать заявку →" })
    .click();
  await expect(page.getByLabel("Название тезисов")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "В тексте нет торговых наименований" }),
  ).toBeVisible();
  await scan(page, "the abstract form");

  // EARS-22 — the counter marked near the limit, then above it.
  const counter = page.getByTestId("congress-abstract-counter");
  await page.getByLabel("Результаты и обсуждение").fill("р".repeat(4600));
  await expect(counter).toContainText("осталось 400");
  await scan(page, "the abstract form near the limit");
  await page.getByLabel("Выводы").fill("в".repeat(500));
  await expect(counter).toContainText("больше на 100");
  await scan(page, "the abstract form above the limit");

  // EARS-22/23 — a send above the limit with the statements unmet: the error
  // summary over the form, the inline errors and «Текст заявки сохранён.».
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByText(/Сократите текст тезисов до 5 000 знаков/).first(),
  ).toBeVisible();
  await expect(page.getByText("Текст заявки сохранён.")).toBeVisible();
  await scan(page, "the abstract form with the error summary");
});
