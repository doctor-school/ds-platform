import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * 008 EARS-12 (contrast slice) — axe-core WCAG 2 A/AA scan of the PORTAL SHELL: the
 * persistent app-shell header (logo, top-nav, theme toggle, the guest «Войти» chip)
 * composited over the `/` discovery front-door, in BOTH themes. The runtime twin of
 * the CI `playwright-axe` BLOCK gate (which scans the DS primitives via the
 * showcase), retargeted onto the composed shell surface. The full canvas-fidelity
 * eyes-on parity check (EARS-12, both breakpoints × both themes) is the separate
 * Stage-B manual gate — this pins the automated a11y floor.
 *
 * GUEST render: the header's guest branch («Войти») + the public `/` listing need
 * no session — so, like the 004 `discovery-axe` scan, this has NO Mailpit/Zitadel
 * dependency and runs whenever a live portal is present (`E2E_PORTAL_URL`).
 *
 * SCOPE — only the feature-004 poster band's reduced-opacity decorative
 * kickers/chips (`data-testid="poster-decor"`) are EXCLUDED (#924, leaf-scoped —
 * never a container band, which would swallow the interactive header controls): the
 * app-shell header itself (logo, nav links, theme toggle, «Войти») stays fully IN
 * scope, and their standing 004 poster findings are tracked 004 canvas debt, not a
 * regression this slice introduces.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const THEMES = ["light", "dark"] as const;

async function scan(page: Page, theme: (typeof THEMES)[number]) {
  await page.locator("main, body").first().waitFor({ state: "visible" });
  // Apply the theme under scan via the SAME mechanism the portal uses — the
  // `.dark` class on `<html>` (the DS token scope) — then let colour transitions
  // settle so axe never reads a mid-transition computed colour (a phantom finding).
  await page.evaluate(
    (dark) => document.documentElement.classList.toggle("dark", dark),
    theme === "dark",
  );
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // Leaf-scoped (#924): only the 004 poster's reduced-opacity decorative
    // kickers/chips, whose standing findings are tracked 004 canvas debt. The
    // whole app-shell header stays in scope.
    .exclude('[data-testid="poster-decor"]')
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations on ${page.url()} (${theme})`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("008 EARS-12 axe-core a11y scan of the portal shell (e2e)", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual gate",
  );

  test("the guest shell over the discovery front-door passes WCAG 2 A/AA (both themes)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    for (const theme of THEMES) await scan(page, theme);
  });
});
