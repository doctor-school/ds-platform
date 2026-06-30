import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * axe-core a11y scan, RETARGETED onto the showcase (ADR-0013 §7 layer 4;
 * design-system-showcase spec §5.2, #351).
 *
 * The machine check for the §7 a11y-contrast usage rule (#237): white text on the
 * brand-pinned `primary` / `success` / `warning` fills is allowed only at
 * large/bold (≥3:1); normal-weight text on a colour fill uses the darker
 * `blue.700` (`#114D9E`, 8.14:1). axe's `color-contrast` rule is the automated
 * guard. We also keep the broader WCAG 2.0/2.1 A + AA tag set so a focus-order /
 * name-role-value / form-label regression is caught too.
 *
 * It used to scan the auth surfaces (`apps/portal` /login /register /reset, #274).
 * The §5.2 retarget moves it onto the showcase, which renders EVERY token,
 * primitive and block in EVERY state in one place — so the scan now spans the
 * whole design system (a strict superset of the auth-only routes), including the
 * auth blocks (`AuthCard` / `AuthLayout` / `OtpFocusScreen`) on /blocks composed
 * from the real field primitives.
 *
 * Backend-free: the showcase is a pure viewer with no BFF, so each route can be
 * scanned on landing with no api / Zitadel / Mailpit.
 *
 * The catalogue MUST pass on landing. If axe reports a REAL violation, the fix is
 * the design-system surface, NOT a weakened scan — so this spec does not allowlist
 * or exclude any rule. A failure here is a true defect to report.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Every showcase route — each renders a slice of the catalogue in every state. */
const ROUTES = ["/", "/tokens", "/primitives", "/blocks", "/candidates"];

async function scan(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // Wait for the page's main region so the catalogue has rendered before the scan
  // (axe reads the live DOM; a half-rendered page would under-report).
  await page.locator("main").first().waitFor({ state: "visible" });

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

test.describe("#351 axe-core a11y scan of the showcase (backend-free)", () => {
  for (const route of ROUTES) {
    test(`${route} passes WCAG 2 A/AA`, async ({ page }) => {
      await scan(page, route);
    });
  }
});
