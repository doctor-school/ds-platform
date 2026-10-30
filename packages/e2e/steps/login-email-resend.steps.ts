import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { STOREFRONT_SIGN_OUT_PATH } from "../lib/storefront-sign-out.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface ResentLogin extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  subject?: string;
  priorCookies: string[];
  before?: AddressedMailCheckpoint;
  code?: string;
  requests: number;
  firstDelivery?: AddressedMailCheckpoint;
  profile?: string;
}
const logins = new WeakMap<Page, ResentLogin>();
function login(key: Page): ResentLogin {
  const state = logins.get(key);
  if (!state) throw new Error("Owned verified login account was not prepared");
  return state;
}

async function assertOwnedVerifiedIdentity(state: ResentLogin) {
  const result = await state.page.evaluate(
    async ({ email, subject, previous }) => {
      const profileResponse = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await profileResponse.json().catch(() => ({}));
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await sessionResponse.json().catch(() => ({}));
      return {
        profile: JSON.stringify(profile),
        subject: typeof session.sub === "string" ? session.sub : undefined,
        evidence: {
          profileStatus: profileResponse.status,
          sameEmail: profile.email === email,
          unchangedProfile:
            previous === undefined || previous === JSON.stringify(profile),
          emailVerified: profile.emailVerified === true,
          sessionStatus: sessionResponse.status,
          subjectPresent:
            typeof session.sub === "string" && session.sub.length > 0,
          sameSubject: subject === undefined || session.sub === subject,
          doctorGuest:
            Array.isArray(session.roles) &&
            session.roles.includes("doctor_guest"),
        },
      };
    },
    { email: state.email, subject: state.subject, previous: state.profile },
  );
  expect(
    result.evidence,
    "private profile belongs to the same verified owned identity",
  ).toEqual({
    profileStatus: 200,
    sameEmail: true,
    unchangedProfile: true,
    emailVerified: true,
    sessionStatus: 200,
    subjectPresent: true,
    sameSubject: true,
    doctorGuest: true,
  });
  state.subject ??= result.subject;
  state.profile ??= result.profile;
}

Given(
  "a uniquely registered and verified Academy doctor_guest account is logged out for an email-code resend",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: ResentLogin = {
      context,
      page: page,
      email: `wave-q-3102-${randomUUID()}@example.test`,
      password: `Verified-${randomUUID()}-aA1!`,
      priorCookies: [],
      requests: 0,
    };
    logins.set(page, state);
    const owned = await context.newPage();
    state.page = owned;
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { response, body, code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
    expect(
      registrationEvidence(response.request().postData() ?? "", body, state),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    const verified = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/verify"),
    ).then(({ response, body }) => ({
      response,
      evidence: verificationEvidence(
        response.request().postData() ?? "",
        body,
        state,
        code,
        world.hostBaseUrl,
      ),
    }));
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const accepted = await verified;
    expect(accepted.response.status(), "owned registration code accepted").toBe(
      200,
    );
    expect(accepted.evidence).toEqual({
      credentialsMatch: true,
      acknowledgementMatches: true,
    });
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, accepted.response, world.hostBaseUrl);
    await assertOwnedVerifiedIdentity(state);
    state.priorCookies = (await context.cookies())
      .filter((cookie) => cookie.name === SESSION)
      .map((cookie) => cookie.value);

    const loggedOut = captureResponse(owned, STOREFRONT_SIGN_OUT_PATH);
    await owned.getByTestId("logout").click();
    const logout = await loggedOut;
    expect(
      logout.response.status(),
      "ordinary account sign-out succeeded",
    ).toBe(200);
    const cleared = (await logout.response.headerValue("set-cookie")) ?? "";
    expect(
      cleared.includes(`${SESSION}=`),
      "sign-out clears private session cookie",
    ).toBe(true);
    expect(
      /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cleared),
      "sign-out expires private session cookie",
    ).toBe(true);
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/",
    );
    await assertNoPrivateRegistrationAccess(owned, "", state);
  },
);

function mailbox(state: ResentLogin, base: string) {
  return captureAddressedMailCheckpoint(
    nativeRecoveryMail(),
    process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base),
    state.email,
  );
}

async function requestResult(page: Page, state: ResentLogin) {
  const { response, body } = await captureResponse(
    page,
    signInHostApiPath("/v1/auth/login/otp/request"),
  );
  let matches = false;
  try {
    const request = hostCommand(response.request().postDataJSON());
    matches =
      request.identifier === state.email &&
      request.channel === "email" &&
      Object.keys(request).length === 2 &&
      body === '{"status":"otp_sent"}';
  } catch {
    // Discard credential-bearing parser diagnostics.
  }
  expect({ status: response.status(), matches }).toEqual({
    status: 200,
    matches: true,
  });
  await assertNoPrivateRegistrationAccess(
    page,
    (await response.headerValue("set-cookie")) ?? "",
    state,
  );
}

async function deliveredCode(
  state: ResentLogin,
  base: string,
  before: AddressedMailCheckpoint,
) {
  const code = await fetchRecoveryCode(
    nativeRecoveryMail(),
    process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base),
    state.email,
    before,
    "login",
  );
  expect(/^\d{6}$/.test(code), "fresh addressed login code format").toBe(true);
  const after = await mailbox(state, base);
  expect(
    after.messageIds.filter((id) => !before.messageIds.includes(id)).length,
    "exactly one new recipient-bound delivery after the request checkpoint",
  ).toBe(1);
  return { code, after };
}

