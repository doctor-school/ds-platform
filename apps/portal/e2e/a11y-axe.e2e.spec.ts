import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * Thin page-level axe-core a11y scan of the portal auth surfaces (#400,
 * resurrecting the #274 tier retired by the #351 showcase retarget).
 *
 * The showcase `playwright-axe` CI gate scans the DS primitives in isolation;
 * THIS spec scans the COMPOSED product pages — /login, /register, /reset — for
 * what only a real page can violate: page-shell landmark structure
 * (`landmark-one-main`), heading hierarchy (`page-has-heading-one` in the WCAG tag set below;
 * `heading-order` is best-practice and is enabled explicitly for 028), plus the full WCAG 2.0/2.1
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
 * If axe reports a REAL violation, the fix is the surface, NOT a weakened scan.
 * This spec allowlists no RULE. It carries exactly one NODE exclusion — the
 * shared shell's BBM topbar (`[data-testid="shell-topbar"]`, #2180), whose
 * contrast the owner accepted on 2026-09-11 as the canvas paints it, recorded
 * as Issue #2189 so the blind spot is traceable from the code. It is
 * leaf-scoped, so no interactive shell control is swallowed with it. Any other
 * failure here is a true defect to report.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** The `useRedirectIfAuthenticated` session probe (`authClient.session()`). */
const SESSION_PROBE = "**/v1/auth/session";

/**
 * 028: the documents surfaces are backend-free AND form-free, so the auth-page
 * readiness contract (mock the session probe, wait for a `form`) does not apply
 * to them — `ready` names what must have rendered before axe reads the DOM instead.
 * The anonymous session probe stays mocked for EVERY route: the 008 shell header
 * these pages mount reads it too, and an unmocked probe would leave the header in
 * its pending state, scanning less of the composed page than ships. The
 * empty-shell sentinel stays the exactly-one-non-empty-h1 assertion below, which
 * every route in this tier still runs.
 */
/**
 * 028 EARS-15 (#1970) — "real heading structure and links that name their
 * destination". axe files `heading-order` under `best-practice`, so a body that
 * jumped h1 → h3 would scan clean on the WCAG tags alone, and `link-name` only
 * rejects an EMPTY name — «здесь» passes it. These DOM assertions close both
 * holes deterministically; the 028 scans additionally enable `heading-order`
 * and prove it was evaluated.
 */
const GENERIC_LINK_TEXT =
  /^(здесь|тут|сюда|подробнее|далее|ссылка|читать|перейти|click here|here|link|more|read more)\.?$/i;

async function assertLegalStructure(page: Page, path: string): Promise<void> {
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
  expect(structure.levels[0], `first heading on ${path} is the h1`).toBe(1);
  expect(
    skips,
    `heading levels skipped on ${path}: ${structure.levels}`,
  ).toEqual([]);

  if (path !== "/documents") {
    expect(
      structure.bodyH2,
      `Markdown h2 sections in the body on ${path}`,
    ).toBeGreaterThan(0);
    expect(structure.tocHrefs.length, `ToC entries on ${path}`).toBeGreaterThan(
      0,
    );
    expect(
      structure.unresolvedToc,
      `ToC anchors without a target on ${path}`,
    ).toEqual([]);
  }

  const nameless = structure.links.filter(
    (l) => l.name === "" || GENERIC_LINK_TEXT.test(l.name),
  );
  expect(
    nameless,
    `links that do not name their destination on ${path}`,
  ).toEqual([]);
  const stubs = structure.links.filter((l) => l.href === "#" || l.href === "");
  expect(stubs, `stub links on ${path}`).toEqual([]);
}

async function scan(
  page: Page,
  path: string,
  options: { ready?: string; legal?: boolean } = {},
): Promise<void> {
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
  await page
    .locator(options.ready ?? "form")
    .first()
    .waitFor({ state: "visible" });

  // Composed-page shell check: exactly one NON-EMPTY h1 per route (axe's
  // `page-has-heading-one` only guarantees ≥1, and is a best-practice-tagged
  // rule the WCAG tag set below does not run). Also the loud empty-shell
  // sentinel: a body with no rendered content cannot pass this.
  const h1 = page.locator("h1");
  await expect(h1, `h1 count on ${path}`).toHaveCount(1);
  await expect(h1, `h1 text on ${path}`).not.toHaveText(/^\s*$/);

  if (options.legal) await assertLegalStructure(page, path);

  // `options` first, `withTags` second: the builder's tag call writes `runOnly`
  // onto the options object, and an explicit `rules[id].enabled` wins over the
  // tag filter inside axe, so `heading-order` runs BESIDE the WCAG set.
  const builder = options.legal
    ? new AxeBuilder({ page }).options({
        rules: { "heading-order": { enabled: true } },
      })
    : new AxeBuilder({ page });
  const results = await builder
    .withTags(WCAG_TAGS)
    // #2189 — the shared shell's BBM topbar (#2180) keeps the contrast its
    // owner-approved canvas paints; accepted by the owner 2026-09-11 and
    // recorded on Issue #2189 so the blind spot stays traceable from here.
    // Leaf-scoped (`[data-testid=…]`), never a container band, so the header's
    // logo, nav, theme toggle and auth cluster all stay IN the scan. Harmless on
    // /login, /register and /reset, where the shell is hidden by config.
    .exclude('[data-testid="shell-topbar"]')
    .analyze();
  if (options.legal) {
    const evaluated = [
      ...results.passes,
      ...results.violations,
      ...results.incomplete,
      ...results.inapplicable,
    ].map((r) => r.id);
    expect(evaluated, `heading-order evaluated on ${path}`).toContain(
      "heading-order",
    );
  }

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

  // 028 EARS-2/3/4/5 — the Academy documents surfaces. Both are composed
  // long-form reading pages (heading hierarchy, link contrast, landmark
  // structure), which is precisely what a primitive-level scan cannot cover.
  test("028 EARS-15: the documents index passes WCAG 2 A/AA + heading-order, one-h1 and named-links checks", async ({
    page,
  }) => {
    await scan(page, "/documents", {
      ready: '[data-testid="documents-list"]',
      legal: true,
    });
  });

  test("028 EARS-15: the policy document page passes WCAG 2 A/AA + heading-order, ToC anchors and named-links checks", async ({
    page,
  }) => {
    await scan(page, "/documents/privacy-policy", {
      ready: '[data-testid="legal-document-body"]',
      legal: true,
    });
  });
});
