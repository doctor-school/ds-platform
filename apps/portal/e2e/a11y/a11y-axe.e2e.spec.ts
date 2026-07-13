import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  LIVE_STAND,
  submitRegisterAndVerify,
} from "../support/doctor-session";

/**
 * 005 EARS-13 (contrast slice) — axe-core WCAG 2 A/AA scan of the touched portal
 * webinar surfaces (the runtime twin of the CI `playwright-axe` BLOCK gate, which
 * scans the DS primitives via the showcase). It scans the two
 * 005-owned states that no earlier gate covers on the composed portal page:
 *   • the guest published event page (the 004 render 005 overlays onto);
 *   • the REGISTERED doctor's event page (the «вы записаны» confirmation on
 *     `bg-card`) + «мои события» (the registered `webinar-card` variant, day-grouped).
 * The settled token fact it guards: text on `bg-card` uses the card-safe AA token
 * `text-primary-action` (blue.700), never `text-primary` (#270 precedent).
 *
 * SCOPE — the 004-owned dark poster header + footer band (`.bg-header`) are
 * EXCLUDED from the scan: they are feature 004's approved neo-brutalist surface
 * (reduced-opacity `text-header-foreground` kickers / chips), NOT 005's registered
 * -state additions, and their standing axe contrast findings are 004 debt tracked
 * separately (see the #574 PR decision-debt), not a 005 regression. The scan
 * therefore targets exactly the 005-composed regions: the status card (`bg-card`,
 * the «вы записаны» confirmation + join signposting — no room link until the 006
 * room surface ships, #584) and the «мои события» card list.
 *
 * Dev-stand-gated like the BDD journey: it provisions a real 003 doctor (register +
 * verify via Mailpit) and registers them for the seeded event, then scans. It
 * `test.skip`s unless the live stand env is present, so a stray CI invocation is
 * inert.
 *
 * BOTH THEMES (006 EARS-13, #702): the portal now ships a runtime theme — the
 * room-header toggle flips `.dark` on `<html>` portal-wide and the choice
 * persists, so BOTH themes are user-reachable on every portal surface and both
 * are scanned (`THEMES` drives the matrix; the scan applies the theme through the
 * same class mechanism the toggle uses). A dark render must introduce no new axe
 * violations relative to light. The full canvas-fidelity eyes-on verification
 * (both breakpoints × both themes) is a separate verification brief.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const THEMES = ["light", "dark"] as const;
const SEED = process.env.E2E_WEBINAR_SLUG ?? "seed-005-upcoming";

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

test.describe("005 EARS-13 axe-core a11y scan of the portal webinar surfaces", () => {
  test.skip(!LIVE_STAND, "dev-stand env absent (E2E_PORTAL_URL / IDP_ISSUER / MAILPIT_URL) — manual gate");

  test("the guest published event page passes WCAG 2 A/AA (both themes)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(`/webinars/${SEED}`, { waitUntil: "domcontentloaded" });
    for (const theme of THEMES) await scan(page, theme);
  });

  test("the registered event page + «мои события» pass WCAG 2 A/AA (both themes)", async ({
    page,
  }) => {
    // Provision a doctor and register them for the seeded event by riding the
    // guest-through-auth returnTo path, so the scanned pages carry the REGISTERED
    // state (the «вы записаны» confirmation on `bg-card`, the registered card).
    await page.goto(`/register?returnTo=${encodeURIComponent(`/webinars/${SEED}`)}`, {
      waitUntil: "domcontentloaded",
    });
    await submitRegisterAndVerify(page);
    await page.waitForURL(new RegExp(`/webinars/${SEED}(?:$|[?#])`));
    await expect(page.getByText("Вы записаны", { exact: false }).first()).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    await page.goto("/account/events", { waitUntil: "domcontentloaded" });
    await expect(page.locator(`a[href="/webinars/${SEED}"]`).first()).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);
  });

  // 003 EARS-28 (#770) — the /account profile surface (canvas «Разделы»): the
  // EARS-27 identity rows, the verified badge (`text-success` on `bg-background`),
  // the inline display-name edit affordance, and the destructive sign-out row
  // must all pass WCAG 2 A/AA in both themes. The blue poster header rides the
  // same `.bg-header` scope note as above (004-owned band, excluded).
  test("the /account profile surface passes WCAG 2 A/AA (both themes)", async ({
    page,
  }) => {
    // Provision a fresh doctor (post-login lands on «Мои события», #807), then
    // open the profile surface directly.
    await page.goto("/register", { waitUntil: "domcontentloaded" });
    await submitRegisterAndVerify(page);
    await page.waitForURL(/\/account/);
    await page.goto("/account", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("profile-email")).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);

    // The inline-edit state (input + Сохранить/Отмена) is a distinct render —
    // scan it too so the edit affordance can't ship an AA regression.
    await page.getByTestId("profile-name-edit").click();
    await expect(page.getByTestId("profile-name-input")).toBeVisible();
    for (const theme of THEMES) await scan(page, theme);
  });
});
