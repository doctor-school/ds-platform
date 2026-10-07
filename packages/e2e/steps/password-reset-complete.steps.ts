import { randomUUID } from "node:crypto";
import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import { fetchRecoveryCode, mailpitUrlFor } from "../lib/mailpit.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface Recovery {
  email: string;
  oldPassword: string;
  newPassword: string;
  contexts: BrowserContext[];
  prior: Page[];
  priorCookies: string[];
  recovered?: Page;
  completion?: Response;
  httpCredentials: BrowserContextOptions["httpCredentials"];
}
const recoveries = new WeakMap<Page, Recovery>();
function recovery(key: Page): Recovery {
  const state = recoveries.get(key);
  if (!state) throw new Error("Owned reset account was not prepared");
  return state;
}
async function privatePage(browser: Browser, state: Recovery): Promise<Page> {
  const context = await browser.newContext({
    locale: "ru-RU",
    ...(state.httpCredentials
      ? { httpCredentials: state.httpCredentials }
      : {}),
  });
  state.contexts.push(context);
  await installCaptchaStub(context);
  return context.newPage();
}
async function input(locator: Locator, value: string): Promise<void> {
  await locator.waitFor({ state: "visible" });
  // evaluate keeps secret values out of Playwright fill() timeout call logs.
  await locator.evaluate((element, text) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}
function post(page: Page, pathname: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === pathname &&
      response.request().method() === "POST",
  );
}
async function ownProfile(page: Page, email: string): Promise<void> {
  const result = await page.evaluate(async (expected) => {
    const response = await fetch("/v1/me/profile", { credentials: "include" });
    const body = await response.json();
    return { status: response.status, sameAccount: body.email === expected };
  }, email);
  expect(result).toEqual({ status: 200, sameAccount: true });
}
async function passwordSignIn(
  page: Page,
  base: string,
  email: string,
  password: string,
): Promise<Response> {
  await open(page, `${base}/login?returnTo=%2Faccount`);
  await input(page.locator('input[autocomplete="username"]'), email);
  await input(page.locator('input[autocomplete="current-password"]'), password);
  const pending = post(page, "/v1/auth/login");
  await page.getByTestId("password-login-submit").click();
  return pending;
}
async function cookieValue(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find(
    (value) => value.name === SESSION,
  );
  expect(Boolean(cookie?.value), "private cookie exists").toBe(true);
  return cookie!.value;
}

Given(
  "a uniquely registered Academy account has two independently authenticated sessions",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const state: Recovery = {
      email: `reset-2657-${randomUUID()}@example.test`,
      oldPassword: `Old-${randomUUID()}-aA1!`,
      newPassword: `New-${randomUUID()}-aA1!`,
      contexts: [],
      prior: [],
      priorCookies: [],
      httpCredentials,
    };
    recoveries.set(page, state);
    const first = await privatePage(browser, state);
    await open(first, `${world.hostBaseUrl}/register`);
    await input(first.locator('input[autocomplete="email"]'), state.email);
    await input(
      first.locator('input[autocomplete="new-password"]'),
      state.oldPassword,
    );
    const sentAt = new Date().toISOString();
    const registered = post(first, "/v1/auth/register");
    await first.getByTestId("register-submit").click();
    expect((await registered).ok(), "owned account registration accepted").toBe(
      true,
    );
    await first.waitForURL((url) => url.pathname === "/verify");
    await first.waitForLoadState("networkidle");
    const code = await fetchRecoveryCode(
      first.context().request,
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      sentAt,
      "register",
    );
    const verified = post(first, "/v1/auth/verify");
    await input(first.locator('input[autocomplete="one-time-code"]'), code);
    expect((await verified).ok(), "delivered registration code accepted").toBe(
      true,
    );
    await first.waitForURL(
      (url) => !["/register", "/verify"].includes(url.pathname),
    );
    await ownProfile(first, state.email);
    const second = await privatePage(browser, state);
    expect(
      (
        await passwordSignIn(
          second,
          world.hostBaseUrl,
          state.email,
          state.oldPassword,
        )
      ).status(),
      "second independent sign-in",
    ).toBe(200);
    await second.waitForURL((url) => url.pathname === "/account");
    await ownProfile(second, state.email);
    await ownProfile(first, state.email);
    state.prior = [first, second];
    state.priorCookies = await Promise.all(state.prior.map(cookieValue));
    expect(
      state.priorCookies[0] !== state.priorCookies[1],
      "two distinct old sessions",
    ).toBe(true);
  },
);

