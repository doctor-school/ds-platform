import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { readPasswordPolicy } from "../lib/password-policy.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface MinimumRegistration extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  code?: string;
  verification?: Response;
  verifyEvidence?: ReturnType<typeof verificationEvidence>;
  verificationRequests: number;
  extraLoginRequests: number;
}
const registrations = new WeakMap<Page, MinimumRegistration>();
function registration(key: Page): MinimumRegistration {
  const state = registrations.get(key);
  if (!state)
    throw new Error("Owned minimum-password registration was not prepared");
  return state;
}

Given(
  "the IdP instance complexity policy is provisioned as minimum length 8 with every character-class flag off",
  async ({ world }) => {
    expect(world.host.id).toBe("academy");
    expect(await readPasswordPolicy(world.hostBaseUrl)).toEqual({
      minLength: 8,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
      hasSymbol: false,
    });
    console.log(
      `Password complexity policy read ${new Date().toISOString()}: minimum 8, all character-class flags off`,
    );
  },
);

Given(
  "an Academy length-only registrant with a unique never-registered email",
  async ({ page, browser, httpCredentials }) => {
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    registrations.set(page, {
      context,
      page: owned,
      email: `register-2721-${randomUUID()}@example.test`,
      password: "",
      verificationRequests: 0,
      extraLoginRequests: 0,
    });
    await installCaptchaStub(context);
  },
);

When(
  "the length-only registrant submits exactly eight lowercase letters {string} with accepted consent versions",
  async ({ page, world }, password: string) => {
    const state = registration(page);
    expect(
      /^[a-z]{8}$/.test(password),
      "exactly eight lowercase letters, without other character classes",
    ).toBe(true);
    state.password = password;
    const { response, code } = await registerOwnedCredentials(
      state.page,
      world.hostBaseUrl,
      state,
    );
    expect(response.status(), "minimum-length registration accepted").toBe(200);
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
    expect(
      /^\d{6}$/.test(code),
      "fresh owned mail contains six numeric digits",
    ).toBe(true);
    state.code = code;
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

When(
  "the length-only registrant enters that fresh delivered confirmation code once",
  async ({ page }) => {
    const state = registration(page);
    if (!state.code) throw new Error("Fresh owned verification mail required");
    state.page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (path === "/v1/auth/verify") state.verificationRequests += 1;
      if (path === "/v1/auth/login" || path.startsWith("/v1/auth/login/"))
        state.extraLoginRequests += 1;
    });
    const verified = state.page
      .waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/v1/auth/verify" &&
          response.request().method() === "POST",
      )
      .then(async (response) => {
        state.verifyEvidence = verificationEvidence(
          response.request().postData() ?? "",
          await response.text(),
          state,
          state.code!,
        );
        return response;
      });
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    state.verification = await verified;
  },
);

Then(
  "that one confirmation opens the verified length-only account with a secure session and no additional sign-in",
  async ({ page, world }) => {
    const state = registration(page);
    expect(state.verification!.status(), "confirmation accepted").toBe(200);
    expect(state.verifyEvidence).toEqual({
      credentialsMatch: true,
      acknowledgementMatches: true,
    });
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/webinars",
    );
    await assertSecureSession(
      state.page,
      state.verification!,
      world.hostBaseUrl,
    );
    const secrets = [state.password, state.code!];
    const exposed = await state.page.evaluate((values) => {
      const readable = JSON.stringify({
        url: location.href,
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      return values.some(
        (secret) =>
          readable.includes(secret) ||
          readable.includes(encodeURIComponent(secret)),
      );
    }, secrets);
    expect(
      exposed,
      "no registration password or verification code in readable stores",
    ).toBe(false);
    expect(
      (await state.context.cookies()).some((cookie) =>
        secrets.some((secret) => cookie.value.includes(secret)),
      ),
      "cookies contain no registration password or verification code",
    ).toBe(false);
    await state.page.goto(`${world.hostBaseUrl}/account`, {
      waitUntil: "load",
    });
    expect(
      new URL(state.page.url()).pathname === "/account",
      "private account route stays authenticated",
    ).toBe(true);
    const profile = await state.page.evaluate(async (email) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        sameAccount: body.email === email,
        emailVerified: body.emailVerified === true,
      };
    }, state.email);
    expect(profile).toEqual({
      status: 200,
      sameAccount: true,
      emailVerified: true,
    });
    expect(
      state.verificationRequests,
      "one confirmation through authenticated arrival",
    ).toBe(1);
    expect(
      state.extraLoginRequests,
      "no separate password or code sign-in",
    ).toBe(0);
  },
);

After("@password-minimum", async ({ page }) => {
  const state = registrations.get(page);
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
      expect(result, "owned minimum-password session revoked").toEqual({
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
