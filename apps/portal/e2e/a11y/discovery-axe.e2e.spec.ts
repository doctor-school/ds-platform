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
 * SCOPE — only the 004 neo-brutalist poster band's REDUCED-OPACITY decorative
 * kickers/chips (tagged `data-testid="poster-decor"`) are EXCLUDED (#924, leaf-
 * scoped — never the whole `.bg-header` band, which would swallow arbitrary
 * downstream content incl. any interactive control): they are the approved 004
 * canvas surface whose standing axe contrast findings are tracked 004 canvas debt
 * (see the #559 PR decision-debt), not a regression this slice introduces. The
 * poster band's full-strength content (headings, full-contrast chips, the footer
 * CTA) stays IN scope, as do the composed body regions (the status card `bg-card`,
 * the day-grouped card list).
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
    // 004's reduced-opacity decorative poster kickers/chips only (`data-testid=
    // "poster-decor"`) — their standing contrast findings are tracked 004 canvas
    // debt. Leaf-scoped (#924), NOT a `.bg-header` band exclude, so the rest of the
    // poster band (titles, full-strength chips, the footer CTA, and any interactive
    // header control) stays IN the a11y scan.
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

  // 004 EARS-19 (#1050) + EARS-16/17/18 (#1051) — the month-calendar pane
  // (`?view=month`) is a BLOCK-guard (`playwright-axe`) surface too: the desktop
  // grid AND the mobile dot-grid + agenda are scanned at BOTH breakpoints × both
  // themes, with the 12-month picker popover OPENED so the picker + the toolbar
  // switcher/pager are in scope (the popover content is otherwise `display:none`
  // and unscanned). The live signal is carried in text (a screen-reader label on
  // the red pill, the «LIVE» agenda badge, the per-day `aria-label`), never colour
  // alone; the picker's month cells + year stepper carry accessible names.
  for (const [label, viewport] of [
    ["desktop grid", { width: 1280, height: 900 }],
    ["mobile dot-grid + agenda", { width: 390, height: 844 }],
  ] as const) {
    test(`the guest month view (${label}) passes WCAG 2 A/AA (both themes)`, async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.setViewportSize(viewport);
      await page.goto("/webinars?view=month", { waitUntil: "domcontentloaded" });
      // Open the 12-month picker so its popover (year stepper + month cells) is
      // in the a11y tree for the scan.
      await page.getByTestId("month-toolbar").locator("summary").click();
      await expect(page.locator('[aria-current="true"]').first()).toBeVisible();
      for (const theme of THEMES) await scan(page, theme);
    });
  }

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
