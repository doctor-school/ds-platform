import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

/**
 * Page-level axe-core a11y scan of the doctor storefront (#1440), the sibling of
 * `apps/portal/e2e/a11y-axe.e2e.spec.ts`.
 *
 * The showcase `playwright-axe` gate scans the DS primitives in isolation; THIS
 * spec scans the composed page for what only a real page can violate: shell
 * landmark structure (`landmark-one-main`), heading hierarchy, plus the full
 * WCAG 2.0/2.1 A+AA rule set. The explicit exactly-one-non-empty-`h1` assertion
 * is BOTH the composed-page check (axe's `page-has-heading-one` only asserts
 * "at least one") and the loud empty-shell sentinel: a page that rendered
 * nothing would otherwise be trivially axe-clean.
 *
 * Single theme (light) — composed pages are not the token catalogue; the
 * theme-matrix contrast scan lives in the showcase gate.
 *
 * If axe reports a REAL violation, the fix is the surface, NOT a weakened scan —
 * this spec allowlists and excludes no rule.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * 017 EARS-2 — the statistics read the hero's counters hang on. This tier is
 * backend-free, so WITHOUT this mock the read rejects, `HeroCounters` renders
 * `null`, and the scan would silently cover the hero COPY only: neither the
 * definition-list band nor the loading status region would ever be checked by
 * the gate that EARS-14 makes responsible for them.
 */
const STATISTICS = "**/v1/public/statistics";
const STATISTICS_BODY = {
  // The production shape — `lessons` has no source, so it is absent and the
  // band renders three cells. The scan therefore sees the real markup.
  doctors: 12400,
  specialties: 118,
  eventsPerYear: 86,
  computedAt: "2026-08-26T09:00:00.000Z",
};

test("#1440 storefront root passes WCAG 2 A/AA + one-h1 shell check", async ({
  page,
}) => {
  await page.route(STATISTICS, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STATISTICS_BODY),
    }),
  );
  await page.goto("/");
  // Scan the RESOLVED band, not whatever happened to be on screen first.
  await expect(page.getByTestId("hero-counters")).toHaveAttribute(
    "data-state",
    "ready",
  );

  const h1 = page.locator("h1");
  await expect(h1, "h1 count on /").toHaveCount(1);
  await expect(h1, "h1 text on /").not.toHaveText(/^\s*$/);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  // Surface every violation in the assertion message so a CI failure is
  // self-describing (rule id + impact + the offending node selectors).
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, "axe violations on /").toEqual([]);
});

/**
 * The «загрузка» render is a live region (`role="status"`, `aria-busy`) and is
 * the state a real visitor meets FIRST, so it gets its own scan: a held route
 * keeps the band in the skeleton render for the duration of the analysis.
 */
test("#1440 the hero counters' loading render passes WCAG 2 A/AA", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(STATISTICS, async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STATISTICS_BODY),
    });
  });
  await page.goto("/");

  await expect(page.getByTestId("hero-counters")).toHaveAttribute(
    "data-state",
    "loading",
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  release();

  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, "axe violations on / (loading counters)").toEqual([]);
});

/**
 * 021 EARS-1 / EARS-16 — the registration route joins the gate the day it ships.
 *
 * A form surface fails differently from a content surface, so this scans the two
 * states that carry the a11y risk: the resting form (label/control association,
 * the disabled submit's `aria-describedby` reason) and the error state (the
 * `aria-invalid` + message linkage that makes a rejection audible rather than
 * merely red). The route takes no backend read, so no route mock is needed.
 */
for (const [state, drive] of [
  ["resting", async () => {}],
  [
    "error",
    async (page: import("@playwright/test").Page) => {
      await page.getByTestId("register-email").fill("not-an-address");
      await page.getByTestId("register-email").blur();
      await page.getByTestId("register-password").fill("short");
      await page.getByTestId("register-password").blur();
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    },
  ],
] as const) {
  test(`021 EARS-1 /register passes WCAG 2 A/AA + one-h1 check (${state})`, async ({
    page,
  }) => {
    await page.goto("/register");
    await drive(page);

    const h1 = page.locator("h1");
    await expect(h1, "h1 count on /register").toHaveCount(1);
    await expect(h1, "h1 text on /register").not.toHaveText(/^\s*$/);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target).flat(),
    }));
    expect(summary, `axe violations on /register (${state})`).toEqual([]);
  });
}
