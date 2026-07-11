import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * 004 EARS-13 (contrast slice, #559) — axe-core WCAG 2 A/AA scan of the PUBLIC 004
 * webinar surfaces this integration slice owns: the guest upcoming-broadcasts
 * listing and the guest event page in each lifecycle render (upcoming / live /
 * ended / archived). It is the runtime twin of the CI `playwright-axe` BLOCK gate
 * (which scans the DS primitives via the showcase) retargeted onto the composed
 * 004 portal surfaces. The settled token fact it guards: text on `bg-card` uses the
 * card-safe AA token `text-primary-action` (blue.700), never `text-primary` (#270).
 *
 * GUEST-ONLY: unlike the 005 registered-doctor scan (a11y-axe.e2e.spec.ts), the 004
 * read surfaces need no session — so this scan has NO Mailpit / Zitadel dependency
 * and runs whenever a live portal is present, gated only on `E2E_PORTAL_URL`.
 *
 * SCOPE — the 004 neo-brutalist dark poster header + footer band (`.bg-header`) are
 * EXCLUDED: their reduced-opacity kickers/chips are the approved 004 canvas surface,
 * whose standing axe contrast findings are tracked 004 canvas debt (see the #559 PR
 * decision-debt), not a regression this slice introduces. The scan targets exactly
 * the composed body regions (the status card `bg-card`, the day-grouped card list).
 *
 * BOTH THEMES (006 EARS-13, #702): the portal now ships a runtime theme — the
 * webinar-room-header toggle flips `.dark` on `<html>` portal-wide and the choice
 * persists across routes, so both themes are user-reachable on these public
 * surfaces too and both are scanned (`THEMES` drives the matrix; the scan applies
 * the theme through the same class mechanism the toggle uses). A dark render must
 * introduce no new axe violations relative to light. The 004 canvas-fidelity
 * eyes-on verification (both breakpoints × both themes) is the separate EARS-14
 * screenshot brief.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const THEMES = ["light", "dark"] as const;
const SEED = {
  upcoming: process.env.E2E_WEBINAR_SLUG ?? "seed-005-upcoming",
  live: process.env.E2E_WEBINAR_SLUG_LIVE ?? "seed-005-live",
  ended: process.env.E2E_WEBINAR_SLUG_ENDED ?? "seed-005-ended",
  archived: process.env.E2E_WEBINAR_SLUG_ARCHIVED ?? "seed-005-archived",
} as const;

async function scan(page: Page, theme: (typeof THEMES)[number]) {
  await page.locator("main, body").first().waitFor({ state: "visible" });
  // Apply the theme under scan via the SAME mechanism the portal uses — the
  // `.dark` class on `<html>` (006 EARS-12/13, the DS token scope) — then let
  // colour TRANSITIONS settle: DS interactive primitives carry `transition-all`/
  // `transition-colors`, and an immediate post-toggle analyze reads MID-TRANSITION
  // computed colours (a phantom contrast failure that vanishes on re-run).
  await page.evaluate(
    (dark) => document.documentElement.classList.toggle("dark", dark),
    theme === "dark",
  );
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // 004's dark poster header + footer band — see the scope note above.
    .exclude(".bg-header")
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

test.describe("004 EARS-13 axe-core a11y scan of the public webinar surfaces", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual gate",
  );

  test("the guest upcoming-broadcasts listing passes WCAG 2 A/AA (both themes)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    for (const theme of THEMES) await scan(page, theme);
  });

  for (const [state, slug] of Object.entries(SEED)) {
    test(`the guest ${state} event page passes WCAG 2 A/AA (both themes)`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto(`/webinars/${slug}`, { waitUntil: "domcontentloaded" });
      for (const theme of THEMES) await scan(page, theme);
    });
  }
});
