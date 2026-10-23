import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { test, expect, type Page } from "@playwright/test";

/**
 * Page-level axe-core a11y scan of the doctor storefront (#1440), the sibling of
 * `apps/portal/e2e/a11y-axe.e2e.spec.ts`.
 *
 * The showcase `playwright-axe` gate scans the DS primitives in isolation; THIS
 * spec scans the composed page for what only a real page can violate: the
 * one-`<main>` landmark structure (`landmark-one-main`,
 * `landmark-no-duplicate-main`, `landmark-main-is-top-level` — best-practice
 * rules, enabled explicitly beside the tag set via `MAIN_LANDMARK_RULES`, #2664),
 * heading hierarchy, plus the full WCAG 2.0/2.1 A+AA rule set. The explicit
 * exactly-one-non-empty-`h1` assertion is BOTH the composed-page check (axe's `page-has-heading-one` only asserts
 * "at least one") and the loud empty-shell sentinel: a page that rendered
 * nothing would otherwise be trivially axe-clean.
 *
 * Single theme (light) — composed pages are not the token catalogue; the
 * theme-matrix contrast scan lives in the showcase gate.
 *
 * If axe reports a REAL violation, the fix is the surface, NOT a weakened scan.
 * This spec allowlists no RULE. It carries exactly one NODE exclusion, on the
 * routes that mount the shared shell: the BBM topbar
 * (`[data-testid="shell-topbar"]`), whose contrast the owner accepted on
 * 2026-09-11 as the canvas paints it — recorded as Issue #2189 so the blind
 * spot is traceable from the code rather than lost in a review thread. It is
 * leaf-scoped, so no interactive shell control is swallowed with it.
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

  const results = await new AxeBuilder({ page })
    .options({ rules: MAIN_LANDMARK_RULES })
    .withTags(WCAG_TAGS)
    // #2189 — the shared shell's BBM topbar keeps the contrast its owner-approved
    // canvas paints (`design-source/ds-shell.dc.html`, #2180); the owner accepted
    // that on 2026-09-11 and Issue #2189 is the explicit record so the blind spot
    // stays traceable from here. Leaf-scoped (`[data-testid=…]`), never a
    // container band — every interactive shell control stays IN the scan.
    .exclude('[data-testid="shell-topbar"]')
    // #2180 — the footer's giant wordmark is aria-hidden decoration at the
    // canvas-drawn alpha; its accessible form is the logo image beside it. Same
    // leaf exclusion as the academy home's `academy-footer-wordmark`.
    .exclude('[data-testid="footer-giant"]')
    .analyze();

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
  const results = await new AxeBuilder({ page })
    .options({ rules: MAIN_LANDMARK_RULES })
    .withTags(WCAG_TAGS)
    // #2189 — the shared shell's BBM topbar keeps the contrast its owner-approved
    // canvas paints (`design-source/ds-shell.dc.html`, #2180); the owner accepted
    // that on 2026-09-11 and Issue #2189 is the explicit record so the blind spot
    // stays traceable from here. Leaf-scoped (`[data-testid=…]`), never a
    // container band — every interactive shell control stays IN the scan.
    .exclude('[data-testid="shell-topbar"]')
    // #2180 — the footer's giant wordmark is aria-hidden decoration at the
    // canvas-drawn alpha; its accessible form is the logo image beside it. Same
    // leaf exclusion as the academy home's `academy-footer-wordmark`.
    .exclude('[data-testid="footer-giant"]')
    .analyze();
  release();

  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, "axe violations on / (loading counters)").toEqual([]);
});

// #3172 — the sign-in, registration and reset doors are 303 entries on this
// storefront now: their state scans ride the sign-in host tier
// (`apps/login/e2e/doctor-a11y-axe.e2e.spec.ts`, `reset-axe.e2e.spec.ts`), and
// the entries themselves are pinned by `storefront-entry.spec.ts`.

/**
 * 028 EARS-15 (#1967, #1970) — the legal surface joins the gate the day it
 * ships, and the gate asserts what EARS-15 literally names: "real heading
 * structure and links that name their destination".
 *
 * A CONTENT surface fails differently from a form: the risks here are heading
 * structure (a document body is authored Markdown promoted to real `h2`/`h3`,
 * plus the page's own hero `h1`), link text that names its destination, and the
 * contrast of the faint requisites and edition lines. Both routes are scanned —
 * the index composes the row unit and the contact chips, the document composes
 * the ToC and the body — and neither takes an api read, so no route mock is
 * needed on this backend-free tier.
 *
 * Why the WCAG tag set alone is not the gate: axe files `heading-order` under
 * `best-practice`, so a body that jumped h1 → h3 would scan clean on the tags
 * above, and `link-name` only rejects an EMPTY name — «здесь» passes it. The
 * structural assertions below close both holes deterministically from the DOM,
 * and the scan additionally enables `heading-order` and proves it was evaluated.
 */

