import { test, expect, type Page } from "@playwright/test";
import {
  LIVE_STAND,
  submitRegisterAndVerify,
} from "../support/doctor-session";
import {
  isDark,
  shellHeader,
  shellLogo,
  themeToggle,
  DISCOVERY_HREF,
  NAV_BROADCASTS,
} from "../support/shell";

/**
 * 008 EARS-12 / EARS-14 · 017 EARS-1/EARS-12 — the ROUTE-VISIBILITY MATRIX of the
 * academy storefront's shared chrome (`@ds/storefront-shell`, #2180).
 *
 * `lib/shell-config.ts` declares `hiddenOnPaths` = the four auth surfaces plus
 * the starred room pattern; those routes carry their own chrome (`AuthShell`,
 * `room-header`) and a second header would be a duplicate landmark. Everywhere
 * else — including the discovery listing `/webinars` and an event page
 * `/webinars/:slug`, which the STARRED room pattern must NOT swallow — the
 * storefront header AND footer are both present.
 *
 * That last point is the reason this file exists rather than a unit test: the
 * package's `shell.test.tsx` pins the matcher's grammar on synthetic paths, but
 * only a real drive proves the ACADEMY's own patterns hit the academy's own
 * routes. The predecessor of this chrome hid itself with a hand-rolled prefix
 * check, which would have swallowed the listing.
 *
 * Tiering: the guest half needs only a running portal (`E2E_PORTAL_URL`); the
 * room half needs a session (a guest is bounced to `/login`, which would make the
 * absence assertion vacuous), so it rides the LIVE_STAND tier. Both `test.skip`
 * cleanly on a bare CI run.
 */

/** The four auth surfaces the academy config hides its chrome on. */
const AUTH_ROUTES = ["/login", "/register", "/verify", "/reset"] as const;

/** The seeded live room (the 006↔007 fixture seam), env-overridable exactly as
 *  `e2e/steps/room.steps.ts` overrides it, so a differently-seeded stand can
 *  retarget this drive without a code change. */
const SLUG_LIVE = process.env.E2E_ROOM_SLUG_LIVE ?? "seed-005-live";

/** Every chrome landmark the academy mounts, by the PACKAGE's test-ids. */
async function expectChromePresent(page: Page, where: string): Promise<void> {
  await expect(shellHeader(page), `header present on ${where}`).toBeVisible();
  await expect(page.getByTestId("shell-topbar")).toBeVisible();
  await expect(shellLogo(page)).toHaveAttribute("href", DISCOVERY_HREF);
  await expect(
    page.getByTestId("storefront-footer"),
    `footer present on ${where}`,
  ).toBeVisible();
  // 017 EARS-1: exactly ONE of each — no width-duplicated copy in the DOM.
  await expect(page.getByTestId("storefront-header")).toHaveCount(1);
  await expect(page.getByTestId("storefront-footer")).toHaveCount(1);
  await expect(page.getByTestId("theme-toggle")).toHaveCount(1);
}

async function expectChromeAbsent(page: Page, where: string): Promise<void> {
  await expect(
    page.getByTestId("storefront-header"),
    `header absent on ${where}`,
  ).toHaveCount(0);
  await expect(
    page.getByTestId("storefront-footer"),
    `footer absent on ${where}`,
  ).toHaveCount(0);
}

