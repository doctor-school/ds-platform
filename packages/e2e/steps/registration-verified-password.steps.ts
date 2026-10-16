import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import {
  fetchRecoveryMail,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
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
import { gatedPasswordLogin } from "../lib/gated-password-login.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface VerifiedRegistration extends OwnedCredentials {
  page: Page;
  contexts: BrowserContext[];
  replacementPassword: string;
  displayName: string;
  subject?: string;
  priorCookies: string[];
  authPosts: string[];
  requestedAt?: string;
  code?: string;
  accepted?: CapturedResponse;
}
const registrations = new WeakMap<Page, VerifiedRegistration>();
function registration(key: Page): VerifiedRegistration {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned verified registration was not prepared");
  return state;
}

async function privateIdentity(
  page: Page,
  state: VerifiedRegistration,
): Promise<void> {
  const observed = await page.evaluate(
    async ({ email, displayName, subject }) => {
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
          sameName: profile.displayName === displayName,
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
    {
      email: state.email,
      displayName: state.displayName,
      subject: state.subject,
    },
  );
  expect(
    observed.evidence,
    "same owned verified identity and original name",
  ).toEqual({
    profileStatus: 200,
    sameEmail: true,
    verified: true,
    sameName: true,
    sessionStatus: 200,
    subjectPresent: true,
    sameSubject: true,
    doctorGuest: true,
  });
  state.subject = observed.subject;
}

Given(
  "a uniquely owned verified Academy password holder has saved an original display name and logged out",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: VerifiedRegistration = {
      page: owned,
      contexts: [context],
      email: `verified-password-2904-${randomUUID()}@example.test`,
      password: `Original-${randomUUID()}-aA1!`,
      replacementPassword: `Replacement-${randomUUID()}-aA1!`,
      displayName: "Вера Петрова",
      priorCookies: [],
      authPosts: [],
    };
    registrations.set(page, state);
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
    const confirmation = captureResponse(owned, "/v1/auth/verify");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const accepted = await confirmation;
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
    await owned.getByTestId("profile-name-edit").click();
    await inputSecret(
      owned.getByTestId("profile-name-input"),
      state.displayName,
    );
    const saved = owned
      .waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          new URL(response.url()).pathname === "/v1/me/display-name",
      )
      .then(async (response) => {
        let bodyMatches = false;
        try {
          const body = response.request().postDataJSON();
          bodyMatches =
            Object.keys(body).length === 1 &&
            body.displayName === state.displayName;
        } catch {
          // Discard parser diagnostics that could quote private request bytes.
        }
        return {
          status: response.status(),
          bodyMatches,
          authenticated: (
            (await response.request().headerValue("cookie")) ?? ""
          ).includes(`${SESSION}=`),
        };
      });
    await owned.getByTestId("profile-name-save").click();
    expect(
      await saved,
      "original name saved through ordinary authenticated UI",
    ).toEqual({ status: 200, bodyMatches: true, authenticated: true });
    await expect
      .poll(
        async () =>
          (await owned.getByTestId("profile-name").textContent()) ===
          state.displayName,
        { message: "original name rendered" },
      )
      .toBe(true);
    await privateIdentity(owned, state);
    state.priorCookies = (await context.cookies())
      .filter((cookie) => cookie.name === SESSION)
      .map((cookie) => cookie.value);
    const pendingLogout = captureResponse(owned, "/v1/auth/logout");
    await owned.getByTestId("logout").click();
    const loggedOut = await pendingLogout;
    expect(loggedOut.response.status(), "ordinary prerequisite logout").toBe(
      200,
    );
    const cleared = (await loggedOut.response.headerValue("set-cookie")) ?? "";
    expect(
      cleared.includes(`${SESSION}=`) &&
        /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cleared),
      "logout expires prerequisite session",
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
  "an independent Academy guest re-registers that verified address with a distinct password and the account return target",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    const state = registration(page);
    expect(
      state.replacementPassword !== state.password,
      "replacement credentials differ",
    ).toBe(true);
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    state.contexts.push(context);
    const guest = await context.newPage();
    state.page = guest;
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    guest.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
    await guest.goto(registrationUrl(world.hostBaseUrl, "/account"), {
      waitUntil: "load",
    });
    await guest.waitForLoadState("networkidle");
    const repeated = {
      email: state.email,
      password: state.replacementPassword,
    };
    await assertNoPrivateRegistrationAccess(guest, "", repeated);
    await inputSecret(
      guest.locator('input[autocomplete="email"]'),
      repeated.email,
    );
    await inputSecret(
      guest.locator('input[autocomplete="new-password"]'),
      repeated.password,
    );
    await expect(guest.getByRole("checkbox")).toHaveCount(0);
    await expect(
      guest
        .getByTestId("registration-form")
        .getByText(/^Продолжая, вы соглашаетесь/),
    ).toBeVisible();
    state.requestedAt = new Date().toISOString();
    const pending = captureResponse(guest, "/v1/auth/register");
    await guest.getByTestId("register-submit").click();
    const registered = await pending;
    expect(
      registered.response.status(),
      "neutral verified re-registration acknowledgement",
    ).toBe(200);
    expect(
      registrationEvidence(
        registered.response.request().postData() ?? "",
        registered.body,
        repeated,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    await guest.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/verify",
    );
    await guest.waitForLoadState("networkidle");
    expect(
      new URL(guest.url()).searchParams.get("email") === state.email,
      "code step targets owned address",
    ).toBe(true);
    expect(new URL(guest.url()).searchParams.get("returnTo")).toBe("/account");
    await assertNoPrivateRegistrationAccess(
      guest,
      (await registered.response.headerValue("set-cookie")) ?? "",
      repeated,
    );
  },
);

