import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/sign-in";

/**
 * #1674 — the admin expert / project / partner detail screens at a phone width
 * (390px).
 *
 * `/events/[id]` was fixed in #1399; the other three detail screens kept the
 * original `mb-6 flex items-center gap-3` header row, so at 390px a realistic
 * (long) expert name or project title and the status badge competed for the
 * same line: the badge sat past the right fold and the page side-scrolled. The
 * fix is the pattern the owner already approved for this same admin surface in
 * #1387/#1399 — stack below `sm`, restore the row from `sm` up — plus `min-w-0
 * break-words` on the heading so an unbreakable long token wraps instead of
 * widening the flex line.
 *
 * The assertions are measured geometry, not class strings: a class assertion
 * would pass on any string edit and prove nothing about the render. "The
 * heading and the badge do not share a vertical band" IS "the header stacked",
 * and `scrollWidth === clientWidth` on the document element IS "the screen is
 * not a side-scroller". Every tab of each screen is measured, because the
 * overflow the Issue reports has to be absent from the whole page, not just the
 * tab that happens to load first.
 *
 * The reproducer half matters as much as the fix half. `restoreBrokenHeader()`
 * puts the ORIGINAL class string back on the live node and re-measures, so the
 * spec demonstrates the bug it guards: if a future refactor makes the defect
 * unreproducible, that assertion fails loudly and this spec gets rewritten
 * rather than silently guarding nothing.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (a MANUAL gate, not CI):
 * the bootstrap provisions a real `platform_admin` against the stand's Zitadel
 * and throws if the `IDP_*` env is absent. Run against a booted admin app+api:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/detail-pages-narrow.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the screenshots the PR body cites; unset, the spec
 * still asserts — the images are evidence for a human, not the gate.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

/** The phone width the 011 Stage-B screenshot was taken at. */
const NARROW = { width: 390, height: 844 };
/** A width comfortably past the `sm` breakpoint, to prove the desktop row is untouched. */
const WIDE = { width: 1440, height: 900 };

/** The exact class string that shipped before this fix — the reproducer's input. */
const BROKEN_DETAIL_HEADER_CLASS = "mb-6 flex items-center gap-3";

/** The three screens this Issue covers, each with its list page and header node. */
const SCREENS = [
  { name: "expert", list: "/experts", detail: "/experts" },
  { name: "project", list: "/projects", detail: "/projects" },
  { name: "partner", list: "/partners", detail: "/partners" },
] as const;

/**
 * The detail screen needs an existing row to render, and the shared dev database
 * is not this spec's to grow one record per invocation — so the subject is the
 * first row of the list. An empty list is a stand-seed problem, not a passing
 * run: it fails with the seed the operator has to add rather than skipping and
 * reporting green on an unmeasured screen.
 */
async function firstRowId(page: Page, listPath: string): Promise<string> {
  await page.goto(listPath);
  const row = page.locator('[data-testid^="row-"]').first();
  try {
    await row.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    throw new Error(
      `${listPath} rendered no rows within 30s — seed at least one record on the stand before running this spec`,
    );
  }
  const testId = await row.getAttribute("data-testid");
  if (!testId) throw new Error(`${listPath} row rendered without a test id`);
  return testId.replace("row-", "");
}

/** Page-level horizontal overflow in px. Must be 0: the page is not a side-scroller. */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

/**
 * The outermost element whose own box sticks out past the viewport AND whose
 * overflow reaches the document — an element inside a horizontally scrollable
 * ancestor (the `TabsList` strip, which pans itself since #1669) is by design
 * wider than the fold and is not a page defect. Reported inside the page-overflow
 * failure message so a red run names the offending node, not just a width.
 */
async function widestOffender(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrolls = (el: Element): boolean => {
      const overflowX = getComputedStyle(el).overflowX;
      return overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden";
    };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.right <= width + 1 && rect.left >= -1) continue;
      let clipped = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (scrolls(p)) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      return `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").slice(0, 140)} right=${Math.round(rect.right)}`;
    }
    return null;
  });
}

/** Do the heading and the status badge share any vertical band? */
async function headerBoxesShareVerticalBand(
  page: Page,
  testId: string,
): Promise<boolean> {
  const header = page.getByTestId(testId);
  const heading = await header.locator("> :first-child").boundingBox();
  const badge = await header.locator("> :last-child").boundingBox();
  if (!heading || !badge) throw new Error("header boxes not measurable");
  return (
    badge.y < heading.y + heading.height && heading.y < badge.y + badge.height
  );
}

