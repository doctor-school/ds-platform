import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * #1399 — the admin `/events/[id]` edit screen at a phone width (390px).
 *
 * The list surfaces were fixed in #1222/#1387, but the DETAIL page kept the
 * original `flex items-center justify-between` header row: the event title block
 * and the lifecycle state badge stayed on ONE line at every width, so at 390px a
 * realistic (long) event title and the badge competed for the same line and the
 * header clipped. The fix is the pattern the owner already approved for the same
 * admin surface in #1387 — stack below `sm`, restore the three original
 * utilities verbatim from `sm` up.
 *
 * The assertions are measured geometry, not class strings: a class assertion
 * would pass on any string edit and prove nothing about the render. "The title
 * block and the badge do not share a vertical band" IS "the header stacked", and
 * page `scrollWidth === clientWidth` IS "the screen is not a side-scroller".
 *
 * The reproducer half matters as much as the fix half. `restoreBrokenHeader()`
 * puts the ORIGINAL class string back on the live node and re-measures, so the
 * spec demonstrates the bug it guards: if a future refactor makes the defect
 * unreproducible, that assertion fails loudly and this spec gets rewritten
 * rather than silently guarding nothing.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (a MANUAL gate, not CI): the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws if the `IDP_*` env is absent. Run against a booted admin app + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/event-detail-narrow.spec.ts
 *
 * `E2E_SHOT_DIR` opts into the before/after screenshot pair the PR body cites;
 * unset, the spec still asserts — the images are evidence for a human, not the
 * gate.
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";
const SHOT_DIR = process.env.E2E_SHOT_DIR;

/** The phone width the 011 Stage-B screenshot was taken at. */
const NARROW = { width: 390, height: 844 };
/** A width comfortably past the `sm` breakpoint, to prove the desktop row is untouched. */
const WIDE = { width: 1440, height: 900 };

/** The exact class string that shipped before this fix — the reproducer's input. */
const BROKEN_DETAIL_HEADER_CLASS = "flex items-center justify-between";

async function loginAsAdmin(page: Page): Promise<void> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2500);
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByTestId("login-submit").click();
    try {
      await page.waitForURL(/\/mfa\/enroll/, { timeout: 8000 });
    } catch {
      /* the platform_admin role projection lags the grant — retry */
      continue;
    }
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    await page
      .getByTestId("mfa-enroll-form")
      .getByRole("textbox")
      .fill(totpCode(secret));
    await page.waitForURL(/\/events/, { timeout: 20_000 });
    return;
  }
  throw new Error("admin login did not reach /events");
}

/**
 * The detail screen needs a real event to render, so the subject is an existing
 * row when the stand has one and a freshly created event otherwise — the shared
 * dev database is not this spec's to grow one event per invocation. A realistic
 * title (an event name carries a school and a topic) is what makes the header
 * exceed 390px in the first place, so a picked row is as good a subject as a
 * seeded one only when it, too, is realistically long — hence the create path
 * uses the same title as the list spec.
 *
 * Returns the event id the detail assertions run against.
 */
async function eventDetailId(page: Page): Promise<string> {
  await page.goto("/events");
  await page
    .getByTestId("events-table")
    .or(page.getByTestId("events-empty"))
    .first()
    .waitFor({ state: "visible" });

  if (await page.getByTestId("events-table").isVisible()) {
    const testId = await page
      .locator('[data-testid^="event-row-"]')
      .first()
      .getAttribute("data-testid");
    if (!testId) throw new Error("events table rendered without a row test id");
    return testId.replace("event-row-", "");
  }

  await page.goto("/events/create");
  await page.locator("#title").fill("Ведение пациентов с ХСН: разбор случаев");
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill("2026-09-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** Page-level horizontal overflow in px. Must be 0: the page is not a side-scroller. */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

/** Do the title block and the state badge share any vertical band? */
async function headerBoxesShareVerticalBand(page: Page): Promise<boolean> {
  const header = page.getByTestId("event-detail-header");
  const titleBlock = await header.locator("> div").first().boundingBox();
  const badge = await header.locator("> :last-child").boundingBox();
  if (!titleBlock || !badge) throw new Error("header boxes not measurable");
  return (
    badge.y < titleBlock.y + titleBlock.height &&
    titleBlock.y < badge.y + badge.height
  );
}

/** Put the pre-fix class string back on the live node, to re-measure the defect. */
async function restoreBrokenHeader(page: Page): Promise<void> {
  await page
    .getByTestId("event-detail-header")
    .evaluate(
      (header, cls) => header.setAttribute("class", cls),
      BROKEN_DETAIL_HEADER_CLASS,
    );
}

test.describe("#1399 admin /events/[id] at 390px", () => {
  test("the header stacks at a phone width, the page does not side-scroll, and the desktop row is unchanged", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await loginAsAdmin(page);
    const id = await eventDetailId(page);

    // --- narrow, fixed ------------------------------------------------------
    await page.setViewportSize(NARROW);
    await page.goto(`/events/${id}`);
    await page.getByTestId("event-detail-header").waitFor({ state: "visible" });

    expect(await pageOverflow(page)).toBe(0);
    expect(await headerBoxesShareVerticalBand(page)).toBe(false);
    if (SHOT_DIR) {
      await page.screenshot({
        path: `${SHOT_DIR}/1399-after-390.png`,
        fullPage: true,
      });
    }

    // --- narrow, reproducer -------------------------------------------------
    // Scope of this leg, precisely: with the shipped-before class string back on
    // the same node the header returns to ONE row at 390px. It is not itself the
    // clip measurement — two `items-center` flex-row children share a band at any
    // width. The regression guard is the fixed leg's `toBe(false)` above; this
    // leg exists so a refactor that stops reproducing the row fails loudly.
    await restoreBrokenHeader(page);
    expect(await headerBoxesShareVerticalBand(page)).toBe(true);
    if (SHOT_DIR) {
      await page.screenshot({
        path: `${SHOT_DIR}/1399-before-390.png`,
        fullPage: true,
      });
    }

    // --- desktop, unchanged -------------------------------------------------
    // The fix only engages where the row no longer fits: past `sm` the header
    // stays one row, badge beside the title, and nothing scrolls sideways.
    await page.setViewportSize(WIDE);
    await page.goto(`/events/${id}`);
    await page.getByTestId("event-detail-header").waitFor({ state: "visible" });

    expect(await pageOverflow(page)).toBe(0);
    expect(await headerBoxesShareVerticalBand(page)).toBe(true);
    if (SHOT_DIR) {
      await page.screenshot({
        path: `${SHOT_DIR}/1399-after-desktop.png`,
        fullPage: true,
      });
    }
  });
});
