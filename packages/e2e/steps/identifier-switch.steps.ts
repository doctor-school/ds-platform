import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

import { inputSecret } from "../lib/owned-registration.js";
import { Given, Then, When } from "./support/auth-fixtures.js";

interface MethodSwitch {
  email: string;
  editedEmail: string;
  password: string;
  authCommands: number;
}
const switches = new WeakMap<Page, MethodSwitch>();
const RETURN_TO = "/account";
const PHONE = "+79991234567";
const passwordIdentifier = (page: Page) =>
  page.locator('input[autocomplete="username"]');
const passwordField = (page: Page) =>
  page.locator('input[autocomplete="current-password"]');

function switching(page: Page): MethodSwitch {
  const state = switches.get(page);
  if (!state) throw new Error("Method-switch visitor was not prepared");
  return state;
}

Given(/^a guest on \/login with the «Пароль» method$/, async ({ page, world }) => {
  expect(world.host.id).toBe("academy");
  const id = randomUUID();
  const state: MethodSwitch = {
    email: `method-2713-${id}@example.test`,
    editedEmail: `edited-2713-${id}@example.test`,
    password: `Unsubmitted-${randomUUID()}-aA1!`,
    authCommands: 0,
  };
  switches.set(page, state);
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/v1/auth/")
    ) {
      state.authCommands += 1;
    }
  });
  const link = new URL(world.host.loginPath, world.hostBaseUrl);
  link.searchParams.set("returnTo", RETURN_TO);
  await page.goto(link.toString(), { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("login-method-password")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(passwordIdentifier(page)).toHaveValue("");
  await expect(passwordField(page)).toHaveValue("");
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    ),
    "method-switch visitor starts without a private session",
  ).toBe(false);
});

When(
  "the guest types their email and a password, then switches to «По коду»",
  async ({ page }) => {
    const state = switching(page);
    await passwordIdentifier(page).fill(state.email);
    await inputSecret(passwordField(page), state.password);
    await expect
      .poll(() =>
        passwordField(page).evaluate(
          (input, password) => (input as HTMLInputElement).value === password,
          state.password,
        ),
      )
      .toBe(true);
    await page.getByTestId("login-method-otp").click();
  },
);

Then(
  "the email is already in the code request field and the password is not carried",
  async ({ page }) => {
    await expect(page.getByTestId("login-method-otp")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("otp-identifier")).toHaveValue(
      switching(page).email,
    );
    await expect(page.getByTestId("otp-channel-email")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("otp-identifier")).toHaveAttribute(
      "type",
      "email",
    );
    await expect(passwordField(page)).toHaveCount(0);
  },
);

When(
  "the guest edits the email and switches back to «Пароль»",
  async ({ page }) => {
    await page.getByTestId("otp-identifier").fill(switching(page).editedEmail);
    await page.getByTestId("login-method-password").click();
  },
);

Then("the edited email is in the identifier field", async ({ page }) => {
  await expect(page.getByTestId("login-method-password")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(passwordIdentifier(page)).toHaveValue(
    switching(page).editedEmail,
  );
  await expect(passwordField(page)).toHaveValue("");
});

Then(
  "a typed phone number opens «По коду» on the phone channel where the storefront serves it",
  async ({ page }) => {
    await passwordIdentifier(page).fill(PHONE);
    await page.getByTestId("login-method-otp").click();
    await expect(page.getByTestId("otp-channel-sms")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("otp-identifier")).toHaveValue(PHONE);
    await expect(page.getByTestId("otp-identifier")).toHaveAttribute(
      "type",
      "tel",
    );
    await page.getByTestId("login-method-password").click();
    await expect(passwordIdentifier(page)).toHaveValue(PHONE);
    await expect(passwordField(page)).toHaveValue("");
  },
);

Then(
  "the method switches preserve the account return context without sending credentials or code requests",
  async ({ page, world }) => {
    const url = new URL(page.url());
    expect(url.pathname).toBe(world.host.loginPath);
    expect(url.searchParams.get("returnTo")).toBe(RETURN_TO);
    for (const path of ["/register", "/reset"]) {
      const link = page.locator(`a[href^="${path}"]`);
      await expect(link).toBeVisible();
      const href = await link.getAttribute("href");
      const target = new URL(href ?? "", world.hostBaseUrl);
      expect(target.pathname).toBe(path);
      expect(target.searchParams.get("returnTo")).toBe(RETURN_TO);
    }
    expect(
      switching(page).authCommands,
      "switching issues no auth command",
    ).toBe(0);
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "switching establishes no private session",
    ).toBe(false);
  },
);
