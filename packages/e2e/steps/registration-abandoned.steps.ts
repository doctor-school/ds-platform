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
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface AbandonedRegistration extends OwnedCredentials {
  firstPassword: string;
  context: BrowserContext;
  page: Page;
  contexts: BrowserContext[];
  authPosts: string[];
  requestedAt?: string;
  repeated?: CapturedResponse;
  code?: string;
  accepted?: CapturedResponse;
  subject?: string;
}
const registrations = new WeakMap<Page, AbandonedRegistration>();
function registration(key: Page): AbandonedRegistration {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned abandoned registration was not prepared");
  return state;
}

function parsedObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function privateIdentity(
  page: Page,
  email: string,
  expectedSubject?: string,
) {
  const own = await page.evaluate(
    async ({ email, expectedSubject }) => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await profile.json().catch(() => ({}));
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const claims = await session.json().catch(() => ({}));
      return {
        profileStatus: profile.status,
        sameEmail: body.email === email,
        emailVerified: body.emailVerified === true,
        sessionStatus: session.status,
        hasSubject: typeof claims.sub === "string" && claims.sub.length > 0,
        sameSubject:
          expectedSubject === undefined || claims.sub === expectedSubject,
        subject: typeof claims.sub === "string" ? claims.sub : "",
      };
    },
    { email, expectedSubject },
  );
  const { subject, ...evidence } = own;
  expect(evidence, "same verified owned private identity").toEqual({
    profileStatus: 200,
    sameEmail: true,
    emailVerified: true,
    sessionStatus: 200,
    hasSubject: true,
    sameSubject: true,
  });
  return subject;
}

Given(
  "a uniquely owned Academy account remains unverified after registration with an abandoned password",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: AbandonedRegistration = {
      context,
      page: owned,
      contexts: [context],
      authPosts: [],
      email: `abandoned-2824-${randomUUID()}@example.test`,
      firstPassword: `Abandoned-${randomUUID()}-aA1!`,
      password: `Replacement-${randomUUID()}-aA1!`,
    };
    registrations.set(page, state);
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const first = { email: state.email, password: state.firstPassword };
    const pending = captureResponse(owned, "/v1/auth/register");
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      first,
      "/account",
    );
    const registered = await pending;
    expect(
      registrationEvidence(
        registered.response.request().postData() ?? "",
        registered.body,
        first,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    expect(
      /^\d{6}$/.test(code),
      "first registration delivered an unconsumed confirmation",
    ).toBe(true);
    expect(
      (await owned
        .locator('input[autocomplete="one-time-code"]')
        .inputValue()) === "",
      "first code is never entered",
    ).toBe(true);
    expect(state.authPosts).toEqual(["/v1/auth/register"]);
    await assertNoPrivateRegistrationAccess(
      owned,
      (await registered.response.headerValue("set-cookie")) ?? "",
      first,
    );
  },
);

