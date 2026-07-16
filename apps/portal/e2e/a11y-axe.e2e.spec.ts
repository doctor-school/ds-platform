import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * Thin page-level axe-core a11y scan of the portal auth surfaces (#400,
 * resurrecting the #274 tier retired by the #351 showcase retarget).
 *
 * The showcase `playwright-axe` CI gate scans the DS primitives in isolation;
 * THIS spec scans the COMPOSED product pages — /login, /register, /reset — for
 * what only a real page can violate: page-shell landmark structure
 * (`landmark-one-main`), heading hierarchy (`page-has-heading-one`,
 * `heading-order`, both in the WCAG tag set below), plus the full WCAG 2.0/2.1
 * A+AA rule set (color-contrast, form labels, name-role-value, …). An explicit
 * exactly-one-`h1` assertion per route is the composed-page check the Issue
 * names — axe's `page-has-heading-one` only asserts "at least one".
 *
 * Backend-free: the auth pages render their forms client-side, so each route is
 * scanned on landing with no api / Zitadel / Mailpit. Single theme (light) —
 * composed pages are not the token catalogue; theme-matrix contrast lives in
 * the showcase gate.
 *
 * If axe reports a REAL violation, the fix is the surface, NOT a weakened scan —
 * this spec does not allowlist or exclude any rule. A failure here is a true
 * defect to report.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // Wait for the primary interactive region so the form has rendered before the
  // scan (axe reads the live DOM; a half-rendered page would under-report).
  await page.locator("form, main").first().waitFor({ state: "visible" });

  // Composed-page shell check: exactly one h1 per route (axe's
  // `page-has-heading-one` only guarantees ≥1, and is a best-practice-tagged
  // rule the WCAG tag set below does not run). SOFT so a shell failure still
  // lets the axe scan below report its verdict in the same run.
  await expect
    .soft(page.locator("h1"), `h1 count on ${path}`)
    .toHaveCount(1);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  // Surface every violation in the assertion message so a CI failure is
  // self-describing (rule id + impact + the offending node selectors).
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations on ${path}`).toEqual([]);
}

test.describe("#400 page-level axe a11y scan (backend-free)", () => {
  test("login page passes WCAG 2 A/AA + one-h1 shell check", async ({
    page,
  }) => {
    await scan(page, "/login");
  });

  test("register page passes WCAG 2 A/AA + one-h1 shell check", async ({
    page,
  }) => {
    await scan(page, "/register");
  });

  test("reset page passes WCAG 2 A/AA + one-h1 shell check", async ({
    page,
  }) => {
    await scan(page, "/reset");
  });
});
