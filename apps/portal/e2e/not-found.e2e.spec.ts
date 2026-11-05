import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import {
  NOT_FOUND_HOME_LABEL,
  SIGNED_IN_COOKIE,
  expectStorefrontNotFound,
  notFoundHeading,
} from "@ds/e2e/not-found-page";
import { expect, test } from "@playwright/test";

/**
 * #2478 — every unknown address on the Academy renders the
 * not-found state of the platform's one error page, in Russian, inside the
 * Academy shell, HTTP 404 — for a guest and for a signed-in doctor. Backend-free
 * tier: `packages/e2e/doubles/storefront-session-api.mjs` answers the shell's
 * session reads by cookie.
 *
 * The file also runs against a live portal (`playwright.config.ts`, a stand
 * slot's `live/academy/default` tier — `E2E_PORTAL_URL` set), where the shell
 * reads the real API: the fake `SIGNED_IN_COOKIE` is no session there, so the
 * signed-in viewer runs only on the backend-free tier, whose session double
 * answers it (#3764). The guest viewer runs on both tiers unchanged.
 */
const LIVE_PORTAL = Boolean(process.env.E2E_PORTAL_URL);
// Addresses no route answers. A known route's own `notFound()` (an unknown
// material or event slug) needs the API's 404 and is driven on a stand slot by
// `packages/e2e` (material-pages, public-event visibility/originals).
const PATHS = ["/no-such-page-2478", "/no-such-section-2478/deeper/page"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const viewer of ["guest", "doctor"] as const) {
  for (const width of [1280, 390]) {
    test.describe(`${viewer} at ${width}px`, () => {
      test.use({ viewport: { width, height: 844 } });
      test.skip(
        viewer === "doctor" && LIVE_PORTAL,
        "the signed-in cookie is answered only by the backend-free tier's session double",
      );
      test.beforeEach(async ({ page }) => {
        if (viewer === "doctor")
          await page.setExtraHTTPHeaders({ cookie: SIGNED_IN_COOKIE });
      });

      for (const path of PATHS) {
        test(`#2478: ${path} is the not-found page inside the shell`, async ({
          page,
        }) => {
          await expectStorefrontNotFound(page, path, viewer);
        });
      }

      test("#2478: the not-found page is WCAG 2 A/AA clean and «На главную» opens the home", async ({
        page,
      }) => {
        await expectStorefrontNotFound(page, PATHS[0]!, viewer);
        const results = await new AxeBuilder({ page })
          .options({ rules: MAIN_LANDMARK_RULES })
          .withTags(WCAG_TAGS)
          // #2189 / #2180 — the same owner-accepted leaf exclusions every
          // storefront axe scan carries (topbar contrast, decorative wordmark).
          .exclude('[data-testid="shell-topbar"]')
          .exclude('[data-testid="footer-giant"]')
          .analyze();
        expect(results.violations).toEqual([]);
        await page
          .getByRole("main")
          .getByRole("link", { name: NOT_FOUND_HOME_LABEL })
          .click();
        await expect(page).toHaveURL((url) => url.pathname === "/");
        await expect(notFoundHeading(page)).toHaveCount(0);
      });
    });
  }
}

// #2478 — the not-found page keeps the visitor's theme: a remembered dark
// choice (`ds-theme`) renders it dark, like every other storefront page.
test("#2478: a remembered dark theme renders the not-found page dark", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("ds-theme", "dark");
  });
  await expectStorefrontNotFound(page, PATHS[0]!, "guest");
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
});

// 006 EARS-12 — with no stored choice the Academy follows the system scheme.
test("#2478: a dark system scheme renders the Academy not-found page dark", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await expectStorefrontNotFound(page, PATHS[0]!, "guest");
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
});
