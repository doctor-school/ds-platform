import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

/**
 * Page-level axe-core a11y scan of the doctor storefront (#1440), the sibling of
 * `apps/portal/e2e/a11y-axe.e2e.spec.ts`.
 *
 * The showcase `playwright-axe` gate scans the DS primitives in isolation; THIS
 * spec scans the composed page for what only a real page can violate: shell
 * landmark structure (`landmark-one-main`), heading hierarchy, plus the full
 * WCAG 2.0/2.1 A+AA rule set. The explicit exactly-one-non-empty-`h1` assertion
 * is BOTH the composed-page check (axe's `page-has-heading-one` only asserts
 * "at least one") and the loud empty-shell sentinel: a page that rendered
 * nothing would otherwise be trivially axe-clean.
 *
 * Single theme (light) — composed pages are not the token catalogue; the
 * theme-matrix contrast scan lives in the showcase gate.
 *
 * If axe reports a REAL violation, the fix is the surface, NOT a weakened scan —
 * this spec allowlists and excludes no rule.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test("#1440 storefront root passes WCAG 2 A/AA + one-h1 shell check", async ({
  page,
}) => {
  await page.goto("/");

  const h1 = page.locator("h1");
  await expect(h1, "h1 count on /").toHaveCount(1);
  await expect(h1, "h1 text on /").not.toHaveText(/^\s*$/);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  // Surface every violation in the assertion message so a CI failure is
  // self-describing (rule id + impact + the offending node selectors).
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, "axe violations on /").toEqual([]);
});
