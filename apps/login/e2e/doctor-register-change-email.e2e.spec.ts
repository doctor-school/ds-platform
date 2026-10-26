import { test, expect, type Page, type Request } from "@playwright/test";

import {
  doorPath,
  formPostFields,
  fulfillHostRedirect,
  hostRoute,
  isIdpCallback,
} from "./support/sign-in-door";

/**
 * 003 EARS-24 amended (#3172) — on the sign-in host the registration code
 * step renders IN PLACE on the register door's document: no navigation (the
 * host proxy refuses a non-top-level request to a door, EARS-70), so the
 * typed values stay in this tab's memory. They ride with the code (EARS-41,
 * the EARS-23 re-registration applies them), and «← Изменить почту» returns
 * to the form with every entered field, the password included. The step takes
 * its own same-document history entry on `/verify?email=…`, so browser Back
 * (like «← Изменить почту») returns to the filled form on `/register`; nothing
 * is written to browser storage.
 */

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";
const PROMO = "PROMO-2026";
const CONFIRM_ROUTE = hostRoute("/v1/storefront/doctor/verify");

/** Tick a consent through its label — the hit area of the checkbox primitive. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

/** A mark on the current document: it survives only while no page load happens. */
async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
  });
}

async function isSameDocument(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as unknown as { __sameDocument?: boolean }).__sameDocument ===
      true,
  );
}

async function fillAndSubmit(page: Page) {
  await page.goto(doorPath("doctor", "register"));
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await page.getByTestId("register-promo").fill(PROMO);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
  await markDocument(page);
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("verify-back")).toBeVisible();
}

function body(request: Request): Record<string, unknown> {
  return JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
}

test.describe("003 EARS-24: the in-place code step on the sign-in host", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("003 EARS-24: the code step renders on the door's own document and takes its own history entry on /verify", async ({
    page,
  }) => {
    await page.goto(doorPath("doctor", "register"));
    const depth = await page.evaluate(() => window.history.length);
    await fillAndSubmit(page);

    expect(await isSameDocument(page)).toBe(true);
    const settled = new URL(page.url());
    expect(settled.pathname).toBe("/verify");
    expect(settled.searchParams.get("email")).toBe(EMAIL);
    expect(settled.searchParams.get("authRequest")).toBe(
      formPostFields("doctor", "register").authRequest,
    );
    expect(await page.evaluate(() => window.history.length)).toBe(depth + 1);
    await expect(page.getByTestId("verify-card")).toContainText(EMAIL);
  });

  test("003 EARS-24: back from the code step keeps every typed field, the password included", async ({
    page,
  }) => {
    await fillAndSubmit(page);
    const depth = await page.evaluate(() => window.history.length);

    await page.getByTestId("verify-back").click();

    await expect(page.getByTestId("register-email")).toHaveValue(EMAIL);
    await expect(page.getByTestId("register-password")).toHaveValue(PASSWORD);
    await expect(page.getByTestId("register-promo")).toHaveValue(PROMO);
    await expect(page.getByTestId("register-medworker")).toBeChecked();
    await expect(page.getByTestId("register-partner-data")).toBeChecked();
    expect(await isSameDocument(page)).toBe(true);
    expect(new URL(page.url()).pathname).toBe("/register");
    expect(await page.evaluate(() => window.history.length)).toBe(depth);
  });

  test("003 EARS-23 / EARS-41: the code is posted WITH the password and consents typed on this document", async ({
    page,
  }) => {
    await page.route(CONFIRM_ROUTE, fulfillHostRedirect);
    await fillAndSubmit(page);

    const [request] = await Promise.all([
      page.waitForRequest(CONFIRM_ROUTE),
      page.locator('input[autocomplete="one-time-code"]').fill("482913"),
    ]);

    const sent = body(request);
    expect(sent).toMatchObject({
      ...formPostFields("doctor", "register"),
      email: EMAIL,
      code: "482913",
      registration: { password: PASSWORD, medicalWorkerDeclaration: true },
    });
    const consent = (sent.registration as { consent: { purpose: string }[] })
      .consent;
    expect(consent.length).toBeGreaterThan(0);
    await page.waitForURL(isIdpCallback);
  });

  test("003 EARS-24: nothing is written to the tab's storage", async ({
    page,
  }) => {
    await fillAndSubmit(page);
    await page.getByTestId("verify-back").click();
    await expect(page.getByTestId("register-email")).toHaveValue(EMAIL);

    const stored = await page.evaluate(() => ({
      session: window.sessionStorage.length,
      local: window.localStorage.length,
    }));
    expect(stored).toEqual({ session: 0, local: 0 });
  });

  test("003 EARS-24 / EARS-39: a reload of the code step enters the host's /verify step naming the address; its Back opens the form empty", async ({
    page,
  }) => {
    await fillAndSubmit(page);

    await page.reload();

    await expect(page.getByTestId("verify-card")).toContainText(EMAIL);
    expect(await isSameDocument(page)).toBe(false);
    await page.getByTestId("verify-back").click();
    await expect(page.getByTestId("register-submit")).toBeVisible();
    await expect(page.getByTestId("register-email")).toHaveValue("");
    await expect(page.getByTestId("register-password")).toHaveValue("");
  });

  test("003 EARS-24: a fresh open of the door in the same tab after an abandoned submit is empty", async ({
    page,
  }) => {
    await fillAndSubmit(page);

    // The visitor abandons the code step and opens the door anew.
    await page.goto(doorPath("doctor", "register"));

    await expect(page.getByTestId("register-submit")).toBeVisible();
    await expect(page.getByTestId("register-email")).toHaveValue("");
    await expect(page.getByTestId("register-password")).toHaveValue("");
    await expect(page.getByTestId("register-promo")).toHaveValue("");
    await expect(page.getByTestId("register-medworker")).not.toBeChecked();
    await expect(page.getByTestId("register-partner-data")).not.toBeChecked();
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
