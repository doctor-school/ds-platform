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
  assertNoPrivateRegistrationAccess,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  expiryBudget,
  readExpiryBudget,
  expiredVerificationEvidence,
  readExpiryAudit,
  type ExpiryAudit,
} from "../lib/expired-verification.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface Registration extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  response?: Response;
  code?: string;
  verification?: Response;
  verificationRequests?: number;
  refusal?:
    | ReturnType<typeof verificationRefusalEvidence>
    | ReturnType<typeof expiredVerificationEvidence>;
  submittedCode?: string;
  verificationNavigations?: number;
  expiry?: ReturnType<typeof expiryBudget> & {
    elapsedMs?: number;
    before?: ExpiryAudit;
  };
}
const registrations = new WeakMap<Page, Registration>();
function registration(key: Page): Registration {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned registration was not prepared");
  return state;
}

Given(
  "the live email-verification generator lifetime has been read back for this run",
  async ({ page, world }) => {
    const budget = await readExpiryBudget(
      world.hostBaseUrl,
      process.env.E2E_EMAIL_VERIFICATION_TTL_MS,
    );
    test.setTimeout(budget.timeoutMs);
    console.log(
      `Email verification generator read ${new Date().toISOString()}: ${budget.ttlMs} milliseconds`,
    );
    // The next shared Given owns registration; keep only this scenario's budget.
    expiryBudgets.set(page, budget);
  },
);
const expiryBudgets = new WeakMap<Page, ReturnType<typeof expiryBudget>>();

Given(
  "an Academy visitor with a unique never-registered email",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const expiry = expiryBudgets.get(page);
    registrations.set(page, {
      context,
      page: owned,
      email: `register-2673-${randomUUID()}@example.test`,
      password: `Register-${randomUUID()}-aA1!`,
      ...(expiry ? { expiry } : {}),
    });
    await installCaptchaStub(context);
  },
);

When(
  "the fresh delivered confirmation code has aged through that complete real lifetime in the original tab",
  async ({ page }) => {
    const state = registration(page);
    if (!state.expiry || !state.code)
      throw new Error(
        "Fresh owned confirmation and live expiry budget required",
      );
    state.expiry.before = await readExpiryAudit(state.page.url(), state.email);
    expect(
      state.expiry.before,
      "owned unverified account has no prior verification failure",
    ).toEqual({ failed: 0, safe: true, unverified: true });
    const started = performance.now();
    while (performance.now() - started < state.expiry.waitMs) {
      const remaining = state.expiry.waitMs - (performance.now() - started);
      console.log(
        `Email verification expiry wait ${new Date().toISOString()}: ${Math.ceil(remaining / 1000)} seconds remain`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(60000, remaining)),
      );
    }
    state.expiry.elapsedMs = performance.now() - started;
    expect(
      state.expiry.elapsedMs >= state.expiry.waitMs,
      "complete live TTL elapsed after fresh mail retrieval",
    ).toBe(true);
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

When(
  "the registrant enters that same delivered expired code once in the original Academy tab",
  async ({ page }) => {
    const state = registration(page);
    if (!state.expiry?.elapsedMs || !state.code)
      throw new Error("The real delivered confirmation code has not expired");
    state.submittedCode = state.code;
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
        state.refusal = expiredVerificationEvidence(
          response.request().postData() ?? "",
          await response.text(),
          state,
          state.code!,
          state.submittedCode!,
          state.expiry!.ttlMs,
          state.expiry!.elapsedMs!,
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
  "the real expired refusal has exactly one masked failed-attempt record and leaves the account unverified",
  async ({ page }) => {
    const state = registration(page);
    expect(
      state.expiry?.before?.failed,
      "exact owned pre-submission attempt baseline",
    ).toBe(0);
    expect(
      await readExpiryAudit(state.page.url(), state.email),
      "exact owned failed-attempt delta with only masked metadata",
    ).toEqual({ failed: 1, safe: true, unverified: true });
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
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await state.response!.headerValue("set-cookie")) ?? "",
      state,
    );
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
    expect(response.status(), "confirmation code refused").toBe(400);
    expect(state.refusal).toEqual(
      state.expiry
        ? {
            credentialsMatch: true,
            deliveredCode: true,
            expired: true,
            refusalMatches: true,
          }
        : { credentialsMatch: true, wrongCode: true, refusalMatches: true },
    );
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
      "no navigation after refused code",
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
      expiryBudgets.delete(page);
    }
  },
);
