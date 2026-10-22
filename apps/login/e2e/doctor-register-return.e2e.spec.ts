import { test, expect, type Page } from "@playwright/test";

import {
  authRequestId,
  doorPath,
  formPostFields,
  isIdpCallback,
} from "./support/sign-in-door";

/**
 * 021 EARS-10 (#1546, amended 2026-09-17 and 2026-09-29) — the registration
 * journey to the accepted code, on the sign-in host (#3172).
 *
 * The storefront's `/register?returnTo=…` is a 303 entry now: it records the
 * эфир as the auth request's intent (doctor tier, `storefront-entry.spec.ts`),
 * and the door renders here. What this tier proves:
 *   1. the target the doctor carried into the door SURVIVES the hop onto the
 *      host's own `/verify` code step — the same auth request rides it;
 *   2. the accepted code goes to the doctor storefront's own code command on
 *      the host API, once, bound to the auth request, and the host FOLLOWS
 *      the API's success answer to the IdP callback — no outcome card, no
 *      second tap, no sign-in replay;
 *   3. a refused code keeps the doctor on the code step with the generic error.
 *
 * WHERE the confirmed doctor then lands (a live, ended or gone эфир, a direct
 * arrival's LD-4 landing, signed in) is the storefront callback's decision
 * (003 EARS-62, 005 EARS-2), proven by the stand journeys (`packages/e2e`).
 *
 * The host's double (`support/sign-in-entry-api.mjs`) answers the entry, the
 * event read and the host commands — a browser-level interception would let
 * the tier assert its own fixture instead of the journey.
 */

/** The live эфир the double answers for. */
const LIVE = "prp-pri-gonartroze";

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";
/** A code the double accepts — any code but {@link REFUSED_CODE}. */
const CODE = "482913";
/**
 * The code `support/sign-in-entry-api.mjs` answers with the generic 400 of a
 * wrong, expired or used code (003 EARS-16/41).
 */
const REFUSED_CODE = "000000";

/** Tick a consent through its label — the hit area of the checkbox primitive. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

/** Fill the door, submit, reach the code step on the same auth request, type the code. */
async function registerAndConfirm(page: Page, slug: string, code = CODE) {
  await page.goto(doorPath("doctor", "register", { eventTarget: slug }));
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
  await page.getByTestId("register-submit").click();

  await expect(page).toHaveURL(/\/verify\?/);
  const step = new URL(page.url());
  expect(step.searchParams.get("email")).toBe(EMAIL);
  expect(step.searchParams.get("authRequest")).toBe(
    authRequestId("doctor", "register", { eventTarget: slug }),
  );
  await expect(page.getByTestId("verify-submit")).toBeVisible();
  await page.locator('input[autocomplete="one-time-code"]').fill(code);
}

test.describe("021 EARS-10: the accepted code on the sign-in host", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 EARS-10.1: the accepted code is sent once, bound to the carried auth request, and the host follows the API's answer", async ({
    page,
  }) => {
    const verify = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          "/v1/sign-in-host/storefront/doctor/verify",
    );
    await registerAndConfirm(page, LIVE);
    // 003 EARS-39 (host amendment): no in-tab registration value rides with
    // the code — the host's form state holds the warm proof.
    expect((await verify).postDataJSON()).toEqual({
      ...formPostFields("doctor", "register", { eventTarget: LIVE }),
      email: EMAIL,
      code: CODE,
    });

    await page.waitForURL(isIdpCallback);
    await expect(page.getByTestId("registration-success")).toHaveCount(0);
    await expect(page.getByText("Почта подтверждена")).toHaveCount(0);
  });

  test("021 EARS-15: the accepted code is never followed by a sign-in replay", async ({
    page,
  }) => {
    const replays: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/v1/auth/login" || path === "/v1/sign-in-host/login") {
        replays.push(request.url());
      }
    });
    await registerAndConfirm(page, LIVE);
    await page.waitForURL(isIdpCallback);
    expect(replays).toEqual([]);
  });

  test("003 EARS-41/42: a refused code keeps the doctor on the code step with the generic error, no routing", async ({
    page,
  }) => {
    await registerAndConfirm(page, LIVE, REFUSED_CODE);

    await expect(
      page.getByText("Код не подошёл. Проверьте его или запросите новый."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/verify\?/);
    await expect(page.getByTestId("verify-submit")).toBeVisible();
    await expect(page.getByTestId("verify-back")).toBeVisible();
  });
});
