import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * axe-core a11y scan of the auth surfaces (ADR-0013 §7 layer 4, #274).
 *
 * The machine check for the §7 a11y-contrast usage rule (#237): white text on the
 * brand-pinned `primary` / `success` / `warning` fills is allowed only at
 * large/bold (≥3:1); normal-weight text on a colour fill uses the darker
 * `blue.700` (`#114D9E`, 8.14:1). axe's `color-contrast` rule is the automated
 * guard. We also keep the broader WCAG 2.0/2.1 A + AA tag set so a focus-order /
 * name-role-value / form-label regression is caught too.
 *
 * Backend-free: the auth pages render their forms client-side, so each route can
 * be scanned on landing with no api / Zitadel / Mailpit.
 *
 * Per the #274 brief: the current surfaces MUST pass on landing. If axe reports a
 * REAL violation, the fix is the surface, NOT a weakened scan — so this spec does
 * not allowlist or exclude any rule. A failure here is a true defect to report.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // Wait for the primary interactive control so the form has rendered before the
  // scan (axe reads the live DOM; a half-rendered page would under-report).
  await page.locator("form, main").first().waitFor({ state: "visible" });

  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();

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

test.describe("#274 axe-core a11y scan (backend-free)", () => {
  test("login surface passes WCAG 2 A/AA", async ({ page }) => {
    await scan(page, "/login");
  });

  test("register surface passes WCAG 2 A/AA", async ({ page }) => {
    await scan(page, "/register");
  });

  test("reset surface passes WCAG 2 A/AA", async ({ page }) => {
    await scan(page, "/reset");
  });
});