/** Link text that names nothing — the anti-pattern EARS-15 forbids. */
const GENERIC_LINK_TEXT =
  /^(здесь|тут|сюда|подробнее|далее|ссылка|читать|перейти|click here|here|link|more|read more)\.?$/i;

/** Rule ids axe evaluated in this run, whatever their outcome. */
function evaluatedRuleIds(results: {
  passes: { id: string }[];
  violations: { id: string }[];
  incomplete: { id: string }[];
  inapplicable: { id: string }[];
}): string[] {
  return [
    ...results.passes,
    ...results.violations,
    ...results.incomplete,
    ...results.inapplicable,
  ].map((r) => r.id);
}

/**
 * EARS-15 structure: headings inside `main` never skip a level going down; the
 * document body contributes real `h2` sections; every ToC entry resolves to an
 * element on the same page; every link in `main` has a name that is neither
 * empty nor generic, and no link is a `#` stub.
 */
async function assertLegalStructure(page: Page, label: string): Promise<void> {
  const structure = await page.locator("main").evaluate((main) => {
    const levels = Array.from(
      main.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    ).map((h) => Number(h.tagName.slice(1)));
    const bodyH2 = main.querySelectorAll(
      '[data-testid="legal-document-body"] h2',
    ).length;
    const tocHrefs = Array.from(
      main.querySelectorAll('nav[aria-label="Содержание"] a[href^="#"]'),
    ).map((a) => a.getAttribute("href") ?? "");
    const unresolvedToc = tocHrefs.filter(
      (href) => !main.querySelector(`[id="${CSS.escape(href.slice(1))}"]`),
    );
    const links = Array.from(main.querySelectorAll("a")).map((a) => ({
      href: a.getAttribute("href") ?? "",
      name: (a.getAttribute("aria-label") ?? a.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    }));
    return { levels, bodyH2, tocHrefs, unresolvedToc, links };
  });

  const skips = structure.levels.filter(
    (level, i) => i > 0 && level > structure.levels[i - 1] + 1,
  );
  expect(structure.levels[0], `first heading on ${label} is the h1`).toBe(1);
  expect(
    skips,
    `heading levels skipped on ${label}: ${structure.levels}`,
  ).toEqual([]);

  if (label !== "/documents") {
    expect(
      structure.bodyH2,
      `Markdown h2 sections in the body on ${label}`,
    ).toBeGreaterThan(0);
    expect(
      structure.tocHrefs.length,
      `ToC entries on ${label}`,
    ).toBeGreaterThan(0);
    expect(
      structure.unresolvedToc,
      `ToC anchors without a target on ${label}`,
    ).toEqual([]);
  }

  const nameless = structure.links.filter(
    (l) => l.name === "" || GENERIC_LINK_TEXT.test(l.name),
  );
  expect(
    nameless,
    `links that do not name their destination on ${label}`,
  ).toEqual([]);
  const stubs = structure.links.filter((l) => l.href === "#" || l.href === "");
  expect(stubs, `stub links on ${label}`).toEqual([]);
}

for (const [label, path] of [
  ["/documents", "/documents"],
  ["/documents/privacy-policy", "/documents/privacy-policy"],
] as const) {
  test(`028 EARS-15 ${label} passes WCAG 2 A/AA + heading-order, one-h1 and named-links checks`, async ({
    page,
  }) => {
    await page.goto(path);

    const h1 = page.locator("h1");
    await expect(h1, `h1 count on ${label}`).toHaveCount(1);
    await expect(h1, `h1 text on ${label}`).not.toHaveText(/^\s*$/);

    await assertLegalStructure(page, label);

    // `options` first, `withTags` second: the builder's tag call writes
    // `runOnly` onto the options object, and an explicit `rules[id].enabled`
    // wins over the tag filter inside axe, so `heading-order` runs beside the
    // WCAG set instead of replacing it.
    const results = await new AxeBuilder({ page })
      .options({
        rules: { ...MAIN_LANDMARK_RULES, "heading-order": { enabled: true } },
      })
      .withTags(WCAG_TAGS)
      // #2189 — see the note on the storefront-root scan above: the shared
      // shell's BBM topbar is the one accepted contrast exception, leaf-scoped.
      .exclude('[data-testid="shell-topbar"]')
      // #2180 — the footer's giant wordmark: aria-hidden decoration, see above.
      .exclude('[data-testid="footer-giant"]')
      .analyze();
    expect(
      evaluatedRuleIds(results),
      `heading-order evaluated on ${label}`,
    ).toContain("heading-order");

    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target).flat(),
    }));
    expect(summary, `axe violations on ${label}`).toEqual([]);
  });
}
