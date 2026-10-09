import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { test, expect, type Page } from "@playwright/test";
import { loginAsDoctor, DOCTOR_BASE } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 014 EARS-6 / EARS-9 on doctor.school (#1972, wave-2 entry gate rows 24–27) —
 * the live-stand browser tier of the «Мои события» mount on the DOCTOR host.
 *
 * The page itself is one implementation shared with the Academy
 * (`@ds/events-storefront/my-events`); its rules are pinned in the package unit
 * tiers and the Academy twin `apps/portal/e2e/my-events.spec.ts`. What ONLY a
 * real stand proves here is that the doctor host composes it: the doctor's own
 * `/v1/storefront/doctor/me/events` read admits this origin's session, the two
 * tabs render, every row links this host's own event and room paths, and the
 * `/account` hub row reaches the page.
 *
 * ENV SET — export ALL of these to run this spec (a bare environment stays
 * inert-green, the #1871 gate, `support/live-stand-env.ts`):
 *
 * | variable              | value on the dev stand              |
 * | --------------------- | ----------------------------------- |
 * | `E2E_DOCTOR_URL`      | the running doctor storefront origin |
 * | `E2E_DOCTOR_EMAIL`    | the reused doctor account            |
 * | `E2E_DOCTOR_PASSWORD` | that account password                |
 *
 * 019 EARS-13 (wave-2 gate row 61 — «one obligation per route of each host»):
 * the same tier also runs the route's presentation matrix — the signed-in page
 * on both tabs and the guest's door, at 1440 and 390 px, in both themes: the
 * WCAG 2 A/AA scan (the sibling `a11y-axe.e2e.spec.ts` rule set and its two
 * leaf-scoped shell exclusions), exactly one non-empty `h1`, and no horizontal
 * overflow (the `events-mobile.spec.ts` arm).
 */
requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
]);

test.describe("014 EARS-9 (#1972): «Мои события» on the doctor storefront", () => {
  test("014 EARS-6: a guest on /account/events lands on this host's door carrying the page", async ({
    page,
  }) => {
    await page.goto(DOCTOR_BASE + "/account/events");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Faccount%2Fevents$/);
  });

  test("014 EARS-9: a signed-in doctor sees both tabs, rows on this host's paths, reached from the /account hub", async ({
    page,
  }) => {
    await loginAsDoctor(page);
    await page.goto(DOCTOR_BASE + "/account");
    await page.getByRole("link", { name: /Мои события/ }).click();
    await expect(page).toHaveURL(/\/account\/events$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Мои события" }),
    ).toBeVisible();

    const tabs = page.getByTestId("event-list-tabs").getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toContainText("Предстоящие");
    await expect(tabs.nth(1)).toContainText("Записи");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");

    // Every row links this host's own event (or room) path, never the Academy's.
    const cardLinks = page.locator("[data-webinar-card] a[href]");
    const hrefs = await cardLinks.evaluateAll((links) =>
      links.map((a) => a.getAttribute("href") ?? ""),
    );
    for (const href of hrefs)
      expect(href).toMatch(/^\/events\/[^/]+(\/room)?$/);

    await tabs.nth(1).click();
    await expect(page).toHaveURL(/\/account\/events\?tab=recordings$/);
    await expect(
      page.getByTestId("event-list-tabs").getByRole("tab").nth(1),
    ).toHaveAttribute("aria-selected", "true");
  });
});

const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
] as const;
const THEMES = ["light", "dark"] as const;

/** Apply the theme the way a returning visitor's explicit choice does. */
async function useTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem("ds-theme", value);
  }, theme);
}

async function assertPresentation(page: Page, label: string, dark: boolean) {
  const html = page.locator("html");
  if (dark) await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);

  const h1 = page.locator("h1");
  await expect(h1, `h1 count on ${label}`).toHaveCount(1);
  await expect(h1, `h1 text on ${label}`).not.toHaveText(/^\s*$/);

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(
    overflow,
    `${label} must not overflow horizontally`,
  ).toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page })
    .options({ rules: MAIN_LANDMARK_RULES })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // #2189 / #2180 — the shared shell's two leaf-scoped decorations: the BBM
    // topbar (owner-accepted canvas contrast) and the footer's aria-hidden giant
    // wordmark (its accessible form is the logo image beside it).
    .exclude('[data-testid="shell-topbar"]')
    .exclude('[data-testid="footer-giant"]')
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target).flat(),
  }));
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

test.describe("019 EARS-13: /account/events presentation on the doctor storefront", () => {
  for (const [viewport, size] of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`019 EARS-13: the signed-in page passes WCAG 2 A/AA + one-h1, no overflow, both tabs (${viewport}, ${theme})`, async ({
        page,
      }) => {
        await useTheme(page, theme);
        await page.setViewportSize(size);
        await loginAsDoctor(page);
        for (const [tab, path] of [
          ["upcoming", "/account/events"],
          ["recordings", "/account/events?tab=recordings"],
        ] as const) {
          await page.goto(DOCTOR_BASE + path);
          await expect(
            page.getByRole("heading", { level: 1, name: "Мои события" }),
          ).toBeVisible();
          await expect(
            page
              .getByTestId("event-list-tabs")
              .getByRole("tab")
              .nth(tab === "upcoming" ? 0 : 1),
          ).toHaveAttribute("aria-selected", "true");
          await assertPresentation(
            page,
            `/account/events ${tab} (${viewport}, ${theme})`,
            theme === "dark",
          );
        }
      });

      test(`019 EARS-13: the guest's door from /account/events passes WCAG 2 A/AA + one-h1, no overflow (${viewport}, ${theme})`, async ({
        page,
      }) => {
        await useTheme(page, theme);
        await page.setViewportSize(size);
        await page.goto(DOCTOR_BASE + "/account/events");
        await expect(page).toHaveURL(/\/login\?returnTo=%2Faccount%2Fevents$/);
        await assertPresentation(
          page,
          `guest /account/events → /login (${viewport}, ${theme})`,
          theme === "dark",
        );
      });
    }
  }
});
