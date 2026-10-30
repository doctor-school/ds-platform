import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import {
  genericRefusal,
  privateAccess,
  replayOnHostForm,
} from "../lib/host-sign-in.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  smsSinkUrl,
  waitForSmsCode,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
const LOGIN_SMS_EVENT = "session.otp.sms.challenged";
interface OwnedSmsLogin {
  guest?: { context: BrowserContext; page: Page };
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

async function assertOwner(state: OwnedSmsLogin) {
  const current = await identity(state.page);
  expect(
    {
      profile: current.profileStatus,
      session: current.sessionStatus,
      sameSubject: current.subject === state.subject,
      sameEmail: current.email === state.email,
      emailVerified: current.emailVerified,
      samePhone: current.phone === state.phone,
      phoneVerified: current.phoneVerified,
    },
    "the original verified phone owner retains its identity",
  ).toEqual({
    profile: 200,
    session: 200,
    sameSubject: true,
    sameEmail: true,
    emailVerified: true,
    samePhone: true,
    phoneVerified: true,
  });
  await expect(state.page.getByTestId("profile-phone-verified")).toBeVisible();
}

Given(
  "an owned Academy consumed-code doctor verifies email and confirms a fresh phone through the account UI",
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
      email: `sms-login-reuse-3127-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      sink,
    };
    accounts.set(page, state);
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
    const pending = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/verify"),
    );
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
  "that consumed-code doctor logs out and requests one delivered SMS login code as an Academy guest",
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
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/login/otp/request"),
    );
    await state.page.getByTestId("otp-send").click();
    const sent = await pending;
    let matches = false;
    let neutral = false;
    try {
      const body = hostCommand(sent.response.request().postDataJSON());
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
  "the consumed-code guest enters the actual six-digit SMS login code and it auto-submits",
  async ({ page, world }) => {
    const state = account(page);
    if (!state.code) throw new Error("The addressed SMS login code is missing");
    expect(/^\d{6}$/.test(state.code), "real login code has six digits").toBe(
      true,
    );
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(field).toHaveAttribute("maxlength", "6");
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/login/otp"),
    );
    await inputSecret(field, state.code);
    const signedIn = await pending;
    let matches = false;
    let noTokenBody = false;
    try {
      const request = hostCommand(signedIn.response.request().postDataJSON());
      matches =
        request.code === state.code &&
        request.identifier === state.phone &&
        request.channel === "sms";
      noTokenBody = storefrontCallbackAcknowledgement(
        signedIn.body,
        world.hostBaseUrl,
      );
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
  },
);

Then(
  "an independent Academy guest cannot reuse the consumed SMS login code and its confirmed-phone owner survives reload",
  async ({ page, browser, httpCredentials, world }) => {
    const state = account(page);
    if (!state.code) throw new Error("Consumed SMS login code missing");
    await assertOwner(state);
    const guest = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const visitor = await guest.newPage();
    state.guest = { context: guest, page: visitor };
    {
      // #3565 — the replay goes where a code is entered now: the sign-in
      // host's login-code step, as a host form post of the guest's own auth
      // request; the guest is then back on the storefront, whose session and
      // profile the replay must not have granted.
      expect(
        (await guest.cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        ),
        "replay starts without the owner's session",
      ).toBe(false);
      const refusal = await replayOnHostForm(
        visitor,
        world.hostBaseUrl,
        signInHostApiPath("/v1/auth/login/otp"),
        { identifier: state.phone, channel: "sms", code: state.code },
      );
      const evidence = {
        status: refusal.response.status(),
        generic: genericRefusal(refusal.body, 401, "invalid credentials"),
        ...(await privateAccess(visitor)),
      };
      expect(
        evidence,
        "the consumed code is generically refused without private access",
      ).toEqual({ status: 401, generic: true, session: 401, profile: 401 });
      expect(
        (await refusal.response.headerValue("set-cookie")) === null,
        "replay mints no session cookie",
      ).toBe(true);
      expect(
        (await guest.cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        ),
      ).toBe(false);
    }
    const prior = (await state.context.cookies()).find(
      (cookie) => cookie.name === "__Host-ds_session",
    )?.value;
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await assertOwner(state);
    expect(
      (await state.context.cookies()).find(
        (cookie) => cookie.name === "__Host-ds_session",
      )?.value === prior && prior !== undefined,
      "the original owner retains its exact secure session",
    ).toBe(true);
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "reloaded account renders the original owner",
    ).toBe(true);
  },
);

After("@login-sms-code-reuse", async ({ page }) => {
  const state = accounts.get(page);
  if (!state) return;
  let cleanupFailed = false;
  const owned = [state, ...(state.guest ? [state.guest] : [])];
  for (const browser of owned) {
    try {
      if (
        (await browser.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        )
      ) {
        const revoked = await browser.page.evaluate(async () => {
          const logout = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const session = await fetch("/v1/auth/session", {
            credentials: "include",
            cache: "no-store",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
            cache: "no-store",
          });
          return {
            logout: logout.status,
            session: session.status,
            profile: profile.status,
          };
        });
        expect(revoked, "only this owned SMS-code session is revoked").toEqual({
          logout: 200,
          session: 401,
          profile: 401,
        });
      }
    } catch {
      cleanupFailed = true;
    } finally {
      try {
        await browser.context.close();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  accounts.delete(page);
  if (cleanupFailed) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned SMS-code session cleanup failed");
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned SMS-code session cleanup failed; original failure preserved; lead must inspect scoped cleanup.",
    });
  }
});
