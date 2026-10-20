import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { expect, test, type Page } from "@playwright/test";
import { DOCTOR_BASE, loginAsDoctor } from "../support/doctor-session";
import { requireLiveStandEnv } from "../support/live-stand-env";

/**
 * 003 EARS-28 / wave-4 gate row 19 (#2073) — axe-core WCAG 2 A/AA scan of the
 * doctor storefront's signed-in `/account`, now the `@ds/account` cabinet, in
 * both themes. It mirrors the Academy's `/account` block in
 * `apps/portal/e2e/a11y/a11y-axe.e2e.spec.ts`: the EARS-27 identity rows, the
 * verified badge, the destructive sign-out row, then the inline display-name
 * edit state as a distinct render.
 *
 * The theme is applied the way the storefront toggle applies it (the `.dark`
 * class on `<html>`), then colour transitions settle before the analyze. Two
 * NODE exclusions, the same as `../a11y-axe.e2e.spec.ts` on every route with
 * the shared shell: the BBM topbar (`[data-testid="shell-topbar"]`, owner-
 * accepted contrast, Issue #2189) and the footer's aria-hidden giant wordmark
 * (`[data-testid="footer-giant"]`, #2180). No rule is allowlisted.
 *
 * ENV SET / STAND: identical to `../my-events.spec.ts` (the reused doctor
 * account; `playwright.event-register.config.ts`). Bare CI → inert green.
 */
requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
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
}

test("003 EARS-28: the doctor /account profile surface passes WCAG 2 A/AA (both themes)", async ({
  page,
}) => {
  await loginAsDoctor(page);
  await page.goto(DOCTOR_BASE + "/account", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("profile-email")).toBeVisible();
  await scan(page, "the /account profile surface");

  // The inline-edit state (input + Сохранить/Отмена) is a distinct render —
  // scan it too so the edit affordance can't ship an AA regression.
  await page.getByTestId("profile-name-edit").click();
  await expect(page.getByTestId("profile-name-input")).toBeVisible();
  await scan(page, "the /account display-name edit state");
});
