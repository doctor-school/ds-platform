import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * 008 EARS-12 (contrast slice) — axe-core WCAG 2 A/AA scan of the PORTAL SHELL: the
 * persistent app-shell header (logo, top-nav, theme toggle, the guest «Войти» chip)
 * composited over the `/webinars` discovery front-door, in BOTH themes. The runtime twin of
 * the CI `playwright-axe` BLOCK gate (which scans the DS primitives via the
 * showcase), retargeted onto the composed shell surface. The full canvas-fidelity
 * eyes-on parity check (EARS-12, both breakpoints × both themes) is the separate
 * Stage-B manual gate — this pins the automated a11y floor.
 *
 * GUEST render: the header's guest branch («Войти») + the public `/webinars` listing need
 * no session — so, like the 004 `discovery-axe` scan, this has NO Mailpit/Zitadel
 * dependency and runs whenever a live portal is present (`E2E_PORTAL_URL`).
 *
 * SCOPE — two leaf-scoped node exclusions, never a container band (which would
 * swallow the interactive header controls): the feature-004 poster band's
 * reduced-opacity decorative kickers/chips (`data-testid="poster-decor"`, #924,
 * standing 004 canvas debt) and the shared shell's BBM topbar
 * (`data-testid="shell-topbar"`, #2180), whose contrast the owner accepted on
 * 2026-09-11 as the canvas paints it — recorded as Issue #2189. The header
 * itself (logo, nav links, theme toggle, «Войти») stays fully IN scope.
 *
 * Since #2180 the header under scan is `@ds/storefront-shell`'s `StorefrontHeader`,
 * mounted through `apps/portal/components/academy-shell-header.tsx`.
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
    // #2189 — the shared shell's BBM topbar (#2180) keeps the contrast its
    // owner-approved canvas paints; accepted by the owner 2026-09-11 and
    // recorded on Issue #2189. Leaf-scoped like the line above, so the header's
    // logo, nav, theme toggle and auth cluster all stay IN the scan.
    .exclude('[data-testid="shell-topbar"]')
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
    // The discovery front-door is `/webinars` (`DISCOVERY_HREF`), which is where
    // the logo and «Эфиры» point. `/` has served the static Academy home since
    // #1313, and that page's own decorative giant wordmark (`.origin-bottom`,
    // excluded as tracked 013 canvas debt by `academy-home.e2e.spec.ts`) is not
    // shell surface at all — scanning `/` measured the home, not the chrome.
    // `/webinars` also carries the shared FOOTER, which `/` does not, so the
    // scanned surface grows rather than shrinks.
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    for (const theme of THEMES) await scan(page, theme);
  });
});
