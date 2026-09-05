import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAsDoctor, DOCTOR_BASE } from "../support/doctor-session";
import { requireLiveStandEnv } from "../support/live-stand-env";

/**
 * 006 EARS-11 · 020 (#1912, #1722 slice 4) — axe-core WCAG 2 A/AA scan of the REAL
 * DOCTOR room route `doctor.school/events/[slug]/room`.
 *
 * The academy twin is `apps/portal/e2e/a11y/room-axe.e2e.spec.ts`, and the reason
 * this host needs its OWN scan is that the composition it renders is not the same
 * DOM: the shared `@ds/room` unit is handed THIS host's chrome cluster (the
 * storefront theme toggle + a NON-interactive initials chip, `room-user-cluster.tsx`)
 * and THIS host's copy, and the route sits outside the storefront shell. The CI
 * `playwright-axe` BLOCK gate scans the DS primitives via the showcase; this scan
 * covers the composed gated room a doctor actually reaches on doctor.school.
 *
 * SCOPE — the third-party provider EMBED SUBTREE (`room-player-rutube` /
 * `room-player-youtube`) is EXCLUDED: per EARS-9 the stream is a configured
 * provider FRAME only — the iframe's inner document is the provider's own surface,
 * outside the EARS-9 frame boundary and outside our remediation reach. The truthful
 * stream-unavailable state (`room-player-unavailable`) is OUR OWN surface and is
 * NOT excluded.
 *
 * BOTH THEMES (006 EARS-12/13): the room header ships the storefront's theme
 * toggle, so `.dark` on `<html>` is user-reachable on this very surface and the
 * composed room is scanned in light AND dark. A dark render must introduce no new
 * axe violations relative to light.
 *
 * ENV SET / STAND PRECONDITIONS: identical to `../room.spec.ts` — read the ENV SET
 * table and the STAND PRECONDITIONS block at the head of that file (a saved display
 * name on the reusable account, raised rate-limit ceilings on the api). A bare
 * environment keeps this scan inert-green; a partially exported one fails loudly
 * naming the missing variables.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const THEMES = ["light", "dark"] as const;
const SLUG = process.env.E2E_ROOM_SLUG_RUTUBE;

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
  "E2E_ROOM_SLUG_RUTUBE",
  "IDP_ISSUER",
  "MAILPIT_URL",
]);

async function scan(page: Page, theme: (typeof THEMES)[number]) {
  await page.locator("main, body").first().waitFor({ state: "visible" });
  // Apply the theme under scan via the SAME mechanism the room-header toggle uses
  // — the `.dark` class on `<html>` (006 EARS-12/13, the DS token scope) — then let
  // colour TRANSITIONS settle: DS interactive primitives carry
  // `transition-all`/`transition-colors`, and an immediate post-toggle analyze
  // reads MID-TRANSITION computed colours (a phantom contrast failure).
  await page.evaluate(
    (dark) => document.documentElement.classList.toggle("dark", dark),
    theme === "dark",
  );
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // The provider embed subtree is outside the EARS-9 frame boundary — see the
    // scope note above. `room-player-unavailable` (ours) stays in scope.
    .exclude('[data-testid="room-player-rutube"]')
    .exclude('[data-testid="room-player-youtube"]')
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

// The leading `006 EARS-11 ` prefix is the ears-test-lint feature scope.
test.describe("006 EARS-11 axe-core a11y scan of the doctor room route", () => {
  test("006 EARS-11: the gated doctor-host room composition passes WCAG 2 A/AA (both themes)", async ({
    page,
  }) => {
    await loginAsDoctor(page);
    await page.goto(`${DOCTOR_BASE}/events/${SLUG}/room`, {
      waitUntil: "domcontentloaded",
    });

    // Preconditions for a MEANINGFUL scan: the gate admitted (the room url holds),
    // the saved display name kept the EARS-14 prompt away, and the full
    // composition — context strip, chat aside, provider frame — is mounted.
    await expect(page).toHaveURL(new RegExp(`/events/${SLUG}/room$`));
    await expect(
      page.getByTestId("display-name-prompt"),
      "the reusable doctor must already have a saved display name (STAND PRECONDITIONS)",
    ).toHaveCount(0);
    await expect(page.getByTestId("room-context-strip")).toBeVisible();
    await expect(page.getByTestId("room-chat").first()).toBeVisible();
    await expect(page.getByTestId("room-player-rutube")).toBeVisible();

    for (const theme of THEMES) await scan(page, theme);
  });
});
