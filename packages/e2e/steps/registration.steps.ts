import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  registerOwnedCredentials,
  registrationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface Registration extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  response?: Response;
  code?: string;
}
const registrations = new WeakMap<Page, Registration>();
function registration(key: Page): Registration {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned registration was not prepared");
  return state;
}

Given(
  "an Academy visitor with a unique never-registered email",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    registrations.set(page, {
      context,
      page: owned,
      email: `register-2673-${randomUUID()}@example.test`,
      password: `Register-${randomUUID()}-aA1!`,
    });
    await installCaptchaStub(context);
  },
);

When(
  "the visitor submits the Academy registration form with a policy-conforming password and accepted consent versions",
  async ({ page, world }) => {
    const state = registration(page);
    Object.assign(
      state,
      await registerOwnedCredentials(state.page, world.hostBaseUrl, state),
    );
  },
);

Then(
  "registration acknowledges pending verification with the configured per-purpose consent versions",
  async ({ page }) => {
    const state = registration(page);
    const response = state.response!;
    expect(response.status()).toBe(200);
    expect(
      registrationEvidence(
        response.request().postData() ?? "",
        await response.text(),
        state,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
  },
);

Then(
  "the Academy code step has a fresh delivered confirmation code that remains unconsumed",
  async ({ page, world }) => {
    const state = registration(page);
    const url = new URL(state.page.url());
    expect(url.origin).toBe(new URL(world.hostBaseUrl).origin);
    expect(url.pathname).toBe("/verify");
    expect(
      url.searchParams.get("email") === state.email,
      "code step keeps the submitted address",
    ).toBe(true);
    expect(
      /^\d{6}$/.test(state.code ?? ""),
      "fresh addressed six-digit registration code delivered",
    ).toBe(true);
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(field).toBeVisible();
    expect(
      (await field.inputValue()) === "",
      "confirmation code remains unentered",
    ).toBe(true);
  },
);

Then(
  "registration exposes no password or tokens and grants no private session or profile access",
  async ({ page }) => {
    const state = registration(page);
    const sessionName = "__Host-ds_session";
    const header = (await state.response!.headerValue("set-cookie")) ?? "";
    expect(
      header.includes(`${sessionName}=`),
      "registration minted no private session",
    ).toBe(false);
    const cookies = await state.context.cookies();
    expect(
      cookies.some((cookie) => cookie.name === sessionName),
      "browser has no private session",
    ).toBe(false);
    expect(
      cookies.some((cookie) => cookie.value.includes(state.password)),
      "cookies contain no registration password",
    ).toBe(false);
    const exposed = await state.page.evaluate((password) => {
      const readable = JSON.stringify({
        url: location.href,
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      return (
        readable.includes(password) ||
        readable.includes(encodeURIComponent(password)) ||
        /__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
          readable,
        )
      );
    }, state.password);
    expect(
      exposed,
      "URL and JavaScript-readable stores expose no password or tokens",
    ).toBe(false);
    expect(
      await state.page.evaluate(
        async () =>
          (await fetch("/v1/me/profile", { credentials: "include" })).status,
      ),
      "unconfirmed registration cannot read a private profile",
    ).toBe(401);
  },
);

After("@registration-before-confirmation", async ({ page }) => {
  const state = registrations.get(page);
  if (!state) return;
  try {
    // Close pages first so failure-context snapshots cannot retain credentials.
    await Promise.all(state.context.pages().map((owned) => owned.close()));
    await state.context.close();
  } finally {
    registrations.delete(page);
  }
});
