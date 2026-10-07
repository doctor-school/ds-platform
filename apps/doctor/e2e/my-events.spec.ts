import { test, expect } from "@playwright/test";
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
