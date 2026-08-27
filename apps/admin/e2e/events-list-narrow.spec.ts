import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * #1222 — the admin `/events` list at a phone width (390px).
 *
 * Two independent layout faults on one screen; either alone leaves the operator
 * unable to work the list on a phone.
 *
 * 1. **The page scrolled sideways, so the table could not.** The admin chrome row
 *    (brand + three nav links + sign-out) never wrapped, measuring ~503px, which
 *    overflowed a 390px viewport by 113px. Two consequences: «Выйти» was cut off
 *    at the right edge, and a horizontal swipe panned the WHOLE PAGE rather than
 *    the events table — so the table's own `overflow-x-auto` wrapper, which was
 *    already scrollable, was in practice unreachable and «Дата» / «Статус» /
 *    «Действия» read as clipped. Removing the page-level overflow is what hands
 *    the table its scroll back; the table markup itself needed no change.
 * 2. **Header overlap.** `flex items-center justify-between` kept the heading
 *    block and the «Создать мероприятие» button on ONE row at every width, so at
 *    390px the button rode over the list description text.
 *
 * The assertions are measured geometry, not class strings: a class assertion
 * would pass on any string edit and prove nothing about the render. "The page has
 * no horizontal overflow while the table wrapper does" IS "a swipe reaches the
 * trailing columns", and two non-intersecting boxes IS "nothing overlaps".
 *
 * The reproducer half matters as much as the fix half. `restoreBrokenLayout()`
 * puts the ORIGINAL class strings back on the live nodes and re-measures, so the
 * spec demonstrates the bug it guards: if a future refactor makes the defect
 * unreproducible, that assertion fails loudly and this spec gets rewritten rather
 * than silently guarding nothing.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (a MANUAL gate, not CI): the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws if the `IDP_*` env is absent. Run against a booted admin app + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/events-list-narrow.spec.ts
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

/** The exact class strings that shipped before this fix — the reproducer's input. */
const BROKEN_SHELL_ROW_CLASS =
  "mx-auto flex max-w-5xl items-center justify-between px-6 py-4";
/**
 * The brand + nav group is where the width actually came from: unwrapped it is a
 * ~360px block that, with the sign-out button beside it, pushed the row past 390.
 * Restoring the outer row alone does NOT reproduce the defect — the inner group
 * has to come back too, which is precisely why the fix wraps both.
 */
const BROKEN_SHELL_GROUP_CLASS = "flex items-center gap-8";
const BROKEN_LIST_HEADER_CLASS = "mb-6 flex items-center justify-between";

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
 * The list must have at least one row for the table to render at all — the empty
 * state is a paragraph, and a paragraph cannot clip a column. Seeding is
 * conditional so a repeat run against a populated stand adds nothing: the shared
 * dev database is not this spec's to grow one event per invocation. A realistic
 * title (an event name carries a school and a direction) is what makes the five
 * columns exceed 390px in the first place.
 */
async function seedEventIfListEmpty(page: Page): Promise<void> {
  await page.goto("/events");
  await page
    .getByTestId("events-table")
    .or(page.getByTestId("events-empty"))
    .first()
    .waitFor({ state: "visible" });
  if (await page.getByTestId("events-table").isVisible()) return;

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
}

/** Page-level horizontal overflow in px. Must be 0: the page is not a side-scroller. */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

/** Table-wrapper horizontal overflow in px. > 0 at 390px means the columns are swipe-reachable. */
async function tableOverflow(page: Page): Promise<number> {
  return page
    .getByTestId("events-table")
    .evaluate(
      (table) =>
        table.parentElement!.scrollWidth - table.parentElement!.clientWidth,
    );
}

/** Do the heading block and the create button share any vertical band? */
async function headerBoxesShareVerticalBand(page: Page): Promise<boolean> {
  const description = await page
    .getByTestId("create-event")
    .locator("xpath=../div/p")
    .boundingBox();
  const button = await page.getByTestId("create-event").boundingBox();
  if (!description || !button) throw new Error("header boxes not measurable");
  return (
    button.y < description.y + description.height &&
    description.y < button.y + button.height
  );
}

/** Put the pre-fix class strings back on the live nodes, to re-measure the defect. */
async function restoreBrokenLayout(page: Page): Promise<void> {
  await page.getByTestId("sign-out").evaluate((signOut, cls) => {
    // The sign-out button is a direct child of the chrome row.
    signOut.closest("div")!.setAttribute("class", cls);
  }, BROKEN_SHELL_ROW_CLASS);
  await page.getByTestId("nav-events").evaluate((navLink, cls) => {
    // <a> → <nav> → the brand+nav group div.
    navLink.closest("nav")!.parentElement!.setAttribute("class", cls);
  }, BROKEN_SHELL_GROUP_CLASS);
  await page.getByTestId("create-event").evaluate((createLink, cls) => {
    // The DS Button renders its `asChild` link, so this node is the <a> and its
    // nearest <div> ancestor IS the list header row.
    createLink.closest("div")!.setAttribute("class", cls);
  }, BROKEN_LIST_HEADER_CLASS);
}

test.describe("#1222 admin /events at 390px", () => {
  test("the page does not side-scroll, the table does, and the create button clears the description", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await loginAsAdmin(page);
    await seedEventIfListEmpty(page);

    // --- narrow, fixed ------------------------------------------------------
    await page.setViewportSize(NARROW);
    await page.goto("/events");
    await page.getByTestId("events-table").waitFor({ state: "visible" });

    expect(await pageOverflow(page)).toBe(0);
    expect(await tableOverflow(page)).toBeGreaterThan(0);
    expect(await headerBoxesShareVerticalBand(page)).toBe(false);
    if (SHOT_DIR) {
      await page.screenshot({
        path: `${SHOT_DIR}/1222-after-390.png`,
        fullPage: true,
      });
    }

    // --- narrow, reproducer -------------------------------------------------
    // Prove the guarded defect is real: with the shipped-before class strings
    // back on the same nodes, the page side-scrolls and the button rides over
    // the description.
    await restoreBrokenLayout(page);
    expect(await pageOverflow(page)).toBeGreaterThan(0);
    expect(await headerBoxesShareVerticalBand(page)).toBe(true);
    if (SHOT_DIR) {
      await page.screenshot({
        path: `${SHOT_DIR}/1222-before-390.png`,
        fullPage: true,
      });
    }

    // --- desktop, unchanged -------------------------------------------------
    // The fix only engages where the row no longer fits: past `sm` the chrome and
    // the list header stay single rows and nothing scrolls sideways.
    await page.setViewportSize(WIDE);
    await page.goto("/events");
    await page.getByTestId("events-table").waitFor({ state: "visible" });

    expect(await pageOverflow(page)).toBe(0);
    // No desktop table-overflow assert: the wrapper scrollWidth at 1440px is
    // data-dependent (one long operator-authored «Название» on the shared stand
    // flips it with no layout regression behind it). The page-level
    // `pageOverflow === 0` above already carries the desktop-unchanged claim.
    expect(await headerBoxesShareVerticalBand(page)).toBe(true);
    if (SHOT_DIR) {
      await page.screenshot({
        path: `${SHOT_DIR}/1222-after-desktop.png`,
        fullPage: true,
      });
    }
  });
});
