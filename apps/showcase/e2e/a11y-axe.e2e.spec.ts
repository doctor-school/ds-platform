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
 * BOTH THEMES (#537). The catalogue re-themes at runtime by toggling `.dark` on
 * `<html>` (the #515 page toggle — the exact key the token cascade keys off). A
 * light-only scan proves only half the contract: the semantic colour layer flips
 * in `.dark`, so a token pair that clears AA on the white page can fail on the
 * near-black one. The §513 specimen pairs render both themes side-by-side under
 * forced `.light` / `.dark` subtrees (already dark-scanned), but every OTHER
 * specimen (buttons, fields, alerts, blocks) follows the page theme — so those
 * only ever met axe in light. This scan now runs each route TWICE, light then
 * dark, adding `.dark` to `<html>` for the dark pass exactly as the page toggle
 * does. This is the machine that catches a dark-mode AA regression that a
 * screenshot would miss (surfaced the #537 destructive-fill + panel defects).
 *
 * Backend-free: the showcase is a pure viewer with no BFF, so each route can be
 * scanned on landing with no api / Zitadel / Mailpit.
 *
 * The catalogue MUST pass on landing in BOTH themes. If axe reports a REAL
 * violation, the fix is the design-system surface, NOT a weakened scan — so this
 * spec does not allowlist or exclude any rule. A failure here is a true defect.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Every showcase route — each renders a slice of the catalogue in every state. */
const ROUTES = ["/", "/tokens", "/primitives", "/blocks", "/candidates"];

/** The two themes each route is scanned in — the token cascade keys off the
 * `.dark` class on `<html>` (the #515 runtime page toggle), so the dark pass just
 * stamps that class before analysing, the same flip a user makes with the toggle. */
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

async function scan(page: Page, path: string, theme: Theme): Promise<void> {
  await page.goto(path);
  // Wait for the page's main region so the catalogue has rendered before the scan
  // (axe reads the live DOM; a half-rendered page would under-report).
  await page.locator("main").first().waitFor({ state: "visible" });

  // Dark pass: stamp `.dark` on <html> exactly as the runtime page toggle (#515)
  // does, then let the token custom-properties recascade before the scan reads
  // computed colours. Forced `.light`/`.dark` specimen subtrees (§513 pairs) pin
  // their own theme and are unaffected; every page-themed specimen flips.
  if (theme === "dark") {
    await page.evaluate(() =>
      document.documentElement.classList.add("dark"),
    );
    // One frame for the custom-property cascade + repaint to settle.
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(null))),
    );
  }

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  // Surface every violation in the assertion message so a CI failure is
  // self-describing (rule id + impact + the offending node selectors).
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations on ${path} (${theme})`).toEqual([]);
}

test.describe("#351 axe-core a11y scan of the showcase (backend-free)", () => {
  for (const route of ROUTES) {
    for (const theme of THEMES) {
      test(`${route} passes WCAG 2 A/AA (${theme})`, async ({ page }) => {
        await scan(page, route, theme);
      });
    }
  }
});