test.describe("008 EARS-12 academy chrome route-visibility matrix (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test("008 EARS-12: the chrome is absent on every auth surface, which carries its own", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    for (const route of AUTH_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      // The route really served itself — an absence assertion after a redirect
      // would prove nothing.
      expect(new URL(page.url()).pathname, `${route} serves itself`).toBe(route);
      await expectChromeAbsent(page, route);
      // …and the surface really rendered its OWN chrome: `AuthShell`'s brand
      // panel stands in place of the storefront header (#237).
      await expect(page.getByTestId("auth-panel-wordmark")).toBeVisible();
    }
  });

  test("008 EARS-12/14: the chrome IS present on the discovery listing and on an event page — the room pattern does not swallow them", async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });
    await expectChromePresent(page, DISCOVERY_HREF);
    // The academy ships no header search (`search: null`) — the package must
    // render no input at all rather than one that submits nowhere.
    await expect(page.getByTestId("shell-search")).toHaveCount(0);
    await expect(
      shellHeader(page)
        .getByTestId("shell-nav-desktop")
        .getByRole("link", { name: NAV_BROADCASTS }),
    ).toHaveAttribute("href", DISCOVERY_HREF);

    // An EVENT page — one segment under the starred room pattern's parent.
    const slugHref = await page
      .locator('main a[href^="/webinars/"]')
      .first()
      .getAttribute("href");
    expect(slugHref, "the listing offers at least one event page").toBeTruthy();
    await page.goto(slugHref!, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe(slugHref);
    await expectChromePresent(page, slugHref!);
  });

  test("008 EARS-14: the footer's document links resolve, and the single cross-link reaches the doctor storefront", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });

    const docs = page.getByTestId("footer-documents").getByRole("link");
    const count = await docs.count();
    expect(count, "the footer ships document links").toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const href = await docs.nth(i).getAttribute("href");
      expect(href, "every footer document link has a target").toBeTruthy();
      // Same-origin documents must actually resolve — an inert link in the
      // persistent chrome is the placeholder affordance AGENTS.md §6 forbids.
      const response = await page.request.get(href!.split("#")[0]!);
      expect(response.status(), `${href} resolves`).toBeLessThan(400);
    }

    // 017 EARS-12: exactly ONE crossing out of this storefront, absolute,
    // pointing at the doctor origin.
    const cross = page.getByTestId("footer-cross").getByRole("link");
    await expect(cross).toHaveCount(1);
    await expect(cross).toHaveAttribute("href", "https://doctor.school/");
  });

  test("008 EARS-3: both themes keep every chrome landmark visible on the listing", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });

    // The portal's dark theme is CLASS-based (`.dark` on `<html>`), so a browser
    // `colorScheme` option is a no-op here — the toggle is the only real driver.
    const toggle = themeToggle(page);
    const before = await isDark(page);
    for (const expectDark of [!before, before]) {
      await toggle.click();
      await expect
        .poll(() => isDark(page), { message: "the toggle flips .dark live" })
        .toBe(expectDark);
      await expectChromePresent(
        page,
        `${DISCOVERY_HREF} (${expectDark ? "dark" : "light"})`,
      );
    }
  });

  test("008 EARS-11: the ≡ disclosure opens and closes at the mobile breakpoint, with the chrome still single", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(DISCOVERY_HREF, { waitUntil: "domcontentloaded" });

    await expectChromePresent(page, `${DISCOVERY_HREF} @375`);
    const menu = shellHeader(page).getByTestId("shell-mobile-menu");
    await expect(page.getByTestId("shell-nav-desktop")).toBeHidden();

    await menu.locator("summary").click();
    await expect(page.getByTestId("shell-nav-mobile")).toBeVisible();
    await menu.locator("summary").click();
    await expect(page.getByTestId("shell-nav-mobile")).toBeHidden();
  });
});

test.describe("008 EARS-12 academy chrome is absent inside the webinar room (e2e)", () => {
  test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

  test("008 EARS-12: `/webinars/:slug/room` carries its own chrome — the storefront header and footer are suppressed", async ({
    page,
  }) => {
    // The room's own 006 EARS-6 gate REDIRECTS anyone who is not a registered
    // doctor of a live event (guest → /login, unregistered → the event page), so
    // an absence assertion on a drive-by visit would be vacuous. Provision a
    // genuinely registered doctor through the real 003+005 flow — the same
    // mechanism `e2e/steps/room.steps.ts` drives — against the seeded live room.
    await page.goto(
      `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG_LIVE}`)}`,
      { waitUntil: "domcontentloaded" },
    );
    await submitRegisterAndVerify(page);
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}(?:$|[?#])`));

    const eventPath = `/webinars/${SLUG_LIVE}`;
    const roomPath = `${eventPath}/room`;
    await page.goto(roomPath, { waitUntil: "domcontentloaded" });
    // The gate admitted us: the room really served itself at this path.
    expect(new URL(page.url()).pathname, "the room serves itself").toBe(roomPath);
    await expectChromeAbsent(page, roomPath);
    // Its OWN chrome is what the doctor sees instead (006 `room-header`).
    await expect(page.getByTestId("room-header")).toBeVisible();

    // …and its SIBLING event page keeps the chrome, proving the starred pattern
    // is segment-wise rather than a prefix match that would swallow the listing.
    await page.goto(eventPath, { waitUntil: "domcontentloaded" });
    await expectChromePresent(page, eventPath);
  });
});
