import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  differentVerificationCode,
  verificationRefusalEvidence,
  inputSecret,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface Registration extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  response?: Response;
  code?: string;
  verification?: Response;
  verificationRequests?: number;
  refusal?: ReturnType<typeof verificationRefusalEvidence>;
  submittedCode?: string;
  verificationNavigations?: number;
}
const registrations = new WeakMap<Page, Registration>();
function registration(key: Page): Registration {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned registration was not prepared");
  return state;
}

Given(
  "an Academy visitor with a unique never-registered email",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    registrations.set(page, {
      context,
      page: owned,
      email: `register-2673-${randomUUID()}@example.test`,
      password: `Register-${randomUUID()}-aA1!`,
    });
    await installCaptchaStub(context);
  },
);

When(
  "the visitor submits the Academy registration form with a policy-conforming password and accepted consent versions",
  async ({ page, world }) => {
    const state = registration(page);
    Object.assign(
      state,
      await registerOwnedCredentials(state.page, world.hostBaseUrl, state),
    );
  },
);

Then(
  "registration acknowledges pending verification with the configured per-purpose consent versions",
  async ({ page }) => {
    const state = registration(page);
    const response = state.response!;
    expect(response.status()).toBe(200);
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
  },
);

Then(
  "the Academy code step has a fresh delivered confirmation code that remains unconsumed",
  async ({ page, world }) => {
    const state = registration(page);
    const url = new URL(state.page.url());
    expect(url.origin).toBe(new URL(world.hostBaseUrl).origin);
    expect(url.pathname).toBe("/verify");
    expect(
      url.searchParams.get("email") === state.email,
      "code step keeps the submitted address",
    ).toBe(true);
    expect(
      /^\d{6}$/.test(state.code ?? ""),
      "fresh addressed six-digit registration code delivered",
    ).toBe(true);
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(field).toBeVisible();
    expect(
      (await field.inputValue()) === "",
      "confirmation code remains unentered",
    ).toBe(true);
  },
);

Then(
  "registration exposes no password or tokens and grants no private session or profile access",
  async ({ page }) => {
    const state = registration(page);
    const sessionName = "__Host-ds_session";
    const header = (await state.response!.headerValue("set-cookie")) ?? "";
    expect(
      header.includes(`${sessionName}=`),
      "registration minted no private session",
    ).toBe(false);
    const cookies = await state.context.cookies();
    expect(
      cookies.some((cookie) => cookie.name === sessionName),
      "browser has no private session",
    ).toBe(false);
    expect(
      cookies.some((cookie) => cookie.value.includes(state.password)),
      "cookies contain no registration password",
    ).toBe(false);
    const exposed = await state.page.evaluate((password) => {
      const readable = JSON.stringify({
        url: location.href,
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      return (
        readable.includes(password) ||
        readable.includes(encodeURIComponent(password)) ||
        /__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
          readable,
        )
      );
    }, state.password);
    expect(
      exposed,
      "URL and JavaScript-readable stores expose no password or tokens",
    ).toBe(false);
    expect(
      await state.page.evaluate(
        async () =>
          (await fetch("/v1/me/profile", { credentials: "include" })).status,
      ),
      "unconfirmed registration cannot read a private profile",
    ).toBe(401);
  },
);

When(
  "the registrant enters a guaranteed different six-digit confirmation code once in the original Academy tab",
  async ({ page }) => {
    const state = registration(page);
    state.submittedCode = differentVerificationCode(state.code!);
    state.verificationNavigations = 0;
    state.verificationRequests = 0;
    state.page.on("framenavigated", (frame) => {
      if (frame === state.page.mainFrame()) state.verificationNavigations! += 1;
    });
    state.page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/v1/auth/verify" &&
        request.method() === "POST"
      )
        state.verificationRequests! += 1;
    });
    const refused = state.page
      .waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/v1/auth/verify" &&
          response.request().method() === "POST",
      )
      .then(async (response) => {
        // Consume and project the body before any later navigation can evict it.
        state.refusal = verificationRefusalEvidence(
          response.request().postData() ?? "",
          await response.text(),
          state,
          state.code!,
          state.submittedCode!,
        );
        return response;
      });
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.submittedCode,
    );
    state.verification = await refused;
  },
);

