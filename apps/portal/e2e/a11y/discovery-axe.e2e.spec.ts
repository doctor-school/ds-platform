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
 * LIGHT-ONLY (mirrors the 005 precedent): the wave-1 portal wires NO theme toggle,
 * so light is the only theme a user can reach on these surfaces. The DS dark-theme
 * tokens are covered (both themes) by the CI `playwright-axe` gate via the showcase;
 * the 004 canvas-fidelity eyes-on verification (both breakpoints × both themes) is
 * the separate EARS-14 screenshot brief. A portal dark theme is a later affordance.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SEED = {
  upcoming: process.env.E2E_WEBINAR_SLUG ?? "seed-005-upcoming",
  live: process.env.E2E_WEBINAR_SLUG_LIVE ?? "seed-005-live",
  ended: process.env.E2E_WEBINAR_SLUG_ENDED ?? "seed-005-ended",
  archived: process.env.E2E_WEBINAR_SLUG_ARCHIVED ?? "seed-005-archived",
} as const;

async function scan(page: Page) {
  await page.locator("main, body").first().waitFor({ state: "visible" });
  // Light is the only reachable portal theme — ensure no stray `.dark` before scan.
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
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
  expect(summary, `axe violations on ${page.url()}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("004 EARS-13 axe-core a11y scan of the public webinar surfaces", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual gate",
  );

  test("the guest upcoming-broadcasts listing passes WCAG 2 A/AA (light)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    await scan(page);
  });

  for (const [state, slug] of Object.entries(SEED)) {
    test(`the guest ${state} event page passes WCAG 2 A/AA (light)`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto(`/webinars/${slug}`, { waitUntil: "domcontentloaded" });
      await scan(page);
    });
  }
});
