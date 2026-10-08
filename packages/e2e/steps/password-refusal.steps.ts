import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";

import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registrationUrl,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface RefusedRegistration extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  registrationRequests: number;
  landing: string | null;
}
const registrations = new WeakMap<Page, RefusedRegistration>();
const SHORT_PASSWORD = "sapling";
const CORRECTED_PASSWORD = "saplings";
const RETURN_TO = "/account";
const LENGTH_ERROR = "Не менее 8 символов.";
const passwordField = (page: Page) => page.getByTestId("register-password");

function registration(key: Page): RefusedRegistration {
  const state = registrations.get(key);
  if (!state)
    throw new Error("Owned short-password registrant was not prepared");
  return state;
}

async function expectSameContext(state: RefusedRegistration, base: string) {
  const url = new URL(state.page.url());
  expect(url.origin).toBe(new URL(base).origin);
  expect(url.pathname).toBe("/register");
  expect(url.searchParams.get("returnTo")).toBe(RETURN_TO);
  expect(
    (await state.page.getByTestId("register-email").inputValue()) ===
      state.email,
    "the exact owned address remains in the same form",
  ).toBe(true);
  expect(
    (await passwordField(state.page).inputValue()) === state.password,
    "the entered password remains in the same field",
  ).toBe(true);
  expect(
    await state.page
      .getByTestId("registration-form")
      .getAttribute("data-registration-landing"),
  ).toBe(state.landing);
}

async function expectLengthRefusal(state: RefusedRegistration) {
  const field = passwordField(state.page);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const messageId = ((await field.getAttribute("aria-describedby")) ?? "")
    .trim()
    .split(/\s+/)
    .pop();
  expect(Boolean(messageId), "invalid password owns its error message").toBe(
    true,
  );
  const message = state.page.locator(`[id="${messageId}"]`);
  await expect(message).toHaveAttribute("role", "alert");
  await expect
    .poll(
      async () => (await message.ariaSnapshot()) === `- alert: ${LENGTH_ERROR}`,
    )
    .toBe(true);
  await expect(
    state.page.getByTestId("registration-form").getByRole("alert"),
  ).toHaveCount(1);
  await expect(state.page.getByTestId("register-email")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(state.page.getByTestId("register-command-error")).toHaveCount(0);
  await expect(state.page.getByTestId("register-captcha-error")).toHaveCount(0);
}

Given(
  "an Academy short-password registrant with a unique never-registered email and the account return target",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: RefusedRegistration = {
      context,
      page: owned,
      email: `register-2728-${randomUUID()}@example.test`,
      password: SHORT_PASSWORD,
      registrationRequests: 0,
      landing: null,
    };
    registrations.set(page, state);
    owned.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/auth/register"
      ) {
        state.registrationRequests += 1;
      }
    });
    await installCaptchaStub(context);
    await owned.goto(registrationUrl(world.hostBaseUrl, RETURN_TO), {
      waitUntil: "load",
    });
    await owned.waitForLoadState("networkidle");
    state.landing = await owned
      .getByTestId("registration-form")
      .getAttribute("data-registration-landing");
    expect(
      Boolean(state.landing),
      "registration has its configured landing",
    ).toBe(true);
    await expect(
      owned.getByText(/^Продолжая, вы соглашаетесь с условиями использования/),
    ).toBeVisible();
    await inputSecret(owned.getByTestId("register-email"), state.email);
    await assertNoPrivateRegistrationAccess(owned, "", state);
  },
);

When(
  "that registrant enters seven lowercase letters, blurs the password and attempts the normal registration submit",
  async ({ page }) => {
    const state = registration(page);
    expect(state.password.length, "seven-character refusal boundary").toBe(7);
    const field = passwordField(state.page);
    await inputSecret(field, state.password);
    await field.focus();
    await field.blur();
    await expectLengthRefusal(state);
    await state.page.getByTestId("register-submit").click();
    await expectLengthRefusal(state);
    await state.page.waitForLoadState("networkidle");
  },
);

Then(
  "only the minimum-length rule rejects that password without any registration POST or private access",
  async ({ page, world }) => {
    const state = registration(page);
    await expectLengthRefusal(state);
    await expectSameContext(state, world.hostBaseUrl);
    expect(
      state.registrationRequests,
      "no registration reaches the BFF or IdP",
    ).toBe(0);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
  },
);

When(
  "that registrant corrects the same password field to eight lowercase letters without submitting",
  async ({ page }) => {
    const state = registration(page);
    state.password = CORRECTED_PASSWORD;
    expect(
      state.password.length,
      "exact eight-character correction boundary",
    ).toBe(8);
    await inputSecret(passwordField(state.page), state.password);
    await passwordField(state.page).focus();
    await passwordField(state.page).blur();
  },
);

Then(
  "the length error clears and normal submission is available with the same address and registration context and no account created",
  async ({ page, world }) => {
    const state = registration(page);
    await expect(passwordField(state.page)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(
      state.page.getByTestId("registration-form").getByRole("alert"),
    ).toHaveCount(0);
    await expect(state.page.getByTestId("register-submit")).toBeEnabled();
    await expectSameContext(state, world.hostBaseUrl);
    await state.page.waitForLoadState("networkidle");
    expect(
      state.registrationRequests,
      "no account-creation command was sent",
    ).toBe(0);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
  },
);

After("@password-refusal", async ({ page }) => {
  const state = registrations.get(page);
  if (!state) return;
  try {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
  } finally {
    await state.context.close();
    registrations.delete(page);
  }
});
