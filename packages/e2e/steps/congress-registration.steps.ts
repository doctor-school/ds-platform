import {
  hostCommand,
  isAuthCommandPath,
  isSignInHostForm,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import {
  expectEnteredThrough,
  watchStorefrontEntries,
} from "../lib/storefront-entry-watch.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import {
  captchaTestTokenFromEnv,
  prepareCaptchaForJourney,
} from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryMail,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  readOwnedCongressSnapshot,
  type CongressObservationContour,
  type CongressSnapshot,
} from "../lib/owned-congress-observation.js";
import {
  assertNoPrivateRegistrationAccess,
  differentVerificationCode,
  inputSecret,
  registrationEvidence,
  registrationUrl,
  verificationEvidence,
  verificationRefusalEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { gatedPasswordLogin } from "../lib/gated-password-login.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface CongressRegistration extends OwnedCredentials {
  page: Page;
  contexts: BrowserContext[];
  contour: CongressObservationContour;
  displayName: "Иванова Мария";
  baseline?: CongressSnapshot;
  code?: string;
  accepted?: CapturedResponse;
  priorCookies: string[];
  authPosts: string[];
}
const registrations = new WeakMap<Page, CongressRegistration>();
function registration(key: Page): CongressRegistration {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned congress registration was not prepared");
  return state;
}
async function observe(state: CongressRegistration): Promise<CongressSnapshot> {
  return readOwnedCongressSnapshot(state.contour, {
    email: state.email,
    displayName: state.displayName,
  });
}
async function identity(state: CongressRegistration): Promise<void> {
  if (!state.baseline)
    throw new Error("Owned congress identity was not observed");
  const evidence = await state.page.evaluate(
    async ({ email, displayName, subject }) => {
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
        profileStatus: profileResponse.status,
        sameEmail: profile.email === email,
        verified: profile.emailVerified === true,
        sameName: profile.displayName === displayName,
        phoneAbsent: profile.phone === null,
        sessionStatus: sessionResponse.status,
        sameSubject: session.sub === subject,
        doctorGuest:
          Array.isArray(session.roles) &&
          session.roles.includes("doctor_guest"),
      };
    },
    {
      email: state.email,
      displayName: state.displayName,
      subject: state.baseline.subject,
    },
  );
  expect(
    evidence,
    "same verified congress identity and existing profile",
  ).toEqual({
    profileStatus: 200,
    sameEmail: true,
    verified: true,
    sameName: true,
    phoneAbsent: true,
    sessionStatus: 200,
    sameSubject: true,
    doctorGuest: true,
  });
}
async function passwordProbe(
  page: Page,
  base: string,
  state: CongressRegistration,
  accepted: boolean,
): Promise<void> {
  await page.goto(`${base}/login?returnTo=%2Faccount`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await inputSecret(
    page.locator('input[autocomplete="username"]'),
    state.email,
  );
  await inputSecret(
    page.locator('input[autocomplete="current-password"]'),
    state.password,
  );
  const submitted = await gatedPasswordLogin(page, base, async () => {
    const pending = captureResponse(page, signInHostApiPath("/v1/auth/login"));
    await page.getByTestId("password-login-submit").click();
    return pending;
  });
  let intended = false;
  try {
    const body = hostCommand(submitted.response.request().postDataJSON());
    intended =
      body.identifier === state.email && body.password === state.password;
  } catch {
    /* Discard diagnostics that could quote credentials. */
  }
  expect(intended, "password probe submitted the owned credentials").toBe(true);
  if (accepted) {
    expect(
      submitted.response.status(),
      "submitted password accepted after code",
    ).toBe(200);
    await page.waitForURL(
      (url) =>
        url.origin === new URL(base).origin && url.pathname === "/account",
    );
    await page.waitForLoadState("networkidle");
    await assertSecureSession(
      page,
      submitted.response,
      base,
      state.priorCookies,
    );
    return;
  }
  let refusal = false;
  try {
    const body = JSON.parse(submitted.body);
    refusal =
      Object.keys(body).length === 3 &&
      body.statusCode === 401 &&
      body.message === "invalid credentials" &&
      body.error === "Unauthorized";
  } catch {
    /* Discard credential-bearing response diagnostics. */
  }
  expect(
    { status: submitted.response.status(), refusal },
    "password unusable before accepted code",
  ).toEqual({ status: 401, refusal: true });
  expect(new URL(page.url()).pathname).toBe("/login");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Не удалось войти. Проверьте данные и попробуйте снова.",
    }),
  ).toBeVisible();
  await assertNoPrivateRegistrationAccess(
    page,
    (await submitted.response.headerValue("set-cookie")) ?? "",
    state,
  );
}

