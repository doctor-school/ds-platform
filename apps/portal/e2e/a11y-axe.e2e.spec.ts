import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * Thin page-level axe-core a11y scan of the portal auth surfaces (#400,
 * resurrecting the #274 tier retired by the #351 showcase retarget).
 *
 * The showcase `playwright-axe` CI gate scans the DS primitives in isolation;
 * THIS spec scans the COMPOSED product pages — /login, /register, /reset — for
 * what only a real page can violate: page-shell landmark structure
 * (`landmark-one-main`), heading hierarchy (`page-has-heading-one`,
 * `heading-order`, both in the WCAG tag set below), plus the full WCAG 2.0/2.1
 * A+AA rule set (color-contrast, form labels, name-role-value, …). An explicit
 * exactly-one-`h1` assertion per route is the composed-page check the Issue
 * names — axe's `page-has-heading-one` only asserts "at least one".
 *
 * Backend-free — but NOT probe-free: /login and /register mount inside
 * `useRedirectIfAuthenticated`, whose `authClient.session()` read
 * (`GET /v1/auth/session`) never resolves to "anonymous" when the BFF upstream
 * is dead (the fetch rejects → the guard stays pending → `<AuthShell>` renders
 * NOTHING). An unmocked hermetic run therefore scans an EMPTY BODY and axe is
 * trivially clean (#1034 discovery). So each scan mocks the session probe with
 * a deterministic 401 ("anonymous"), waits for the page's real form, and
 * asserts rendered content (exactly-one non-empty h1) BEFORE running axe — an
 * empty-shell scan fails loudly instead of passing clean.
 *
 * Single theme (light) — composed pages are not the token catalogue;
 * theme-matrix contrast lives in the showcase gate.
 *
 * If axe reports a REAL violation, the fix is the surface, NOT a weakened scan —
 * this spec does not allowlist or exclude any rule. A failure here is a true
 * defect to report.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** The `useRedirectIfAuthenticated` session probe (`authClient.session()`). */
const SESSION_PROBE = "**/v1/auth/session";

async function scan(page: Page, path: string): Promise<void> {
  // Deterministic anonymous principal: fulfill the session probe with the 401
  // the real BFF returns for a cookie-less visitor, so the auth shell renders
  // without any backend (`authClient.session()` maps 401 → null → "anonymous").
  await page.route(SESSION_PROBE, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "unauthorized" }),
    }),
  );
  await page.goto(path);
  // Wait for the page's real form so the surface has rendered before the scan
  // (axe reads the live DOM; the pending-guard empty shell has no form at all,
  // and a half-rendered page would under-report).
  await page.locator("form").first().waitFor({ state: "visible" });

  // Composed-page shell check: exactly one NON-EMPTY h1 per route (axe's
  // `page-has-heading-one` only guarantees ≥1, and is a best-practice-tagged
  // rule the WCAG tag set below does not run). Also the loud empty-shell
  // sentinel: a body with no rendered content cannot pass this.
  const h1 = page.locator("h1");
  await expect(h1, `h1 count on ${path}`).toHaveCount(1);
  await expect(h1, `h1 text on ${path}`).not.toHaveText(/^\s*$/);

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

test.describe("#400 page-level axe a11y scan (backend-free)", () => {
  test("login page passes WCAG 2 A/AA + one-h1 shell check", async ({
    page,
  }) => {
    await scan(page, "/login");
  });

  test("register page passes WCAG 2 A/AA + one-h1 shell check", async ({
    page,
  }) => {
    await scan(page, "/register");
  });

  test("reset page passes WCAG 2 A/AA + one-h1 shell check", async ({
    page,
  }) => {
    await scan(page, "/reset");
  });
});