Then(
  "fresh addressed mail says already registered and password unchanged in both complete bodies with an unconsumed six-digit code",
  async ({ page, world }) => {
    const state = registration(page);
    if (!state.requestedAt)
      throw new Error(
        "Owned verified re-registration request was not observed",
      );
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
        completeCodeBodies:
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
        passwordUnchanged:
          typeof mail.text === "string" &&
          mail.text.includes("Ваш пароль не изменился") &&
          typeof mail.html === "string" &&
          mail.html.includes("Ваш пароль не изменился"),
        linkFree:
          typeof mail.text === "string" &&
          typeof mail.html === "string" &&
          !/https?:\/\/|www\.|mailto:/i.test(mail.text) &&
          !/<a\b|<button\b|\bhref\s*=|https?:\/\/|www\.|mailto:/i.test(
            mail.html,
          ),
      },
      "truthful complete owned verified re-registration artifact",
    ).toEqual({
      sixDigits: true,
      completeCodeBodies: true,
      alreadyRegistered: true,
      passwordUnchanged: true,
      linkFree: true,
    });
    expect(
      (await state.page
        .locator('input[autocomplete="one-time-code"]')
        .inputValue()) === "",
      "delivered code remains unconsumed",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(state.page, "", {
      email: state.email,
      password: state.replacementPassword,
    });
  },
);

When(
  "that guest enters the delivered verified re-registration code once in its requesting Academy tab",
  async ({ page }) => {
    const state = registration(page);
    if (!state.code)
      throw new Error("Owned verified re-registration code was not delivered");
    const pending = captureResponse(state.page, "/v1/auth/verify");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    state.accepted = await pending;
    expect(
      state.accepted.response.status(),
      "verified re-registration code accepted once",
    ).toBe(200);
    expect(
      verificationEvidence(
        state.accepted.response.request().postData() ?? "",
        state.accepted.body,
        { email: state.email, password: state.replacementPassword },
        state.code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
  },
);

Then(
  "that code opens the same verified account and original name with a fresh secure session at the account return target without password replay",
  async ({ page, world }) => {
    const state = registration(page);
    if (!state.accepted)
      throw new Error("Owned verified re-registration was not accepted");
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
      state.priorCookies,
    );
    await privateIdentity(state.page, state);
    await expect
      .poll(
        async () =>
          (await state.page.getByTestId("profile-name").textContent()) ===
          state.displayName,
        { message: "original name remains rendered" },
      )
      .toBe(true);
    expect(
      state.authPosts,
      "one re-registration and accepted code without sign-in replay",
    ).toEqual(["/v1/auth/register", "/v1/auth/verify"]);
  },
);

Then(
  "independent guests sign into that same named account with the original password while the submitted replacement gets only generic refusal and no private access",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    const state = registration(page);
    for (const isOriginal of [true, false]) {
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
      const account = {
        email: state.email,
        password: isOriginal ? state.password : state.replacementPassword,
      };
      await guest.goto(`${world.hostBaseUrl}/login?returnTo=%2Faccount`, {
        waitUntil: "load",
      });
      await guest.waitForLoadState("networkidle");
      await assertNoPrivateRegistrationAccess(guest, "", account);
      await inputSecret(
        guest.locator('input[autocomplete="username"]'),
        account.email,
      );
      await inputSecret(
        guest.locator('input[autocomplete="current-password"]'),
        account.password,
      );
      const posts: string[] = [];
      guest.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
          posts.push(pathname);
      });
      const submitted = await gatedPasswordLogin(guest, async () => {
        const pending = captureResponse(guest, "/v1/auth/login");
        await guest.getByTestId("password-login-submit").click();
        return pending;
      });
      let credentialsMatch = false;
      try {
        const body = submitted.response.request().postDataJSON();
        credentialsMatch =
          body.identifier === state.email && body.password === account.password;
      } catch {
        // Discard parser diagnostics that could quote credentials.
      }
      expect(
        credentialsMatch,
        "password probe submits intended owned credentials",
      ).toBe(true);
      expect(posts, "one independent password login probe").toEqual([
        "/v1/auth/login",
      ]);
      if (isOriginal) {
        expect(
          submitted.response.status(),
          "original password remains accepted",
        ).toBe(200);
        await guest.waitForURL(
          (url) =>
            url.origin === new URL(world.hostBaseUrl).origin &&
            url.pathname === "/account",
        );
        await guest.waitForLoadState("networkidle");
        await assertSecureSession(
          guest,
          submitted.response,
          world.hostBaseUrl,
          state.priorCookies,
        );
        await privateIdentity(guest, state);
      } else {
        expect(
          submitted.response.status(),
          "replacement password remains refused",
        ).toBe(401);
        let genericRefusal = false;
        try {
          const body = JSON.parse(submitted.body);
          genericRefusal =
            Object.keys(body).length === 3 &&
            body.statusCode === 401 &&
            body.message === "invalid credentials" &&
            body.error === "Unauthorized";
        } catch {
          // Discard parser diagnostics that could quote credential-bearing bytes.
        }
        expect(genericRefusal, "complete generic password rejection").toBe(
          true,
        );
        expect(new URL(guest.url()).pathname).toBe("/login");
        await expect(
          guest.getByRole("alert").filter({
            hasText: "Не удалось войти. Проверьте данные и попробуйте снова.",
          }),
        ).toBeVisible();
        await assertNoPrivateRegistrationAccess(
          guest,
          (await submitted.response.headerValue("set-cookie")) ?? "",
          account,
        );
      }
    }
  },
);

After("@registration-verified-password", async ({ page }) => {
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
        expect(
          result,
          "owned verified re-registration session revoked",
        ).toEqual({ logout: 200, profile: 401 });
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
