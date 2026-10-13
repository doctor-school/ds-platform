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
  fetchRecoveryMail,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  readOwnedConsentSnapshot,
  type OwnedAuthContour,
  type OwnedConsentSnapshot,
} from "../lib/owned-auth-observation.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  registrationUrl,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface ConsentRegistration extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  contour: OwnedAuthContour;
  typedEmail: string;
  replacementPassword: string;
  subject?: string;
  baseline?: OwnedConsentSnapshot;
  priorCookies: string[];
  authPosts: string[];
  requestedAt?: string;
  code?: string;
  accepted?: Response;
}
const registrations = new WeakMap<Page, ConsentRegistration>();
function registration(key: Page): ConsentRegistration {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned consent registration was not prepared");
  return state;
}

async function privateIdentity(state: ConsentRegistration): Promise<void> {
  const observed = await state.page.evaluate(
    async ({ email, subject }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await response.json().catch(() => ({}));
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const claims = await session.json().catch(() => ({}));
      return {
        subject: typeof claims.sub === "string" ? claims.sub : undefined,
        evidence: {
          profileStatus: response.status,
          sameEmail: profile.email === email,
          verified: profile.emailVerified === true,
          phoneAbsent: profile.phone === null,
          phoneVerificationAbsent: profile.phoneVerified === null,
          displayNameAbsent: profile.displayName === null,
          sessionStatus: session.status,
          subjectPresent:
            typeof claims.sub === "string" && claims.sub.length > 0,
          sameSubject: subject === undefined || claims.sub === subject,
          doctorGuest:
            Array.isArray(claims.roles) &&
            claims.roles.includes("doctor_guest"),
        },
      };
    },
    { email: state.email, subject: state.subject },
  );
  expect(
    observed.evidence,
    "same owned verified private profile and subject",
  ).toEqual({
    profileStatus: 200,
    sameEmail: true,
    verified: true,
    phoneAbsent: true,
    phoneVerificationAbsent: true,
    displayNameAbsent: true,
    sessionStatus: 200,
    subjectPresent: true,
    sameSubject: true,
    doctorGuest: true,
  });
  state.subject = observed.subject;
}

async function consentSnapshot(
  state: ConsentRegistration,
): Promise<OwnedConsentSnapshot> {
  return readOwnedConsentSnapshot(state.contour, {
    email: state.email,
    subject: state.subject,
    profileId: state.baseline?.profileId,
  });
}

async function unchangedConsent(state: ConsentRegistration): Promise<void> {
  if (!state.baseline)
    throw new Error("Owned consent baseline was not observed");
  const current = await consentSnapshot(state);
  expect(
    Object.entries(state.baseline).every(
      ([key, value]) => current[key as keyof OwnedConsentSnapshot] === value,
    ),
    "owned consent ID/count/purpose/version/exact timestamp and relevant user mirrors unchanged",
  ).toBe(true);
}

Given(
  "a uniquely owned verified Academy account is logged out with its existing platform consent observed",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const email = `consent-2856-${randomUUID()}@example.test`;
    const state: ConsentRegistration = {
      context,
      page: owned,
      email,
      password: `Consent-${randomUUID()}-aA1!`,
      replacementPassword: `Replacement-${randomUUID()}-aA1!`,
      typedEmail: email
        .replace("consent", "Consent")
        .replace("@example.test", "@Example.Test"),
      contour: {
        academyBaseUrl: world.hostBaseUrl,
        apiBaseUrl: process.env.E2E_API_URL ?? "",
        databaseUrl: process.env.E2E_AUTH_DATABASE_URL ?? "",
        expectedDatabase: process.env.E2E_AUTH_DATABASE_NAME ?? "",
      },
      priorCookies: [],
      authPosts: [],
    };
    registrations.set(page, state);
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const initial = captureResponse(owned, "/v1/auth/register");
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const registered = await initial;
    expect(
      registrationEvidence(
        registered.response.request().postData() ?? "",
        registered.body,
        state,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    await assertNoPrivateRegistrationAccess(
      owned,
      (await registered.response.headerValue("set-cookie")) ?? "",
      state,
    );
    const pending = captureResponse(owned, "/v1/auth/verify");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const accepted = await pending;
    expect(accepted.response.status(), "owned prerequisite code accepted").toBe(
      200,
    );
    expect(
      verificationEvidence(
        accepted.response.request().postData() ?? "",
        accepted.body,
        state,
        code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, accepted.response, world.hostBaseUrl);
    await privateIdentity(state);
    state.priorCookies = (await context.cookies())
      .filter((cookie) => cookie.name === SESSION)
      .map((cookie) => cookie.value);
    const pendingLogout = captureResponse(owned, "/v1/auth/logout");
    await owned.getByTestId("logout").click();
    const loggedOut = await pendingLogout;
    expect(loggedOut.response.status(), "ordinary owned account logout").toBe(
      200,
    );
    const cleared = (await loggedOut.response.headerValue("set-cookie")) ?? "";
    expect(
      cleared.includes(`${SESSION}=`) &&
        /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cleared),
      "logout expires private session",
    ).toBe(true);
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/",
    );
    await assertNoPrivateRegistrationAccess(owned, "", state);
    state.baseline = await consentSnapshot(state);
    expect(
      {
        count: state.baseline.consentCount,
        purpose: state.baseline.purpose,
        version: state.baseline.version,
        verified: state.baseline.emailVerified,
        emailMatches: state.baseline.emailMatches,
        subjectMatches: state.baseline.subjectMatches,
      },
      "existing owned platform consent prerequisite",
    ).toEqual({
      count: 1,
      purpose: "tos",
      version: "2026-01",
      verified: true,
      emailMatches: true,
      subjectMatches: true,
    });
  },
);