/** Put the pre-fix class string back on the live node, to re-measure the defect. */
async function restoreBrokenHeader(page: Page, testId: string): Promise<void> {
  await page
    .getByTestId(testId)
    .evaluate(
      (header, cls) => header.setAttribute("class", cls),
      BROKEN_DETAIL_HEADER_CLASS,
    );
}

/**
 * Measure page overflow on the first tab and on every other tab in turn. The
 * gate is the document: `scrollWidth === clientWidth`. The offender walk only
 * decorates the failure so a red run names the node that pushed the fold.
 */
async function assertNoOverflowOnEveryTab(page: Page): Promise<void> {
  const measure = async (label: string): Promise<void> => {
    const overflow = await pageOverflow(page);
    if (overflow !== 0) {
      expect(
        overflow,
        `${label} — widest offender: ${await widestOffender(page)}`,
      ).toBe(0);
    }
    expect(await widestOffender(page), label).toBe(null);
  };

  await measure("first tab");

  const tabs = page.getByRole("tab");
  const count = await tabs.count();
  for (let index = 1; index < count; index += 1) {
    const tab = tabs.nth(index);
    const label = (await tab.textContent())?.trim() ?? `tab ${index}`;
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await measure(label);
  }
}

test.describe("#1674 admin detail screens at 390px", () => {
  // One test, three screens: the admin bootstrap registers a real account per
  // sign-in and the api rate-limits registration per IP, so a test-per-screen
  // spends three registrations on one identical session. The loop keeps every
  // screen individually named in the failure message instead.
  test("expert / project / partner detail: the header stacks at a phone width, no tab side-scrolls, and the desktop row is unchanged", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(WIDE);
    await signInAsAdmin(page);

    for (const screen of SCREENS) {
      const headerTestId = `${screen.name}-detail-header`;
      await test.step(screen.name, async () => {
        await page.setViewportSize(WIDE);
        const id = await firstRowId(page, screen.list);

        // --- narrow, fixed ------------------------------------------------
        await page.setViewportSize(NARROW);
        await page.goto(`${screen.detail}/${id}`);
        await page.getByTestId(headerTestId).waitFor({ state: "visible" });

        expect(await headerBoxesShareVerticalBand(page, headerTestId)).toBe(
          false,
        );
        await assertNoOverflowOnEveryTab(page);
        if (SHOT_DIR) {
          await page.screenshot({
            path: `${SHOT_DIR}/1674-${screen.name}-after-390.png`,
            fullPage: true,
          });
        }

        // --- narrow, reproducer -------------------------------------------
        // Scope of this leg, precisely: with the shipped-before class string
        // back on the same node the header returns to ONE row at 390px. It is
        // not itself the clip measurement — two `items-center` flex-row
        // children share a band at any width. The regression guard is the fixed
        // leg's `toBe(false)` above; this leg exists so a refactor that stops
        // reproducing the row fails loudly.
        await page.goto(`${screen.detail}/${id}`);
        await page.getByTestId(headerTestId).waitFor({ state: "visible" });
        await restoreBrokenHeader(page, headerTestId);
        expect(await headerBoxesShareVerticalBand(page, headerTestId)).toBe(
          true,
        );
        if (SHOT_DIR) {
          await page.screenshot({
            path: `${SHOT_DIR}/1674-${screen.name}-before-390.png`,
            fullPage: true,
          });
        }

        // --- desktop, unchanged -------------------------------------------
        // The fix only engages where the row no longer fits: past `sm` the
        // header stays one row, badge beside the heading, and nothing scrolls
        // sideways.
        await page.setViewportSize(WIDE);
        await page.goto(`${screen.detail}/${id}`);
        await page.getByTestId(headerTestId).waitFor({ state: "visible" });

        expect(await pageOverflow(page)).toBe(0);
        expect(await headerBoxesShareVerticalBand(page, headerTestId)).toBe(
          true,
        );
        if (SHOT_DIR) {
          await page.screenshot({
            path: `${SHOT_DIR}/1674-${screen.name}-after-desktop.png`,
            fullPage: true,
          });
        }
      });
    }
  });
});
