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
  {
    phone,
    sink,
    rejectWrongCode = false,
  }: { phone: string; sink: string; rejectWrongCode?: boolean },
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
  const requestedBody = await response.json().catch(() => null);
  expect(
    requestedBody?.status === "code_sent" &&
      Object.keys(requestedBody).length === 1,
    "code sent",
  ).toBe(true);
  const code = await waitForSmsCode(
    sink,
    phone,
    before,
    phoneConfirmationCode,
    PHONE_CODE_EVENT,
  );
  const field = page.getByTestId("profile-phone-code");
  if (rejectWrongCode) {
    const refused = post(page, "/v1/me/phone/confirm");
    const wrong = `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;
    await inputSecret(field, wrong);
    expect((await refused).status(), "wrong phone code refused").toBe(400);
    await expect(page.locator("#profile-phone-code-error")).toHaveText(
      /^⚠?\s*Неверный код$/,
    );
    await expect(page.getByTestId("profile-phone-verified")).toHaveCount(0);
    await field.press("ControlOrMeta+A");
    await field.press("Backspace");
    await expect(field).toHaveValue("");
  }

  const confirmed = post(page, "/v1/me/phone/confirm");
  await inputSecret(field, code);
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
