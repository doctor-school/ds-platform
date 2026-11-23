import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  provisionConfirmedAccount,
  signInPageThroughHost,
} from "@ds/e2e/host-sign-in";
import { confirmOwnedPhone } from "@ds/e2e/owned-phone-confirmation";
import { freshConfirmablePhone, smsSinkUrl } from "@ds/e2e/sms-sink";

import { DOCTOR_BASE } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

requireLiveStandEnv(["E2E_DOCTOR_URL", "MAILPIT_URL", "E2E_SMS_SINK_URL"]);

// The owned account's email and SMS codes must stay out of browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

test("D10: a doctor saves their name and confirms a phone after a wrong code", async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const sink = smsSinkUrl();
  if (!sink) throw new Error("Doctor account proof requires E2E_SMS_SINK_URL");
  const nonce = randomUUID();
  const account = {
    email: `e2e-doctor-profile-${nonce}@example.test`,
    password: `Doc-${nonce}-aA1!`,
  };
  const displayName = "Мария Тестова";

  await provisionConfirmedAccount(browser, "doctor", DOCTOR_BASE, account);
  await signInPageThroughHost(page, DOCTOR_BASE, account);
  await page.goto("/account", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("profile-email-verified")).toBeVisible();

  await page.getByTestId("profile-name-edit").click();
  await page.getByTestId("profile-name-input").fill(displayName);
  const [saved] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/me/display-name" &&
        response.request().method() === "PUT",
    ),
    page.getByTestId("profile-name-save").click(),
  ]);
  expect(saved.status(), "display name saved").toBe(200);
  const name = page.getByTestId("profile-name");
  await expect(name).toHaveText(displayName);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(name).toHaveText(displayName);

  await confirmOwnedPhone(page, {
    phone: freshConfirmablePhone(),
    sink,
    rejectWrongCode: true,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("profile-phone-verified")).toBeVisible();
  await expect(name).toHaveText(displayName);
});
