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
 * #2478 — every unknown address on the doctor storefront renders the
 * not-found state of the platform's one error page, in Russian, inside the
 * storefront shell, HTTP 404 — for a guest and for a signed-in doctor. Events
 * tier: its upstream double answers the shell's session read by cookie.
 */
const PATHS = ["/no-such-page-2478", "/materials/no-such-material-2478"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const viewer of ["guest", "doctor"] as const) {
  for (const width of [1280, 390]) {
    test.describe(`${viewer} at ${width}px`, () => {
      test.use({ viewport: { width, height: 844 } });
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