Then(
  "Academy rejects that confirmation generically on the same verification step without navigation or private access",
  async ({ page, world }) => {
    const state = registration(page);
    const response = state.verification!;
    expect(response.status(), "wrong confirmation code refused").toBe(400);
    expect(state.refusal).toEqual({
      credentialsMatch: true,
      wrongCode: true,
      refusalMatches: true,
    });
    const error = state.page.getByTestId("verify-error");
    await expect(error).toBeVisible();
    await expect
      .poll(
        async () =>
          (await error.ariaSnapshot()) ===
          "- alert: Код не подошёл. Проверьте его или запросите новый.",
      )
      .toBe(true);
    await expect(
      state.page.locator('input[autocomplete="one-time-code"]'),
    ).toBeVisible();
    const url = new URL(state.page.url());
    expect(url.origin).toBe(new URL(world.hostBaseUrl).origin);
    expect(url.pathname).toBe("/verify");
    expect(
      url.searchParams.get("email") === state.email,
      "same submitted address",
    ).toBe(true);
    const sessionName = "__Host-ds_session";
    expect(
      ((await response.headerValue("set-cookie")) ?? "").includes(
        `${sessionName}=`,
      ),
      "refusal minted no session",
    ).toBe(false);
    const cookies = await state.context.cookies();
    expect(
      cookies.some((cookie) => cookie.name === sessionName),
      "no private browser session",
    ).toBe(false);
    const secrets = [state.password, state.code!, state.submittedCode!];
    expect(
      cookies.some((cookie) =>
        secrets.some((secret) => cookie.value.includes(secret)),
      ),
      "no password or code in cookies",
    ).toBe(false);
    const exposed = await state.page.evaluate((secrets) => {
      const readable = JSON.stringify({
        url: location.href,
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      return (
        secrets.some(
          (secret) =>
            readable.includes(secret) ||
            readable.includes(encodeURIComponent(secret)),
        ) ||
        /__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
          readable,
        )
      );
    }, secrets);
    expect(exposed, "no password, code or token in readable stores").toBe(
      false,
    );
    expect(
      await state.page.evaluate(
        async () =>
          (await fetch("/v1/me/profile", { credentials: "include" })).status,
      ),
      "same browser cannot read private profile",
    ).toBe(401);
    expect(
      state.verificationRequests,
      "one automatic confirmation request",
    ).toBe(1);
    expect(
      state.verificationNavigations,
      "no navigation after wrong code",
    ).toBe(0);
  },
);

When(
  "the registrant enters the delivered confirmation code once in the original Academy tab",
  async ({ page }) => {
    const state = registration(page);
    state.verificationRequests = 0;
    state.page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/v1/auth/verify" &&
        request.method() === "POST"
      ) {
        state.verificationRequests! += 1;
      }
    });
    const verified = state.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/verify" &&
        response.request().method() === "POST",
    );
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code!,
    );
    state.verification = await verified;
  },
);

Then(
  "Academy automatically submits that code once and acknowledges verified without exposing credentials",
  async ({ page }) => {
    const state = registration(page);
    const response = state.verification!;
    expect(response.status(), "confirmation accepted").toBe(200);
    expect(
      verificationEvidence(
        response.request().postData() ?? "",
        await response.text(),
        state,
        state.code!,
      ),
    ).toEqual({
      credentialsMatch: true,
      acknowledgementMatches: true,
    });
    expect(
      state.verificationRequests,
      "one automatic confirmation request",
    ).toBe(1);
  },
);

Then(
  "confirmation opens webinars and the same email-verified account with a secure host-only session",
  async ({ page, world }) => {
    const state = registration(page);
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/webinars",
    );
    const exposed = await state.page.evaluate((password) => {
      const readable = JSON.stringify({
        url: location.href,
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      return (
        readable.includes(password) ||
        readable.includes(encodeURIComponent(password))
      );
    }, state.password);
    expect(exposed, "no held password in URL or browser-readable stores").toBe(
      false,
    );
    expect(
      (await state.context.cookies()).some((cookie) =>
        cookie.value.includes(state.password),
      ),
      "no held password in cookies",
    ).toBe(false);
    await assertSecureSession(
      state.page,
      state.verification!,
      world.hostBaseUrl,
    );
    await state.page.goto(`${world.hostBaseUrl}/account`, {
      waitUntil: "load",
    });
    expect(
      new URL(state.page.url()).pathname === "/account",
      "authenticated account route",
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
      "one confirmation request through authenticated arrival",
    ).toBe(1);
  },
);

After(
  "@registration-before-confirmation or @email-confirmation",
  async ({ page }) => {
    const state = registrations.get(page);
    if (!state) return;
    try {
      if (
        (await state.context.cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        )
      ) {
        const result = await state.page.evaluate(async () => {
          const response = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
          });
          return { logout: response.status, profile: profile.status };
        });
        expect(result, "owned confirmation session revoked").toEqual({
          logout: 200,
          profile: 401,
        });
      }
    } finally {
      // Close pages first so failure-context snapshots cannot retain credentials.
      await Promise.all(state.context.pages().map((owned) => owned.close()));
      await state.context.close();
      registrations.delete(page);
    }
  },
);
