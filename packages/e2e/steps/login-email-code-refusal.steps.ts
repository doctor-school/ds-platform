import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  assertNoVerificationMail,
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface OwnedEmailRefusal {
  context: BrowserContext;
  page: Page;
  email: string;
  subject?: string;
  priorCookie?: string | undefined;
  code?: string | undefined;
  loginRequests: number;
  resendRequests: number;
}
const accounts = new WeakMap<Page, OwnedEmailRefusal>();
function account(key: Page): OwnedEmailRefusal {
  const state = accounts.get(key);
  if (!state) throw new Error("The owned email sign-in account is missing");
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
    const session = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    return {
      logout: logout.status,
      profile: profile.status,
      session: session.status,
    };
  });
}

Given(
  "an owned Academy email-code refusal doctor verifies a fresh registration",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: OwnedEmailRefusal = {
      context,
      page: owned,
      email: `wave-q-3100-${randomUUID()}@example.test`,
      loginRequests: 0,
      resendRequests: 0,
    };
    accounts.set(page, state);
    owned.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== "POST") return;
      if (path === signInHostApiPath("/v1/auth/login/otp/request"))
        state.resendRequests += 1;
      if (path === signInHostApiPath("/v1/auth/login/otp"))
        state.loginRequests += 1;
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
    const before = await identity(owned);
    expect({
      profile: before.profileStatus,
      session: before.sessionStatus,
      sameEmail: before.email === state.email,
      emailVerified: before.emailVerified,
      hasSubject:
        typeof before.subject === "string" && before.subject.length > 0,
    }).toEqual({
      profile: 200,
      session: 200,
      sameEmail: true,
      emailVerified: true,
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
  "that owned refusal doctor logs out and retains the newly delivered email login code",
  async ({ page, world }) => {
    const state = account(page);
    expect(await revoke(state.page), "registration session revoked").toEqual({
      logout: 200,
      profile: 401,
      session: 401,
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
    await state.page.getByTestId("otp-channel-email").click();
    await inputSecret(state.page.getByTestId("otp-identifier"), state.email);
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const checkpoint = await captureAddressedMailCheckpoint(
      mail,
      mailpit,
      state.email,
    );
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
        body.channel === "email" &&
        body.identifier === state.email;
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
    state.code = await fetchRecoveryCode(
      mail,
      mailpit,
      state.email,
      checkpoint,
      "login",
    );
    await assertNoVerificationMail(mail, mailpit, state.email, checkpoint);
  },
);

When(
  "the email login guest submits a different valid six-digit code and receives the generic refusal",
  async ({ page }) => {
    const state = account(page);
    if (!state.code)
      throw new Error("The retained actual email code is missing");
    const wrong = `${(Number(state.code[0]) + 1) % 10}${state.code.slice(1)}`;
    expect(
      /^\d{6}$/.test(wrong) && wrong !== state.code,
      "wrong code is well formed and differs from the real delivery",
    ).toBe(true);
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/login/otp"),
    );
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await inputSecret(field, wrong);
    const refused = await pending;
    let generic = false;
    let submittedWrongEmailCode = false;
    try {
      const body = JSON.parse(refused.body);
      generic =
        Object.keys(body).length === 3 &&
        body.statusCode === 401 &&
        body.message === "invalid credentials" &&
        body.error === "Unauthorized";
      const request = hostCommand(refused.response.request().postDataJSON());
      submittedWrongEmailCode =
        Object.keys(request).sort().join(",") === "channel,code,identifier" &&
        request.channel === "email" &&
        request.identifier === state.email &&
        request.code === wrong;
    } catch {
      /* Secret-bearing parser diagnostics are deliberately discarded. */
    }
    expect({
      status: refused.response.status(),
      generic,
      submittedWrongEmailCode,
      noCookie: (await refused.response.headerValue("set-cookie")) === null,
    }).toEqual({
      status: 401,
      generic: true,
      submittedWrongEmailCode: true,
      noCookie: true,
    });
    const guest = await identity(state.page);
    expect({
      profile: guest.profileStatus,
      session: guest.sessionStatus,
      noCookie: !(await state.context.cookies()).some(
        (c) => c.name === "__Host-ds_session",
      ),
    }).toEqual({ profile: 401, session: 401, noCookie: true });
    await expect(
      state.page.locator("[data-input-otp-container] > div:first-child > div"),
    ).toHaveCount(6);
    await expect(field, "refused email code cleared").toHaveValue("");
    await expect(field, "first code cell refocused").toBeFocused();
    const refusalPlate = state.page.getByRole("alert").filter({
      hasText: "Код не подошёл. Проверьте его или запросите новый.",
    });
    await expect(
      refusalPlate,
      "one email-code operation refusal plate",
    ).toHaveCount(1);
    await expect(refusalPlate).toBeVisible();
    await expect(refusalPlate).toHaveText(
      /^⚠\s*Код не подошёл\. Проверьте его или запросите новый\.$/,
    );
  },
);

When(
  "the refused email login guest enters the retained actual code without requesting another",
  async ({ page, world }) => {
    const state = account(page);
    if (!state.code)
      throw new Error("The addressed email login code is missing");
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
        request.identifier === state.email &&
        request.channel === "email";
      noTokenBody =
        storefrontCallbackAcknowledgement(signedIn.body, world.hostBaseUrl);
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
    expect({
      deliveriesRequested: state.resendRequests,
      codesSubmitted: state.loginRequests,
    }).toEqual({ deliveriesRequested: 1, codesSubmitted: 2 });
    state.code = undefined;
  },
);

Then(
  "the recovered email login session persists for the same verified doctor through reload",
  async ({ page }) => {
    const state = account(page);
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await expect(
      state.page.getByTestId("profile-email-verified"),
    ).toBeVisible();
    const current = await identity(state.page);
    expect({
      profile: current.profileStatus,
      session: current.sessionStatus,
      sameSubject: current.subject === state.subject,
      sameEmail: current.email === state.email,
      emailVerified: current.emailVerified,
    }).toEqual({
      profile: 200,
      session: 200,
      sameSubject: true,
      sameEmail: true,
      emailVerified: true,
    });
    expect(await revoke(state.page), "email session revoked").toEqual({
      logout: 200,
      profile: 401,
      session: 401,
    });
    const guest = await identity(state.page);
    expect({
      profile: guest.profileStatus,
      session: guest.sessionStatus,
    }).toEqual({ profile: 401, session: 401 });
    expect(
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "final owned logout removes private cookie",
    ).toBe(false);
  },
);

After("@login-email-code-refusal", async ({ page, world }) => {
  const state = accounts.get(page);
  if (!state) return;
  let failed = false;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const origin = new URL(world.hostBaseUrl).origin;
      const active = state.context
        .pages()
        .find((p) => new URL(p.url()).origin === origin);
      if (!active) throw new Error("Owned email refusal cleanup page missing");
      expect(await revoke(active), "owned email session cleanup").toEqual({
        logout: 200,
        profile: 401,
        session: 401,
      });
    }
  } catch {
    failed = true;
  } finally {
    state.code = undefined;
    await state.context.close().catch(() => {
      failed = true;
    });
    accounts.delete(page);
  }
  if (failed) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned email refusal session cleanup failed");
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned email refusal session cleanup failed; original scenario failure retained.",
    });
  }
});
