import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  smsSinkUrl,
  waitForSmsCode,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const LOGIN_SMS_EVENT = "session.otp.sms.challenged";
interface OwnedSmsLogin {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  sink: string;
  subject?: string;
  priorCookie?: string | undefined;
  code?: string | undefined;
}
const accounts = new WeakMap<Page, OwnedSmsLogin>();
function account(key: Page): OwnedSmsLogin {
  const state = accounts.get(key);
  if (!state) throw new Error("The owned SMS sign-in account is missing");
  return state;
}

async function identity(page: Page) {
  return page.evaluate(async () => {
    const profileResponse = await fetch("/v1/me/profile", {
      credentials: "include",
      cache: "no-store",
    });
    const sessionResponse = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    const profile = await profileResponse.json().catch(() => ({}));
    const session = await sessionResponse.json().catch(() => ({}));
    return {
      profileStatus: profileResponse.status,
      sessionStatus: sessionResponse.status,
      email: profile.email,
      emailVerified: profile.emailVerified,
      phone: profile.phone,
      phoneVerified: profile.phoneVerified,
      subject: session.sub,
    };
  });
}

async function revoke(page: Page) {
  return page.evaluate(async () => {
    const logout = await fetch("/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    const profile = await fetch("/v1/me/profile", {
      credentials: "include",
      cache: "no-store",
    });
    return { logout: logout.status, profile: profile.status };
  });
}