When(
  "the abandoned registrant submits the real Academy registration form again for the same address with a distinct new password",
  async ({ page, world }) => {
    const state = registration(page);
    expect(
      state.password !== state.firstPassword,
      "replacement credentials differ",
    ).toBe(true);
    await state.page.goto(registrationUrl(world.hostBaseUrl, "/account"), {
      waitUntil: "load",
    });
    await state.page.waitForLoadState("networkidle");
    await inputSecret(
      state.page.locator('input[autocomplete="email"]'),
      state.email,
    );
    await inputSecret(
      state.page.locator('input[autocomplete="new-password"]'),
      state.password,
    );
    state.requestedAt = new Date().toISOString();
    const pending = captureResponse(state.page, "/v1/auth/register");
    await state.page.getByTestId("register-submit").click();
    state.repeated = await pending;
    expect(
      state.repeated.response.status(),
      "repeat registration has the neutral acknowledgement",
    ).toBe(200);
    expect(
      registrationEvidence(
        state.repeated.response.request().postData() ?? "",
        state.repeated.body,
        state,
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
      new URL(state.page.url()).searchParams.get("email") === state.email,
      "second code step belongs to the same owned address",
    ).toBe(true);
    expect(new URL(state.page.url()).searchParams.get("returnTo")).toBe(
      "/account",
    );
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await state.repeated.response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

Then(
  "the fresh addressed re-registration mail says the entered password will be saved after the code and never says it is unchanged",
  async ({ page, world }) => {
    const state = registration(page);
    const mail = await fetchRecoveryMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.requestedAt!,
      "login",
    );
    state.code = mail.code;
    const notice =
      "Пароль, который вы ввели при регистрации, сохранится после ввода кода.";
    expect(
      {
        sixDigits: /^\d{6}$/.test(mail.code),
        codeInBothBodies:
          typeof mail.text === "string" &&
          mail.text.includes(mail.code) &&
          typeof mail.html === "string" &&
          mail.html.includes(mail.code),
        correctPasswordNotice:
          typeof mail.text === "string" &&
          mail.text.includes(notice) &&
          typeof mail.html === "string" &&
          mail.html.includes(notice),
        neverUnchanged:
          typeof mail.text === "string" &&
          !mail.text.includes("Ваш пароль не изменился") &&
          typeof mail.html === "string" &&
          !mail.html.includes("Ваш пароль не изменился"),
        linkFree:
          typeof mail.text === "string" &&
          typeof mail.html === "string" &&
          !/https?:\/\/|www\.|mailto:/i.test(mail.text) &&
          !/<a\b|<button\b|\bhref\s*=|https?:\/\/|www\.|mailto:/i.test(
            mail.html,
          ),
      },
      "truthful password notice on the exact code-only delivered artifact",
    ).toEqual({
      sixDigits: true,
      codeInBothBodies: true,
      correctPasswordNotice: true,
      neverUnchanged: true,
      linkFree: true,
    });
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(field).toBeVisible();
    expect(
      (await field.inputValue()) === "",
      "second code remains unconsumed before owner proof",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
  },
);

When(
  "the abandoned registrant enters that delivered re-registration code once in the requesting Academy tab",
  async ({ page }) => {
    const state = registration(page);
    const pending = captureResponse(state.page, "/v1/auth/verify");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code!,
    );
    state.accepted = await pending;
    expect(
      state.accepted.response.status(),
      "replacement registration code accepted",
    ).toBe(200);
    expect(
      verificationEvidence(
        state.accepted.response.request().postData() ?? "",
        state.accepted.body,
        state,
        state.code!,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
  },
);

Then(
  "that code opens the same email-verified Academy account with a secure BFF session and the account return target",
  async ({ page, world }) => {
    const state = registration(page);
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(
      state.page,
      state.accepted!.response,
      world.hostBaseUrl,
    );
    state.subject = await privateIdentity(state.page, state.email);
    expect(
      state.authPosts,
      "two registrations and exactly one accepted code, with no sign-in replay",
    ).toEqual(["/v1/auth/register", "/v1/auth/register", "/v1/auth/verify"]);
  },
);

Then(
  "independent guest browsers can sign into that same account with the new password but receive only the generic refusal for the abandoned password",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    const state = registration(page);
    for (const isReplacement of [true, false]) {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      state.contexts.push(context);
      const guest = await context.newPage();
      await prepareCaptchaForJourney(
        context,
        baseURL ?? "",
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      const account = {
        email: state.email,
        password: isReplacement ? state.password : state.firstPassword,
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
      const pending = captureResponse(guest, "/v1/auth/login");
      await guest.getByTestId("password-login-submit").click();
      const submitted = await pending;
      const body = parsedObject(submitted.response.request().postData() ?? "");
      expect(
        body.identifier === state.email && body.password === account.password,
        "password probe targets the same owned account with the intended credential",
      ).toBe(true);
      expect(posts, "one independent password login probe").toEqual([
        "/v1/auth/login",
      ]);
      if (isReplacement) {
        expect(
          submitted.response.status(),
          "new password works after owner proof",
        ).toBe(200);
        await guest.waitForURL(
          (url) =>
            url.origin === new URL(world.hostBaseUrl).origin &&
            url.pathname === "/account",
        );
        await assertSecureSession(guest, submitted.response, world.hostBaseUrl);
        await privateIdentity(guest, state.email, state.subject);
      } else {
        expect(
          submitted.response.status(),
          "abandoned password no longer works",
        ).toBe(401);
        const refusal = parsedObject(submitted.body);
        expect(
          Object.keys(refusal).length === 3 &&
            refusal.statusCode === 401 &&
            refusal.message === "invalid credentials" &&
            refusal.error === "Unauthorized",
          "generic credential rejection body",
        ).toBe(true);
        expect(new URL(guest.url()).pathname).toBe("/login");
        await expect(
          guest
            .getByRole("alert")
            .filter({
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

After("@registration-abandoned", async ({ page }) => {
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
        expect(result, "owned replacement session revoked").toEqual({
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
