import { expect, type Page, type Response } from "@playwright/test";
import { inputSecret } from "./owned-registration.js";
import {
  PHONE_CODE_EVENT,
  captureSmsCheckpoint,
  phoneConfirmationCode,
  waitForSmsCode,
} from "./sms-sink.js";

function post(page: Page, pathname: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === pathname &&
      response.request().method() === "POST",
  );
}

/** 003 EARS-47/48: confirm an owned phone from an authenticated account page. */
export async function confirmOwnedPhone(
  page: Page,
  { phone, sink }: { phone: string; sink: string },
): Promise<void> {
  await page.getByTestId("profile-phone-action").click();
  await page
    .getByTestId("profile-phone-input")
    .pressSequentially(phone.slice(1));
  const before = await captureSmsCheckpoint(sink, phone);
  const requested = post(page, "/v1/me/phone");
  await page.getByTestId("profile-phone-send").click();
  const response = await requested;
  expect(response.status(), "phone code requested").toBe(200);
  expect(await response.json()).toEqual({ status: "code_sent" });
  const code = await waitForSmsCode(
    sink,
    phone,
    before,
    phoneConfirmationCode,
    PHONE_CODE_EVENT,
  );
  const confirmed = post(page, "/v1/me/phone/confirm");
  await inputSecret(page.getByTestId("profile-phone-code"), code);
  expect((await confirmed).status(), "phone confirmed").toBe(200);
  await expect(page.getByTestId("profile-phone-verified")).toBeVisible();
  expect(
    await page.evaluate(async (ownedPhone) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
      });
      const profile = await response.json();
      return {
        status: response.status,
        samePhone: profile.phone === ownedPhone,
        phoneVerified: profile.phoneVerified,
      };
    }, phone),
    "the owned phone is confirmed in the real profile",
  ).toEqual({ status: 200, samePhone: true, phoneVerified: true });
}
