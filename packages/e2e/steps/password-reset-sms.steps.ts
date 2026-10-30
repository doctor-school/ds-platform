import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Response,
} from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  mailpitUrlFor,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  inputSecret as input,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  RESET_CODE_EVENT,
  captureSmsCheckpoint,
  freshConfirmablePhone,
  resetSmsCode,
  smsSinkMessages,
  smsSinkUrl,
  waitForSmsCode,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { gatedPasswordLogin } from "../lib/gated-password-login.js";
import { After, Before, Given, Then, When } from "./support/auth-fixtures.js";

/**
 * 003 EARS-53/12/35 (#2861): password reset by a confirmed phone, on the real
 * stand — the account confirms its phone through `/account` with the code the
 * sink received, the reset code is read from the sink the same way, and the
 * completion runs through the `/reset` form. Nothing is faked: the codes are the
 * ones Zitadel delivered.
 */

const SESSION = "__Host-ds_session";

interface SmsReset {
  email: string;
  phone: string;
  oldPassword: string;
  newPassword: string;
  sink: string;
  mailpit: string;
  httpCredentials: BrowserContextOptions["httpCredentials"];
  contexts: BrowserContext[];
  /** The session that registered the account and confirmed its phone. */
  earlier?: Page;
  earlierCookie?: string;
  /** The account's mailbox once phone confirmation settled (EARS-52 notice). */
  mailbox?: AddressedMailCheckpoint;
  reset?: Page;
  requestedAt?: SmsCheckpoint;
  code?: string;
  completion?: CapturedResponse;
}
const resets = new WeakMap<Page, SmsReset>();
function smsReset(key: Page): SmsReset {
  const state = resets.get(key);
  if (!state) throw new Error("SMS reset account was not prepared");
  return state;
}

async function privatePage(browser: Browser, state: SmsReset): Promise<Page> {
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
async function profile(page: Page): Promise<{
  status: number;
  email?: string;
  emailVerified?: boolean;
  phone?: string | null;
  phoneVerified?: boolean | null;
}> {
  return page.evaluate(async () => {
    const response = await fetch("/v1/me/profile", { credentials: "include" });
    if (!response.ok) return { status: response.status };
    const body = await response.json();
    return {
      status: response.status,
      email: body.email,
      emailVerified: body.emailVerified,
      phone: body.phone,
      phoneVerified: body.phoneVerified,
    };
  });
}

/**
 * The EARS-52 notice of the confirmation is fire-and-forget, so the mailbox is
 * read until two reads three seconds apart agree: «no email is sent» by the
 * reset is then judged against that settled set, never against a clock.
 */
async function settledMailbox(
  request: APIRequestContext,
  root: string,
  email: string,
): Promise<AddressedMailCheckpoint> {
  let previous = await captureAddressedMailCheckpoint(request, root, email);
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const next = await captureAddressedMailCheckpoint(request, root, email);
    if (next.messageIds.join() === previous.messageIds.join()) return next;
    previous = next;
  }
  throw new Error(
    "The account mailbox did not settle after phone confirmation",
  );
}

Before({ tags: "@sms-reset" }, async ({ $testInfo }) => {
  // The stage box runs a sink but publishes only Mailpit, so a slot run cannot
  // read the delivered SMS (stage publishes no sink yet — #2878); it names the
  // skip rather than faking the code.
  $testInfo.skip(
    smsSinkUrl() === null,
    "@sms-reset: E2E_SMS_SINK_URL names no SMS sink this run can read",
  );
});

After({ tags: "@sms-reset" }, async ({ page }) => {
  const state = resets.get(page);
  if (!state) return;
  await Promise.all(state.contexts.map((context) => context.close()));
});

