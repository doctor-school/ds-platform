import { test, expect, type Page } from "@playwright/test";

import { doorPath } from "./support/sign-in-door";

/**
 * 003 EARS-24 amended (#3172) — «← Изменить почту» on the registration code
 * step returns to the registration form with its entered fields preserved in
 * the same tab, except the password, which is re-typed.
 *
 * On the sign-in host the door hops to its code step by a FULL page load (the
 * host proxy refuses non-top-level requests to a door, EARS-70), so the
 * in-memory hold of the storefront forms does not survive the hop: the typed
 * non-secret fields ride the tab's `sessionStorage` instead, and the password
 * is never written there (003-design «No password is stored anywhere new»).
 */

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";
const PROMO = "PROMO-2026";

/** Tick a consent through its label — the hit area of the checkbox primitive. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

async function fillAndSubmit(page: Page) {
  await page.goto(doorPath("doctor", "register"));
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await page.getByTestId("register-promo").fill(PROMO);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
  await page.getByTestId("register-submit").click();
  await expect(page).toHaveURL(/\/verify\?/);
  await expect(page.getByTestId("verify-back")).toBeVisible();
}

test.describe("003 EARS-24: «← Изменить почту» on the sign-in host", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("003 EARS-24: back from the code step refills the typed fields in the same tab, the password re-typed", async ({
    page,
  }) => {
    await fillAndSubmit(page);

    await page.getByTestId("verify-back").click();

    await expect(page).toHaveURL(/\/register\?/);
    await expect(page.getByTestId("register-email")).toHaveValue(EMAIL);
    await expect(page.getByTestId("register-promo")).toHaveValue(PROMO);
    await expect(page.getByTestId("register-medworker")).toBeChecked();
    await expect(page.getByTestId("register-partner-data")).toBeChecked();
    await expect(page.getByTestId("register-password")).toHaveValue("");
  });

  test("003 EARS-24: the password is never written to the tab's storage", async ({
    page,
  }) => {
    await fillAndSubmit(page);

    const stored = await page.evaluate(() =>
      JSON.stringify({ ...window.sessionStorage, ...window.localStorage }),
    );
    expect(stored).not.toContain(PASSWORD);
  });

  test("003 EARS-24: another tab opens the form empty", async ({
    page,
    context,
  }) => {
    await fillAndSubmit(page);

    const other = await context.newPage();
    await other.goto(doorPath("doctor", "register"));
    await expect(other.getByTestId("register-email")).toHaveValue("");
    await expect(other.getByTestId("register-promo")).toHaveValue("");
  });
});