When(
  "that account completes the Academy reset form with its fresh delivered code and a new password",
  async ({ page, browser, world }) => {
    const state = recovery(page);
    const reset = await privatePage(browser, state);
    state.recovered = reset;
    await open(reset, `${world.hostBaseUrl}/reset`);
    await input(reset.locator('input[autocomplete="username"]'), state.email);
    const requestedAt = new Date().toISOString();
    const requested = post(reset, "/v1/auth/password/reset");
    await reset.getByTestId("reset-request-submit").click();
    expect((await requested).status(), "reset request accepted").toBe(200);
    const code = await fetchRecoveryCode(
      reset.context().request,
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      requestedAt,
      "reset",
    );
    await input(reset.locator('input[autocomplete="one-time-code"]'), code);
    await input(
      reset.locator('input[autocomplete="new-password"]'),
      state.newPassword,
    );
    const completed = post(reset, "/v1/auth/password/reset/complete");
    await reset.locator('form button[type="submit"]').click();
    state.completion = await completed;
  },
);

Then(
  "reset completion opens the same account directly with a fresh secure host-only session and no exposed tokens",
  async ({ page, world }) => {
    const state = recovery(page);
    const reset = state.recovered!;
    const response = state.completion!;
    expect(response.status(), "reset completion accepted").toBe(200);
    const body = await response.text();
    expect(
      body === JSON.stringify({ status: "reset_completed" }),
      "token-free reset acknowledgement",
    ).toBe(true);
    const header = (await response.headerValue("set-cookie")) ?? "";
    expect(header.includes(`${SESSION}=`), "reset minted session cookie").toBe(
      true,
    );
    expect(/(?:^|;)\s*Domain=/i.test(header), "no Domain attribute").toBe(
      false,
    );
    await reset.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await ownProfile(reset, state.email);
    const session = (await reset.context().cookies()).find(
      (cookie) => cookie.name === SESSION,
    );
    expect(Boolean(session), "fresh session exists").toBe(true);
    expect({
      domain: session!.domain,
      path: session!.path,
      httpOnly: session!.httpOnly,
      secure: session!.secure,
      sameSite: session!.sameSite,
    }).toEqual({
      domain: new URL(world.hostBaseUrl).hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect(
      state.priorCookies.includes(session!.value),
      "fresh session differs from both prior sessions",
    ).toBe(false);
    const exposed = await reset.evaluate(() => {
      const readable = JSON.stringify({
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      return /__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
        readable,
      );
    });
    expect(
      exposed,
      "no tokens or private session in JavaScript-readable stores",
    ).toBe(false);
  },
);

Then(
  "both original sessions lose profile access while the new password signs in and the old password is refused",
  async ({ page, browser, world }) => {
    const state = recovery(page);
    for (const old of state.prior) {
      const status = await old.evaluate(
        async () =>
          (await fetch("/v1/me/profile", { credentials: "include" })).status,
      );
      expect(
        status,
        "original cookie rejected in its original browser fingerprint",
      ).toBe(401);
    }
    const fresh = await privatePage(browser, state);
    expect(
      (
        await passwordSignIn(
          fresh,
          world.hostBaseUrl,
          state.email,
          state.newPassword,
        )
      ).status(),
      "new password sign-in",
    ).toBe(200);
    await fresh.waitForURL((url) => url.pathname === "/account");
    await ownProfile(fresh, state.email);
    const refused = await privatePage(browser, state);
    expect(
      (
        await passwordSignIn(
          refused,
          world.hostBaseUrl,
          state.email,
          state.oldPassword,
        )
      ).status(),
      "old password refused",
    ).toBe(401);
    expect(
      (await refused.context().cookies()).some(
        (cookie) => cookie.name === SESSION,
      ),
      "refused sign-in minted no session",
    ).toBe(false);
    expect(
      await refused.evaluate(
        async () =>
          (await fetch("/v1/me/profile", { credentials: "include" })).status,
      ),
      "refused sign-in cannot read profile",
    ).toBe(401);
  },
);

After("@password-reset-complete", async ({ page }) => {
  const state = recoveries.get(page);
  if (!state) return;
  try {
    for (const context of state.contexts) {
      for (const active of context.pages()) {
        if (active.url().startsWith("https://")) {
          await active
            .evaluate(async () => {
              await fetch("/v1/auth/logout", {
                method: "POST",
                credentials: "include",
              });
            })
            .catch(() => undefined);
        }
      }
      // Close pages first so failure-context snapshots cannot capture a code.
      await Promise.all(context.pages().map((active) => active.close()));
      await context.close();
    }
  } finally {
    recoveries.delete(page);
  }
});