Given(
  "an account with a unique confirmed phone and a verified email",
  async ({ page, browser, request, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const base = world.hostBaseUrl;
    const state: SmsReset = {
      email: `reset-sms-2861-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      oldPassword: `Old-${randomUUID()}-aA1!`,
      newPassword: `New-${randomUUID()}-aA1!`,
      sink: smsSinkUrl()!,
      mailpit: process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base),
      httpCredentials,
      contexts: [],
    };
    resets.set(page, state);

    const earlier = await privatePage(browser, state);
    const { code } = await registerOwnedCredentials(
      earlier,
      base,
      { email: state.email, password: state.oldPassword },
      "/account",
    );
    const verified = post(earlier, signInHostApiPath("/v1/auth/verify"));
    await input(earlier.locator('input[autocomplete="one-time-code"]'), code);
    expect((await verified).ok(), "registration code accepted").toBe(true);
    await earlier.waitForURL((url) => url.pathname === "/account");
    await earlier.waitForLoadState("networkidle");

    await confirmOwnedPhone(earlier, { phone: state.phone, sink: state.sink });
    expect(await profile(earlier)).toEqual({
      status: 200,
      email: state.email,
      emailVerified: true,
      phone: state.phone,
      phoneVerified: true,
    });
    state.earlier = earlier;
    const earlierCookie = (await earlier.context().cookies()).find(
      (cookie) => cookie.name === SESSION,
    )?.value;
    expect(Boolean(earlierCookie), "earlier session cookie").toBe(true);
    state.earlierCookie = earlierCookie!;
    state.mailbox = await settledMailbox(request, state.mailpit, state.email);
  },
);

When(
  "a visitor requests a password reset with that confirmed phone as the identifier",
  async ({ page, browser, world }) => {
    const state = smsReset(page);
    const reset = await privatePage(browser, state);
    state.reset = reset;
    await open(reset, `${world.hostBaseUrl}/reset`);
    await reset
      .locator('input[autocomplete="username"]')
      .pressSequentially(state.phone);
    state.requestedAt = await captureSmsCheckpoint(state.sink, state.phone);
    const requested = post(reset, signInHostApiPath("/v1/auth/password/reset"));
    await reset.getByTestId("reset-request-submit").click();
    const response = await requested;
    expect(response.status(), "reset request status").toBe(200);
    expect(await response.json(), "neutral reset acknowledgement").toEqual({
      status: "reset_requested",
    });
    await expect(
      reset.locator('input[autocomplete="one-time-code"]'),
    ).toBeVisible();
  },
);

Then(
  "one SMS with a six-digit code is delivered to that phone and no email is sent",
  async ({ page, request }) => {
    const state = smsReset(page);
    // Positive delivery first, so a dead pipeline cannot prove the absences.
    state.code = await waitForSmsCode(
      state.sink,
      state.phone,
      state.requestedAt!,
      resetSmsCode,
      RESET_CODE_EVENT,
    );
    expect(state.code).toMatch(/^\d{6}$/);
    // The mail horizon below also lets a duplicate SMS arrive before the count.
    await assertNoAddressedMail(
      request,
      state.mailpit,
      state.email,
      state.mailbox!,
    );
    const delivered = await smsSinkMessages(
      state.sink,
      state.phone,
      state.requestedAt!,
    );
    expect(delivered, "exactly one SMS after the request").toHaveLength(1);
    expect(resetSmsCode(delivered[0]!), "it is the reset code").toBe(
      state.code,
    );
    expect(delivered[0]!.body, "the delivered text carries the code").toContain(
      state.code,
    );
  },
);

When(
  "the visitor enters the code and a policy-conforming new password",
  async ({ page }) => {
    const state = smsReset(page);
    const reset = state.reset!;
    await input(
      reset.locator('input[autocomplete="one-time-code"]'),
      state.code!,
    );
    await input(
      reset.locator('input[autocomplete="new-password"]'),
      state.newPassword,
    );
    const completed = captureResponse(
      reset,
      signInHostApiPath("/v1/auth/password/reset/complete"),
    );
    await reset.locator('form button[type="submit"]').click();
    state.completion = await completed;
  },
);

Then(
  "the password is set, all earlier sessions are revoked and the visitor is signed in",
  async ({ page, browser, world }) => {
    const state = smsReset(page);
    const reset = state.reset!;
    const { response, body } = state.completion!;
    expect(response.status(), "reset completion accepted").toBe(200);
    expect(
      storefrontCallbackAcknowledgement(body, world.hostBaseUrl),
      "token-free reset acknowledgement",
    ).toBe(true);
    await reset.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    expect((await profile(reset)).email, "signed in to the same account").toBe(
      state.email,
    );
    await assertSecureSession(reset, response, world.hostBaseUrl, [
      state.earlierCookie!,
    ]);
    expect(
      (await profile(state.earlier!)).status,
      "the earlier session is revoked",
    ).toBe(401);

    const signIn = async (password: string): Promise<number> => {
      const fresh = await privatePage(browser, state);
      await open(fresh, `${world.hostBaseUrl}/login?returnTo=%2Faccount`);
      await input(fresh.locator('input[autocomplete="username"]'), state.email);
      await input(
        fresh.locator('input[autocomplete="current-password"]'),
        password,
      );
      const answer = await gatedPasswordLogin(
        fresh,
        world.hostBaseUrl,
        async () => {
          const pending = post(fresh, signInHostApiPath("/v1/auth/login"));
          await fresh.getByTestId("password-login-submit").click();
          return pending;
        },
      );
      return answer.status();
    };
    expect(await signIn(state.newPassword), "new password signs in").toBe(200);
    expect(await signIn(state.oldPassword), "old password refused").toBe(401);
  },
);

Then(
  "the account's email verification state is unchanged",
  async ({ page }) => {
    const state = smsReset(page);
    expect(await profile(state.reset!)).toEqual({
      status: 200,
      email: state.email,
      emailVerified: true,
      phone: state.phone,
      phoneVerified: true,
    });
  },
);