When(
  "that verified account re-registers through Academy with its mixed-case email, a different password and the read-only accepted terms",
  async ({ page, world }) => {
    const state = registration(page);
    await state.page.goto(registrationUrl(world.hostBaseUrl, "/account"), {
      waitUntil: "load",
    });
    await state.page.waitForLoadState("networkidle");
    await inputSecret(
      state.page.locator('input[autocomplete="email"]'),
      state.typedEmail,
    );
    await inputSecret(
      state.page.locator('input[autocomplete="new-password"]'),
      state.replacementPassword,
    );
    await expect(state.page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      state.page
        .getByTestId("registration-form")
        .getByText(/^Продолжая, вы соглашаетесь/),
    ).toBeVisible();
    state.requestedAt = new Date().toISOString();
    const pending = captureResponse(state.page, "/v1/auth/register");
    await state.page.getByTestId("register-submit").click();
    const registered = await pending;
    expect(
      registered.response.status(),
      "neutral re-registration acknowledgement",
    ).toBe(200);
    expect(
      registrationEvidence(
        registered.response.request().postData() ?? "",
        registered.body,
        { email: state.typedEmail, password: state.replacementPassword },
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/verify",
    );
    await state.page.waitForLoadState("networkidle");
    expect(
      new URL(state.page.url()).searchParams.get("email") === state.typedEmail,
      "code step preserves mixed-case submitted email",
    ).toBe(true);
    expect(new URL(state.page.url()).searchParams.get("returnTo")).toBe(
      "/account",
    );
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await registered.response.headerValue("set-cookie")) ?? "",
      { email: state.typedEmail, password: state.replacementPassword },
    );
  },
);

Then(
  "fresh addressed re-registration mail is delivered while the original consent and private-access refusal remain unchanged",
  async ({ page, world }) => {
    const state = registration(page);
    if (!state.requestedAt)
      throw new Error("Owned re-registration request was not observed");
    const mail = await fetchRecoveryMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.requestedAt,
      "login",
    );
    state.code = mail.code;
    expect(
      {
        sixDigits: /^\d{6}$/.test(mail.code),
        bothBodies:
          typeof mail.text === "string" &&
          mail.text.includes(mail.code) &&
          typeof mail.html === "string" &&
          mail.html.includes(mail.code),
        alreadyRegistered:
          typeof mail.text === "string" &&
          mail.text.includes(
            "Этот адрес уже зарегистрирован в Doctor.School",
          ) &&
          typeof mail.html === "string" &&
          mail.html.includes("Этот адрес уже зарегистрирован в Doctor.School"),
      },
      "fresh owned re-registration code mail",
    ).toEqual({ sixDigits: true, bothBodies: true, alreadyRegistered: true });
    expect(
      (await state.page
        .locator('input[autocomplete="one-time-code"]')
        .inputValue()) === "",
      "re-registration code remains unconsumed",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(state.page, "", {
      email: state.typedEmail,
      password: state.replacementPassword,
    });
    await unchangedConsent(state);
  },
);

When(
  "that registrant enters the delivered re-registration code once in the requesting Academy tab",
  async ({ page }) => {
    const state = registration(page);
    if (!state.code)
      throw new Error("Owned re-registration code was not delivered");
    const pending = captureResponse(state.page, "/v1/auth/verify");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    const accepted = await pending;
    expect(
      accepted.response.status(),
      "owned re-registration code accepted once",
    ).toBe(200);
    expect(
      verificationEvidence(
        accepted.response.request().postData() ?? "",
        accepted.body,
        { email: state.typedEmail, password: state.replacementPassword },
        state.code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
    state.accepted = accepted.response;
  },
);

Then(
  "that one code opens the same verified profile and secure session at the account return target without password replay",
  async ({ page, world }) => {
    const state = registration(page);
    if (!state.accepted)
      throw new Error("Owned re-registration was not accepted");
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(
      state.page,
      state.accepted,
      world.hostBaseUrl,
      state.priorCookies,
    );
    await privateIdentity(state);
    expect(
      state.authPosts,
      "exactly prerequisite registration/code/logout and re-registration/code, without sign-in replay",
    ).toEqual([
      "/v1/auth/register",
      "/v1/auth/verify",
      "/v1/auth/logout",
      "/v1/auth/register",
      "/v1/auth/verify",
    ]);
  },
);

Then(
  "the owned consent row ID, count, version and exact captured timestamp and relevant user mirrors are still identical",
  async ({ page }) => {
    await unchangedConsent(registration(page));
  },
);

After("@registration-consent-preservation", async ({ page }) => {
  const state = registrations.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some((cookie) => cookie.name === SESSION)
    ) {
      const result = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(result, "owned consent-preservation session revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
    await state.context.close();
    registrations.delete(page);
  }
});