Given(
  "an owned Academy doctor verifies email and confirms a fresh phone through the real account UI",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("SMS sign-in requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: OwnedSmsLogin = {
      context,
      page: owned,
      email: `sms-login-3008-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      sink,
    };
    accounts.set(page, state);
    await test.info().attach("owned-fixture", {
      body: JSON.stringify({
        issue: 3008,
        email: state.email,
        phone: state.phone,
      }),
      contentType: "application/json",
    });
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      { email: state.email, password: `Owned-${randomUUID()}-aA1!` },
      "/account",
    );
    const pending = captureResponse(owned, "/v1/auth/verify");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "real email verification accepted").toBe(
      200,
    );
    await owned.waitForURL((url) => url.pathname === "/account");
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, verified.response, world.hostBaseUrl);
    await confirmOwnedPhone(owned, { phone: state.phone, sink });
    const before = await identity(owned);
    expect({
      profile: before.profileStatus,
      session: before.sessionStatus,
      sameEmail: before.email === state.email,
      emailVerified: before.emailVerified,
      samePhone: before.phone === state.phone,
      phoneVerified: before.phoneVerified,
      hasSubject:
        typeof before.subject === "string" && before.subject.length > 0,
    }).toEqual({
      profile: 200,
      session: 200,
      sameEmail: true,
      emailVerified: true,
      samePhone: true,
      phoneVerified: true,
      hasSubject: true,
    });
    state.subject = before.subject;
    state.priorCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-ds_session",
    )?.value;
    expect(Boolean(state.priorCookie), "registration session exists").toBe(
      true,
    );
  },
);

When(
  "that doctor logs out and requests an SMS sign-in code as a genuine Academy guest",
  async ({ page, world }) => {
    const state = account(page);
    expect(await revoke(state.page), "registration session revoked").toEqual({
      logout: 200,
      profile: 401,
    });
    await state.page.goto(
      new URL(
        "/login?method=code&returnTo=%2Faccount",
        world.hostBaseUrl,
      ).toString(),
      { waitUntil: "load" },
    );
    await state.page.waitForLoadState("networkidle");
    const guest = await identity(state.page);
    expect({
      profile: guest.profileStatus,
      session: guest.sessionStatus,
    }).toEqual({ profile: 401, session: 401 });
    expect(
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "guest has no private cookie",
    ).toBe(false);
    await expect(state.page.getByTestId("login-method-otp")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await state.page.getByTestId("otp-channel-sms").click();
    await inputSecret(state.page.getByTestId("otp-identifier"), state.phone);
    const requestedAt = await captureSmsCheckpoint(state.sink, state.phone);
    const pending = captureResponse(state.page, "/v1/auth/login/otp/request");
    await state.page.getByTestId("otp-send").click();
    const sent = await pending;
    let matches = false;
    let neutral = false;
    try {
      const body = sent.response.request().postDataJSON();
      matches =
        Object.keys(body).sort().join(",") === "channel,identifier" &&
        body.channel === "sms" &&
        body.identifier === state.phone;
      const ack = JSON.parse(sent.body);
      neutral = Object.keys(ack).length === 1 && ack.status === "otp_sent";
    } catch {
      /* Keep secret-bearing parser diagnostics out of reports. */
    }
    expect({ status: sent.response.status(), matches, neutral }).toEqual({
      status: 200,
      matches: true,
      neutral: true,
    });
    const pendingIdentity = await identity(state.page);
    expect({
      profile: pendingIdentity.profileStatus,
      session: pendingIdentity.sessionStatus,
    }).toEqual({ profile: 401, session: 401 });
    state.code = await waitForSmsCode(
      state.sink,
      state.phone,
      requestedAt,
      (message) => {
        if (message.json?.contextInfo?.eventType !== LOGIN_SMS_EVENT)
          return null;
        const args = message.json.args as
          { oTP?: unknown; code?: unknown } | undefined;
        const code = String(args?.oTP ?? args?.code ?? "");
        return /^\d{6}$/.test(code) ? code : null;
      },
      LOGIN_SMS_EVENT,
    );
  },
);

When(
  "the guest enters the actual six-digit SMS login code and it auto-submits",
  async ({ page, world }) => {
    const state = account(page);
    if (!state.code) throw new Error("The addressed SMS login code is missing");
    expect(/^\d{6}$/.test(state.code), "real login code has six digits").toBe(
      true,
    );
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(field).toHaveAttribute("maxlength", "6");
    const pending = captureResponse(state.page, "/v1/auth/login/otp");
    await inputSecret(field, state.code);
    const signedIn = await pending;
    let matches = false;
    let noTokenBody = false;
    try {
      const request = signedIn.response.request().postDataJSON();
      matches =
        request.code === state.code &&
        request.identifier === state.phone &&
        request.channel === "sms";
      const body = JSON.parse(signedIn.body);
      noTokenBody =
        Object.keys(body).length === 1 && body.status === "authenticated";
    } catch {
      /* Assertions project only booleans. */
    }
    expect({
      status: signedIn.response.status(),
      matches,
      noTokenBody,
    }).toEqual({ status: 200, matches: true, noTokenBody: true });
    await state.page.waitForURL((url) => url.pathname === "/account");
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(
      state.page,
      signedIn.response,
      world.hostBaseUrl,
      state.priorCookie ? [state.priorCookie] : [],
    );
    state.code = undefined;
  },
);

Then(
  "the SMS session belongs to that same confirmed-phone Academy doctor and logout removes private access",
  async ({ page }) => {
    const state = account(page);
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    const current = await identity(state.page);
    expect({
      profile: current.profileStatus,
      session: current.sessionStatus,
      sameSubject: current.subject === state.subject,
      sameEmail: current.email === state.email,
      emailVerified: current.emailVerified,
      samePhone: current.phone === state.phone,
      phoneVerified: current.phoneVerified,
    }).toEqual({
      profile: 200,
      session: 200,
      sameSubject: true,
      sameEmail: true,
      emailVerified: true,
      samePhone: true,
      phoneVerified: true,
    });
    await state.page.screenshot({
      path: test.info().outputPath("confirmed-phone-sms-login.png"),
    });
    expect(await revoke(state.page), "SMS session revoked").toEqual({
      logout: 200,
      profile: 401,
    });
    const guest = await identity(state.page);
    expect({
      profile: guest.profileStatus,
      session: guest.sessionStatus,
    }).toEqual({ profile: 401, session: 401 });
  },
);

After("@login-sms-confirmed", async ({ page }) => {
  const state = accounts.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      expect(await revoke(state.page), "owned SMS session cleanup").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    state.code = undefined;
    await state.context.close();
    accounts.delete(page);
  }
});