When(
  "the resend owner requests an initial real Academy email login code with its resend button disabled",
  async ({ page, world }) => {
    const state = login(page);
    const target = new URL(world.host.loginPath, world.hostBaseUrl);
    target.searchParams.set("returnTo", "/account");
    await state.page.goto(target.toString(), { waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await state.page.getByTestId("login-method-otp").click();
    await state.page.getByTestId("otp-channel-email").click();
    await inputSecret(state.page.getByTestId("otp-identifier"), state.email);
    await state.page.clock.install();
    // Sample the owning browser's clock before the countdown starts (#3035).
    const pausePoint = await state.page.evaluate(() => Date.now() + 60_000);
    await state.page.clock.pauseAt(new Date(pausePoint));
    state.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          signInHostApiPath("/v1/auth/login/otp/request")
      )
        state.requests += 1;
    });
    state.before = await mailbox(state, world.hostBaseUrl);
    const pending = requestResult(state.page, state);
    await state.page.getByTestId("otp-send").click();
    await pending;
    const delivery = await deliveredCode(
      state,
      world.hostBaseUrl,
      state.before,
    );
    state.firstDelivery = delivery.after;
    await expect(state.page.getByTestId("otp-resend")).toBeDisabled();
    expect(state.requests, "only the initial actual login-code request").toBe(
      1,
    );
  },
);

When(
  "only that browser's thirty-second login cooldown advances before the actual email resend click",
  async ({ page, world }) => {
    const state = login(page);
    const resend = state.page.getByTestId("otp-resend");
    await expect(resend).toBeDisabled();
    // 003 EARS-17: only page intervals advance, never server/IdP clocks or quotas.
    for (let second = 0; second < 30; second++) {
      await state.page.clock.runFor(1000);
      await state.page.evaluate(
        () => new Promise<void>((resolve) => queueMicrotask(resolve)),
      );
    }
    await expect(resend).toBeEnabled();
    expect(state.requests, "advancing the UI timer sends nothing").toBe(1);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
    const before = await mailbox(state, world.hostBaseUrl);
    if (!state.firstDelivery || !state.before)
      throw new Error("Initial addressed login delivery checkpoint missing");
    expect(
      before.messageIds.length === state.firstDelivery.messageIds.length &&
        before.messageIds.every((id) =>
          state.firstDelivery!.messageIds.includes(id),
        ),
      "no extra addressed delivery precedes the actual resend",
    ).toBe(true);
    const pending = requestResult(state.page, state);
    await resend.click();
    await pending;
    const delivery = await deliveredCode(state, world.hostBaseUrl, before);
    state.code = delivery.code;
    expect(state.requests, "initial request plus one actual resend").toBe(2);
    await expect(resend).toBeDisabled();
    await expect(resend).toContainText("30");
    await expect(
      state.page.locator('input[autocomplete="one-time-code"]'),
    ).toHaveValue("");
    await assertNoPrivateRegistrationAccess(state.page, "", state);
    await state.page.clock.resume();
  },
);

Then(
  "the newest actual email delivery authenticates the same Academy owner through reload and exact logout",
  async ({ page, world }) => {
    const state = login(page);
    if (!state.code) throw new Error("Resent addressed login code missing");
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/login/otp"),
    ).then(({ response, body }) => {
      let matches = false;
      try {
        const request = hostCommand(response.request().postDataJSON());
        matches =
          request.identifier === state.email &&
          request.channel === "email" &&
          request.code === state.code &&
          Object.keys(request).length === 3 &&
          storefrontCallbackAcknowledgement(body, world.hostBaseUrl);
      } catch {
        // Discard code-bearing parser diagnostics.
      }
      return { response, matches };
    });
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    const accepted = await pending;
    expect({
      status: accepted.response.status(),
      matches: accepted.matches,
    }).toEqual({ status: 200, matches: true });
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(
      state.page,
      accepted.response,
      world.hostBaseUrl,
      state.priorCookies,
    );
    await assertOwnedVerifiedIdentity(state);
    const cookie = (await state.context.cookies()).find(
      (entry) => entry.name === SESSION,
    )?.value;
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await assertOwnedVerifiedIdentity(state);
    expect(
      cookie !== undefined &&
        (await state.context.cookies()).find((entry) => entry.name === SESSION)
          ?.value === cookie,
      "the exact owned secure session survives reload",
    ).toBe(true);
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "reloaded account renders the same owner",
    ).toBe(true);
    await expect(
      state.page.getByTestId("profile-email-verified"),
    ).toBeVisible();
    expect(
      state.requests,
      "exactly the initial and resend login-code requests",
    ).toBe(2);
    await revokeOwnedSession(state);
  },
);

async function revokeOwnedSession(state: ResentLogin) {
  const revoked = await state.page.evaluate(async () => {
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
  expect(revoked, "only this owned resend session is revoked").toEqual({
    logout: 200,
    session: 401,
    profile: 401,
  });
  expect(
    (await state.context.cookies()).some((entry) => entry.name === SESSION),
    "owned cookie cleared after exact logout",
  ).toBe(false);
}

After("@login-email-resend", async ({ page }) => {
  const state = logins.get(page);
  if (!state) return;
  let cleanupFailed = false;
  try {
    if ((await state.context.cookies()).some((entry) => entry.name === SESSION))
      await revokeOwnedSession(state);
  } catch {
    cleanupFailed = true;
  } finally {
    state.code = "";
    try {
      await state.context.close();
    } catch {
      cleanupFailed = true;
    }
    logins.delete(page);
  }
  if (cleanupFailed) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned email-resend session cleanup failed");
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned email-resend session cleanup failed; original failure preserved; lead must inspect scoped cleanup.",
    });
  }
});
