import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoVerificationMail,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
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
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface VerifiedLogin extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  subject?: string;
  priorCookies: string[];
  requestedAt?: string;
  code?: string;
  request?: { response: Response; matches: boolean };
  accepted?: { response: Response; matches: boolean };
}
const logins = new WeakMap<Page, VerifiedLogin>();
function login(key: Page): VerifiedLogin {
  const state = logins.get(key);
  if (!state) throw new Error("Owned verified login account was not prepared");
  return state;
}

async function assertOwnedVerifiedIdentity(state: VerifiedLogin) {
  const result = await state.page.evaluate(
    async ({ email, subject }) => {
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
        subject: typeof session.sub === "string" ? session.sub : undefined,
        evidence: {
          profileStatus: profileResponse.status,
          sameEmail: profile.email === email,
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
    { email: state.email, subject: state.subject },
  );
  expect(
    result.evidence,
    "private profile belongs to the same verified owned identity",
  ).toEqual({
    profileStatus: 200,
    sameEmail: true,
    emailVerified: true,
    sessionStatus: 200,
    subjectPresent: true,
    sameSubject: true,
    doctorGuest: true,
  });
  state.subject = result.subject;
}

Given(
  "a uniquely registered and verified Academy doctor_guest account is logged out for an email-code request",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: VerifiedLogin = {
      context,
      page: owned,
      email: `verified-login-2794-${randomUUID()}@example.test`,
      password: `Verified-${randomUUID()}-aA1!`,
      priorCookies: [],
    };
    logins.set(page, state);
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { response, code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
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
    const verified = captureResponse(owned, "/v1/auth/verify").then(
      ({ response, body }) => ({
        response,
        evidence: verificationEvidence(
          response.request().postData() ?? "",
          body,
          state,
          code,
        ),
      }),
    );
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

    const loggedOut = captureResponse(owned, "/v1/auth/logout");
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

When(
  "the owned verified account requests its email login code through the Academy form",
  async ({ page, world }) => {
    const state = login(page);
    const target = new URL(world.host.loginPath, world.hostBaseUrl);
    target.searchParams.set("returnTo", "/account");
    await state.page.goto(target.toString(), { waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await state.page.getByTestId("login-method-otp").click();
    await state.page.getByTestId("otp-channel-email").click();
    await inputSecret(state.page.getByTestId("otp-identifier"), state.email);
    state.requestedAt = new Date().toISOString();
    const requested = captureResponse(
      state.page,
      "/v1/auth/login/otp/request",
    ).then(({ response, body }) => {
      let matches = false;
      try {
        const request = response.request().postDataJSON();
        matches =
          request.identifier === state.email &&
          request.channel === "email" &&
          body === '{"status":"otp_sent"}';
      } catch {
        // Discard credential-bearing parser diagnostics.
      }
      return { response, matches };
    });
    await state.page.getByTestId("otp-send").click();
    state.request = await requested;
  },
);

Then(
  "the verified-account request shows the neutral six-cell code step without a private session",
  async ({ page }) => {
    const state = login(page);
    expect(
      state.request?.response.status(),
      "verified login-code request status",
    ).toBe(200);
    expect(
      state.request?.matches,
      "owned identifier receives only the neutral acknowledgement",
    ).toBe(true);
    await expect(
      state.page.locator('input[autocomplete="one-time-code"]'),
    ).toBeVisible();
    await expect(
      state.page.locator('input[autocomplete="one-time-code"]'),
    ).toHaveAttribute("maxlength", "6");
    await expect(
      state.page.locator("[data-input-otp-container] > div:first-child > div"),
    ).toHaveCount(6);
    await expect(state.page.getByTestId("otp-send")).toHaveCount(0);
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await state.request!.response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

Then(
  "fresh addressed sign-in mail is delivered for the verified account without verification mail",
  async ({ page, world }) => {
    const state = login(page);
    if (!state.requestedAt)
      throw new Error("Verified login-code request time was not captured");
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    state.code = await fetchRecoveryCode(
      mail,
      mailpit,
      state.email,
      state.requestedAt,
      "login",
    );
    expect(
      /^\d{6}$/.test(state.code),
      "fresh addressed sign-in code has six digits",
    ).toBe(true);
    await assertNoVerificationMail(
      mail,
      mailpit,
      state.email,
      state.requestedAt,
    );
  },
);

When(
  "the owned verified account submits that delivered sign-in code",
  async ({ page }) => {
    const state = login(page);
    if (!state.code) throw new Error("Verified sign-in mail has not been read");
    const accepted = captureResponse(state.page, "/v1/auth/login/otp").then(
      ({ response, body }) => {
        let matches = false;
        try {
          const request = response.request().postDataJSON();
          matches =
            request.identifier === state.email &&
            request.channel === "email" &&
            request.code === state.code &&
            Object.keys(request).length === 3 &&
            body === '{"status":"authenticated"}';
        } catch {
          // Discard code-bearing parser diagnostics.
        }
        return { response, matches };
      },
    );
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    state.accepted = await accepted;
  },
);

Then(
  "the accepted login code restores a secure private session for the same verified identity",
  async ({ page, world }) => {
    const state = login(page);
    expect(
      state.accepted?.response.status(),
      "fresh delivered login code accepted",
    ).toBe(200);
    expect(
      state.accepted?.matches,
      "only the owned login code is submitted and no token is returned",
    ).toBe(true);
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(
      state.page,
      state.accepted!.response,
      world.hostBaseUrl,
      state.priorCookies,
    );
    await assertOwnedVerifiedIdentity(state);
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "account surface shows the same verified email",
    ).toBe(true);
    await expect(
      state.page.getByTestId("profile-email-verified"),
    ).toBeVisible();
  },
);

After("@verified-login-email-code", async ({ page }) => {
  const state = logins.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some((cookie) => cookie.name === SESSION)
    ) {
      const revoked = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(revoked, "owned verified-login session revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
    await state.context.close();
    logins.delete(page);
  }
});