Given(
  "a uniquely owned passwordless unverified congress signup has its original profile and congress consent observed",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: CongressRegistration = {
      page: owned,
      contexts: [context],
      email: `congress-registration-2927-${randomUUID()}@example.test`,
      password: `Congress-${randomUUID()}-aA1!`,
      displayName: "Иванова Мария",
      priorCookies: [],
      authPosts: [],
      contour: {
        academyBaseUrl: world.hostBaseUrl,
        apiBaseUrl: process.env.E2E_API_URL ?? "",
        databaseUrl: process.env.E2E_AUTH_DATABASE_URL ?? "",
        expectedDatabase: process.env.E2E_AUTH_DATABASE_NAME ?? "",
        expectedDatabaseHost: process.env.E2E_AUTH_DATABASE_HOST ?? "",
        expectedDatabasePort: Number(process.env.E2E_AUTH_DATABASE_PORT),
      },
    };
    registrations.set(page, state);
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await owned.goto(registrationUrl(world.hostBaseUrl, "/account"), {
      waitUntil: "load",
    });
    await owned.waitForLoadState("networkidle");
    const captchaToken =
      new URL(world.hostBaseUrl).protocol === "http:" &&
      process.env.BOT_PROTECTION_ENABLED === "false"
        ? undefined
        : captchaTestTokenFromEnv();
    const signup = await owned.evaluate(
      async ({ email, captchaToken }) => {
        const book = await fetch("/v1/public/specialties", {
          cache: "no-store",
        });
        const body = await book.json().catch(() => ({}));
        const specialtyId = body.entries?.[0]?.id;
        if (book.status !== 200 || typeof specialtyId !== "string")
          return {
            specialties: false,
            status: 0,
            accepted: false,
            referencePresent: false,
          };
        const response = await fetch("/v1/congress/sign-up", {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            ...(captchaToken ? { "x-smartcaptcha-token": captchaToken } : {}),
          },
          body: JSON.stringify({
            surname: "Иванова",
            firstName: "Мария",
            patronymic: "Петровна",
            email,
            specialtyId,
            workplace: "ГКБ № 1",
            city: "Москва",
            region: "Москва",
            contactPhone: "+7 (900) 123-45-67",
            personalDataConsent: true,
          }),
        });
        const result = await response.json().catch(() => ({}));
        return {
          specialties: true,
          status: response.status,
          accepted: result.status === "accepted",
          referencePresent:
            typeof result.handoff === "string" && result.handoff.length > 0,
        };
      },
      { email: state.email, captchaToken },
    );
    expect(
      signup,
      "real configured congress intake accepted an owned signup",
    ).toEqual({
      specialties: true,
      status: 200,
      accepted: true,
      referencePresent: true,
    });
    await assertNoPrivateRegistrationAccess(owned, "", state);
    state.baseline = await observe(state);
    expect(
      {
        verified: state.baseline.emailVerified,
        purposes: state.baseline.consents.map((consent) => consent.purpose),
        nameMatches: state.baseline.displayNameMatches,
        intakeCreated: state.baseline.createdByIntake,
      },
      "passwordless congress prerequisite and distinct congress consent",
    ).toEqual({
      verified: false,
      purposes: ["congress-personal-data"],
      nameMatches: true,
      intakeCreated: true,
    });
  },
);

