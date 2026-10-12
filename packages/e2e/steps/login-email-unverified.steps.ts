import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import {
  extractLoginCode,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface UnverifiedLogin extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  authPosts: string[];
  requestedAt?: string;
  requested?: CapturedResponse;
  code?: string;
  accepted?: CapturedResponse;
  mail?: { codeInBothBodies: boolean; linkFree: boolean };
}
const logins = new WeakMap<Page, UnverifiedLogin>();
function login(key: Page): UnverifiedLogin {
  const state = logins.get(key);
  if (!state)
    throw new Error("Owned unverified sign-in account was not prepared");
  return state;
}

function parsedObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    // Parser diagnostics can quote code-bearing response bytes.
    return {};
  }
}

Given(
  "a uniquely owned Academy doctor_guest account awaits email verification with its registration code unconsumed",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: UnverifiedLogin = {
      context,
      page: owned,
      email: `signin-unverified-2793-${randomUUID()}@example.test`,
      password: `Signin-${randomUUID()}-aA1!`,
      authPosts: [],
    };
    logins.set(page, state);
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
    const registered = captureResponse(owned, "/v1/auth/register");
    await registerOwnedCredentials(owned, world.hostBaseUrl, state, "/account");
    const registration = await registered;
    expect(
      registrationEvidence(
        registration.response.request().postData() ?? "",
        registration.body,
        state,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    expect(state.authPosts, "registration code remains unconsumed").toEqual([
      "/v1/auth/register",
    ]);
    await assertNoPrivateRegistrationAccess(
      owned,
      (await registration.response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

When(
  "that unverified account requests an email sign-in code through the ordinary Academy code method",
  async ({ page, world }) => {
    const state = login(page);
    const url = new URL(world.host.loginPath, world.hostBaseUrl);
    url.searchParams.set("method", "code");
    url.searchParams.set("returnTo", "/account");
    await state.page.goto(url.toString(), { waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await expect(state.page.getByTestId("login-method-otp")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await state.page.getByTestId("otp-channel-email").click();
    await inputSecret(state.page.getByTestId("otp-identifier"), state.email);
    state.requestedAt = new Date().toISOString();
    const requested = captureResponse(state.page, "/v1/auth/login/otp/request");
    await state.page.getByTestId("otp-send").click();
    state.requested = await requested;
  },
);

Then(
  "that unverified code request acknowledges only otp_sent and grants no private session or profile access",
  async ({ page }) => {
    const state = login(page);
    const requested = state.requested!;
    const request = parsedObject(requested.response.request().postData() ?? "");
    expect(
      request.identifier === state.email && request.channel === "email",
      "code request belongs to the owned email",
    ).toBe(true);
    expect(
      requested.response.status(),
      "enumeration-safe acknowledgement",
    ).toBe(200);
    const acknowledgement = parsedObject(requested.body);
    expect(
      Object.keys(acknowledgement).length === 1 &&
        acknowledgement.status === "otp_sent",
      "exact code-free acknowledgement",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await requested.response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

Then(
  "fresh addressed code-only sign-in mail delivers six digits for that unverified account without a link",
  async ({ page, world }) => {
    const state = login(page);
    const mail = nativeRecoveryMail();
    state.code = await fetchRecoveryCode(
      {
        async get(url) {
          const response = await mail.get(url);
          return {
            ...response,
            async json() {
              const result = await response.json();
              if (new URL(url).pathname.startsWith("/api/v1/message/")) {
                const message = result as {
                  Subject?: string;
                  Text?: string;
                  HTML?: string;
                } | null;
                const code = extractLoginCode(message?.Subject ?? "");
                const text = message?.Text;
                const html = message?.HTML;
                state.mail = {
                  codeInBothBodies:
                    code !== null &&
                    typeof text === "string" &&
                    text.includes(code) &&
                    typeof html === "string" &&
                    html.includes(code),
                  linkFree:
                    typeof text === "string" &&
                    typeof html === "string" &&
                    !/https?:\/\/|www\.|mailto:/i.test(text) &&
                    !/<a\b|<button\b|\bhref\s*=|https?:\/\/|www\.|mailto:/i.test(
                      html,
                    ),
                };
              }
              return result;
            },
          };
        },
      },
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.requestedAt!,
      "login",
    );
    expect(
      /^\d{6}$/.test(state.code),
      "delivered sign-in code is six digits",
    ).toBe(true);
    expect(state.mail, "same code-only, link-free sign-in artifact").toEqual({
      codeInBothBodies: true,
      linkFree: true,
    });
    const input = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("maxlength", "6");
    await expect(
      state.page.locator("[data-input-otp-container] > div > div"),
    ).toHaveCount(6);
  },
);

When(
  "that unverified account enters the fresh sign-in mail's six digits once on Academy's code step",
  async ({ page }) => {
    const state = login(page);
    const accepted = captureResponse(state.page, "/v1/auth/login/otp");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code!,
    );
    state.accepted = await accepted;
    const request = parsedObject(
      state.accepted.response.request().postData() ?? "",
    );
    const response = parsedObject(state.accepted.body);
    expect(
      state.accepted.response.status(),
      "fresh sign-in code accepted",
    ).toBe(200);
    expect({
      requestMatches:
        Object.keys(request).length === 3 &&
        request.identifier === state.email &&
        request.channel === "email" &&
        request.code === state.code,
      acknowledgementMatches:
        Object.keys(response).length === 1 &&
        response.status === "authenticated",
    }).toEqual({ requestMatches: true, acknowledgementMatches: true });
  },
);

Then(
  "Academy opens that same email-verified doctor_guest account with a secure host-only session and no readable auth tokens",
  async ({ page, world }) => {
    const state = login(page);
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
    const own = await state.page.evaluate(async (email) => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await profile.json().catch(() => ({}));
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
      });
      const claims = await session.json().catch(() => ({}));
      return {
        profileStatus: profile.status,
        sameAccount: body.email === email,
        emailVerified: body.emailVerified === true,
        sessionStatus: session.status,
        doctorGuest:
          Array.isArray(claims.roles) && claims.roles.includes("doctor_guest"),
      };
    }, state.email);
    expect(
      own,
      "accepted sign-in code verifies the owned private identity",
    ).toEqual({
      profileStatus: 200,
      sameAccount: true,
      emailVerified: true,
      sessionStatus: 200,
      doctorGuest: true,
    });
    await expect(
      state.page.getByTestId("profile-email-verified"),
    ).toBeVisible();
    expect(
      state.authPosts,
      "one code request and one automatic acceptance",
    ).toEqual([
      "/v1/auth/register",
      "/v1/auth/login/otp/request",
      "/v1/auth/login/otp",
    ]);
  },
);

After("@login-email-unverified", async ({ page }) => {
  const state = logins.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
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
      expect(result, "owned unverified-code session revoked").toEqual({
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
