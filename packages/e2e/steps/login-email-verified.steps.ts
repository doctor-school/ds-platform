import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { STOREFRONT_SIGN_OUT_PATH } from "../lib/storefront-sign-out.js";
import {
  assertNoVerificationMail,
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
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface VerifiedLogin extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  subject?: string;
  priorCookies: string[];
  before?: AddressedMailCheckpoint;
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
    state.before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
    );
    const requested = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/login/otp/request"),
    ).then(({ response, body }) => {
      let matches = false;
      try {
        const request = hostCommand(response.request().postDataJSON());
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
  "an incomplete four-digit sign-in code is refused in the browser without a login request",
  async ({ page }) => {
    // 003 EARS-22 (#2899): the code step's client rule is the six-digit
    // contract, so Enter on four digits shows «Введите код.», keeps the digits
    // and sends nothing to /v1/auth/login/otp.
    const state = login(page);
    const submitted: string[] = [];
    const watch = (request: { url(): string }) => {
      if (request.url().includes(signInHostApiPath("/v1/auth/login/otp"))) {
        submitted.push(request.url());
      }
    };
    state.page.on("request", watch);
    try {
      const field = state.page.locator('input[autocomplete="one-time-code"]');
      await field.click();
      await state.page.keyboard.type("1234");
      await state.page.keyboard.press("Enter");
      await expect(state.page.getByText("Введите код.")).toBeVisible();
      await expect(field).toHaveValue("1234");
      // The field error is the resolver's refusal: handleSubmit never reached
      // the submit handler, so no request can still be in flight.
      expect(submitted, "no login-code request for an incomplete code").toEqual(
        [],
      );
    } finally {
      state.page.off("request", watch);
    }
  },
);

Then(
  "fresh addressed sign-in mail is delivered for the verified account without verification mail",
  async ({ page, world }) => {
    const state = login(page);
    if (!state.before)
      throw new Error(
        "Verified login-code mailbox checkpoint was not captured",
      );
    const mail = nativeRecoveryMail();
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    state.code = await fetchRecoveryCode(
      mail,
      mailpit,
      state.email,
      state.before,
      "login",
    );
    expect(
      /^\d{6}$/.test(state.code),
      "fresh addressed sign-in code has six digits",
    ).toBe(true);
    await assertNoVerificationMail(mail, mailpit, state.email, state.before);
  },
);

When(
  "the owned verified account submits that delivered sign-in code",
  async ({ page, world }) => {
    const state = login(page);
    if (!state.code) throw new Error("Verified sign-in mail has not been read");
    const accepted = captureResponse(
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