When(
  "that congress account registers through Academy with a new policy-conforming password and the accepted platform terms",
  async ({ page, world }) => {
    const state = registration(page);
    const owned = state.page;
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && isAuthCommandPath(pathname))
        state.authPosts.push(pathname);
    });
    watchStorefrontEntries(owned, world.hostBaseUrl);
    await owned.goto(registrationUrl(world.hostBaseUrl, "/account"), {
      waitUntil: "load",
    });
    await owned.waitForLoadState("networkidle");
    await inputSecret(
      owned.locator('input[autocomplete="email"]'),
      state.email,
    );
    await inputSecret(
      owned.locator('input[autocomplete="new-password"]'),
      state.password,
    );
    await expect(owned.getByRole("checkbox")).toHaveCount(0);
    await expect(
      owned
        .getByTestId("registration-form")
        .getByText(/^Продолжая, вы соглашаетесь/),
    ).toBeVisible();
    const mailbox =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mailbox,
      state.email,
    );
    const pending = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/register"),
    );
    await owned.getByTestId("register-submit").click();
    const submitted = await pending;
    expect(
      submitted.response.status(),
      "neutral existing-account registration",
    ).toBe(200);
    expect(
      registrationEvidence(
        submitted.response.request().postData() ?? "",
        submitted.body,
        state,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    // #3172 — the code step is the sign-in host's `/verify`; the account
    // return path rode the storefront's registration entry.
    await owned.waitForURL(
      (url) => isSignInHostForm(url) && url.pathname === "/verify",
    );
    await owned.waitForLoadState("networkidle");
    expectEnteredThrough(owned, world.hostBaseUrl, {
      pathname: "/register",
      returnTo: "/account",
    });
    await assertNoPrivateRegistrationAccess(
      owned,
      (await submitted.response.headerValue("set-cookie")) ?? "",
      state,
    );
    const mail = await fetchRecoveryMail(
      nativeRecoveryMail(),
      mailbox,
      state.email,
      before,
      "login",
    );
    state.code = mail.code;
    expect(
      {
        sixDigits: /^\d{6}$/.test(mail.code),
        completeBodies:
          typeof mail.text === "string" &&
          mail.text.includes(mail.code) &&
          typeof mail.html === "string" &&
          mail.html.includes(mail.code),
      },
      "fresh addressed re-registration code delivered",
    ).toEqual({ sixDigits: true, completeBodies: true });
    expect(
      (await owned
        .locator('input[autocomplete="one-time-code"]')
        .inputValue()) === "",
      "delivered code remains unconsumed",
    ).toBe(true);
  },
);

Then(
  "a different congress registration code is refused without changing the profile, intake or consent and the submitted password still has no private access",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    const state = registration(page);
    if (!state.code) throw new Error("Owned congress code was not delivered");
    expect(
      JSON.stringify(await observe(state)) === JSON.stringify(state.baseline),
      "exact congress state unchanged before code submission",
    ).toBe(true);
    const wrong = differentVerificationCode(state.code);
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      wrong,
    );
    const refused = await pending;
    expect(refused.response.status(), "wrong congress code refused").toBe(400);
    expect(
      verificationRefusalEvidence(
        refused.response.request().postData() ?? "",
        refused.body,
        state,
        state.code,
        wrong,
      ),
    ).toEqual({
      credentialsMatch: true,
      wrongCode: true,
      refusalMatches: true,
    });
    expect(new URL(state.page.url()).pathname).toBe("/verify");
    await expect(
      state.page.getByRole("alert").filter({
        hasText: "Код не подошёл. Проверьте его или запросите новый.",
      }),
    ).toBeVisible();
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await refused.response.headerValue("set-cookie")) ?? "",
      state,
    );
    await expect
      .poll(
        async () =>
          (await state.page
            .locator('input[autocomplete="one-time-code"]')
            .inputValue()) === "",
        { message: "refused congress code cleared before actual confirmation" },
      )
      .toBe(true);
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    state.contexts.push(context);
    const guest = await context.newPage();
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await passwordProbe(guest, world.hostBaseUrl, state, false);
    expect(
      JSON.stringify(await observe(state)) === JSON.stringify(state.baseline),
      "exact identity, profile, congress intake and consent unchanged before code",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
    await test.info().attach("congress-refused-code", {
      body: await state.page.screenshot({
        mask: [
          state.page.locator("input"),
          state.page.getByText(state.email, { exact: true }),
          state.page.getByText(state.displayName, { exact: true }),
        ],
      }),
      contentType: "image/png",
    });
  },
);

