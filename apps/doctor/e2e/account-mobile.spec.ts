import { expect, test } from "@playwright/test";
import { DOCTOR_BASE, loginAsDoctor } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * Wave-4 gate row 19 (#2073) — the doctor storefront's signed-in `/account`, now
 * the `@ds/account` cabinet, at the 390 px phone width: the profile card is
 * visible and the page does not scroll sideways. The Academy's twin check sits
 * beside its 390 px «Мои события» check in
 * `apps/portal/e2e/a11y/a11y-axe.e2e.spec.ts`.
 *
 * ENV SET / STAND: identical to `my-events.spec.ts` (the reused doctor account;
 * `playwright.event-register.config.ts`). Bare CI → inert green.
 */
requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
]);

test("003 EARS-28: the doctor /account card is visible at 390 px with no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsDoctor(page);
  await page.goto(DOCTOR_BASE + "/account", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("profile-email")).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "/account must not overflow at 390 px").toBeLessThanOrEqual(
    1,
  );
});
