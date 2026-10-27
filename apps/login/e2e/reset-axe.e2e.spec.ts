import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { signInHostApiPath } from "@ds/e2e/sign-in-host-api";
import { test, expect } from "@playwright/test";

/**
 * 003 EARS-11/12 (#2027 PR 1.8, moved to the sign-in host by #3172) — the
 * password-recovery door, both stages, on the sign-in host for each
 * storefront's form. The complete stage (code slots, the new-password field
 * with its reveal toggle, «Начать заново», the resend) is a second
 * composition reachable only by submitting the request stage. Each stage runs
 * at the desktop and the mobile width in both themes: the WCAG 2 A/AA bar in
 * THAT theme, exactly one non-empty `h1`, and no horizontal overflow (the
 * mobile-parity arm). The initiate acknowledgement is identical for every
 * identifier (003 EARS-16), so it is fulfilled at the network edge; the round
 * trip itself is driven live by the stand journeys, not on this tier.
 *
 * The theme is the visitor's explicit choice, which reaches the host as the
 * shared `ds-theme` preference cookie (#3171) — the host renders it
 * server-side.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const storefront of ["academy", "doctor"] as const) {
  for (const stage of ["request", "complete"] as const) {
    for (const [viewport, size] of [
      ["desktop", { width: 1440, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        test(`003 EARS-11/12 the ${storefront} /reset ${stage} stage passes WCAG 2 A/AA + one-h1, no overflow (${viewport}, ${theme})`, async ({
          page,
          context,
          baseURL,
        }) => {
          await context.addCookies([
            { name: "ds-theme", value: theme, url: baseURL! },
          ]);
          await page.setViewportSize(size);
          await page.route(
            `**${signInHostApiPath("/v1/auth/password/reset")}`,
            (route) =>
              route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({}),
              }),
          );
          await page.goto(`/reset?authRequest=${storefront}-reset`);
          await page.getByTestId("reset-request-submit").waitFor();
          if (stage === "complete") {
            await page
              .locator('input[autocomplete="username"]')
              .fill("doc@example.com");
            await page.getByTestId("reset-request-submit").click();
            await expect(
              page.locator('input[autocomplete="new-password"]'),
            ).toBeVisible();
          }
          const html = page.locator("html");
          if (theme === "dark") {
            await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
          } else {
            await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
          }

          const h1 = page.locator("h1");
          await expect(h1, "h1 count on /reset").toHaveCount(1);
          await expect(h1, "h1 text on /reset").not.toHaveText(/^\s*$/);

          const measured = await page.evaluate(() => ({
            scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
            innerWidth: window.innerWidth,
          }));
          expect(
            measured.scrollWidth,
            `document scrollWidth (${measured.scrollWidth}) exceeds the viewport (${measured.innerWidth})`,
          ).toBeLessThanOrEqual(measured.innerWidth);

          const results = await new AxeBuilder({ page })
            .options({ rules: MAIN_LANDMARK_RULES })
            .withTags(WCAG_TAGS)
            .analyze();
          const summary = results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.map((n) => n.target).flat(),
          }));
          expect(
            summary,
            `axe violations on /reset (${stage}, ${viewport}, ${theme})`,
          ).toEqual([]);
        });
      }
    }
  }
}