When(
  "that congress registrant enters its delivered code once in the requesting Academy tab",
  async ({ page, world }) => {
    const state = registration(page);
    if (!state.code) throw new Error("Owned congress code was not delivered");
    const pending = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    state.accepted = await pending;
    expect(
      state.accepted.response.status(),
      "owned congress code accepted",
    ).toBe(200);
    expect(
      verificationEvidence(
        state.accepted.response.request().postData() ?? "",
        state.accepted.body,
        state,
        state.code,
        world.hostBaseUrl,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
  },
);

Then(
  "the accepted congress registration code opens the same verified profile and a secure BFF session at the account return target",
  async ({ page, world }) => {
    const state = registration(page);
    if (!state.accepted)
      throw new Error("Owned congress code was not accepted");
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(
      state.page,
      state.accepted.response,
      world.hostBaseUrl,
    );
    await identity(state);
    expect(
      state.authPosts,
      "one registration, one refused code and one accepted code without password replay",
    ).toEqual([
      signInHostApiPath("/v1/auth/register"),
      signInHostApiPath("/v1/auth/verify"),
      signInHostApiPath("/v1/auth/verify"),
    ]);
  },
);

Then(
  "the original congress profile, intake and consent survive and exactly one new platform consent is recorded after that code",
  async ({ page }) => {
    const state = registration(page);
    if (!state.baseline)
      throw new Error("Owned congress baseline was not observed");
    const current = await observe(state);
    const original = current.consents.filter(
      (consent) => consent.purpose === "congress-personal-data",
    );
    const platform = current.consents.filter(
      (consent) => consent.purpose === "tos",
    );
    expect(
      {
        sameUser: current.userId === state.baseline.userId,
        sameSubject: current.subject === state.baseline.subject,
        verified: current.emailVerified,
        sameProfile:
          current.profileFingerprint === state.baseline.profileFingerprint,
        sameIntake:
          current.registrationFingerprint ===
          state.baseline.registrationFingerprint,
        sameCongressConsent:
          JSON.stringify(original) === JSON.stringify(state.baseline.consents),
        consentCount: current.consents.length,
        platformCount: platform.length,
        platformVersion: platform[0]?.version,
        newConsent: platform[0]?.id !== original[0]?.id,
      },
      "only verification and new platform consent changed after accepted code",
    ).toEqual({
      sameUser: true,
      sameSubject: true,
      verified: true,
      sameProfile: true,
      sameIntake: true,
      sameCongressConsent: true,
      consentCount: 2,
      platformCount: 1,
      platformVersion: "2026-01",
      newConsent: true,
    });
  },
);

Then(
  "after an explicit logout the congress registrant signs into that same named account with the submitted password",
  async ({ page, world }) => {
    const state = registration(page);
    state.priorCookies = (await state.page.context().cookies())
      .filter((cookie) => cookie.name === SESSION)
      .map((cookie) => cookie.value);
    const pending = captureResponse(state.page, "/v1/auth/logout");
    await state.page.getByTestId("logout").click();
    const loggedOut = await pending;
    expect(
      loggedOut.response.status(),
      "ordinary explicit congress-account logout",
    ).toBe(200);
    const cleared = (await loggedOut.response.headerValue("set-cookie")) ?? "";
    expect(
      cleared.includes(`${SESSION}=`) &&
        /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cleared),
      "logout expires code session",
    ).toBe(true);
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/",
    );
    await assertNoPrivateRegistrationAccess(state.page, "", state);
    await passwordProbe(state.page, world.hostBaseUrl, state, true);
    await identity(state);
    await expect(state.page.getByTestId("profile-email")).toBeVisible();
    await expect(state.page.getByTestId("profile-name")).toBeVisible();
    await test.info().attach("congress-password-signin", {
      body: await state.page.screenshot({
        mask: [
          state.page.locator("input"),
          state.page.getByTestId("profile-email"),
          state.page.getByTestId("profile-name"),
          state.page.getByText(state.email, { exact: true }),
          state.page.getByText(state.displayName, { exact: true }),
        ],
      }),
      contentType: "image/png",
    });
  },
);

After("@congress-registration", async ({ page }) => {
  const state = registrations.get(page);
  if (!state) return;
  try {
    for (const context of state.contexts) {
      if ((await context.cookies()).some((cookie) => cookie.name === SESSION)) {
        const result = await context.pages()[0]!.evaluate(async () => {
          const logout = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
          });
          return { logout: logout.status, profile: profile.status };
        });
        expect(result, "owned congress session revoked").toEqual({
          logout: 200,
          profile: 401,
        });
      }
    }
  } finally {
    for (const context of state.contexts) {
      await Promise.all(context.pages().map((owned) => owned.close()));
      await context.close();
    }
    registrations.delete(page);
  }
});
