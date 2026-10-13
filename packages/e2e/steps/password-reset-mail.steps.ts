import { randomUUID } from "node:crypto";
import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryMail,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  differentVerificationCode,
  inputSecret,
  registerOwnedCredentials,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface ResetMail extends OwnedCredentials {
  newPassword: string;
  contexts: BrowserContext[];
  httpCredentials: BrowserContextOptions["httpCredentials"];
  reset?: Page;
  before?: AddressedMailCheckpoint;
  requestedAt?: string;
  mail?: Awaited<ReturnType<typeof fetchRecoveryMail>>;
  completion?: CapturedResponse;
  resetPosts: string[];
}

const resets = new WeakMap<Page, ResetMail>();

function resetMail(key: Page): ResetMail {
  const state = resets.get(key);
  if (!state) throw new Error("Owned reset-mail account was not prepared");
  return state;
}

async function privatePage(
  browser: Browser,
  state: ResetMail,
  base: string,
): Promise<Page> {
  const context = await browser.newContext({
    locale: "ru-RU",
    ...(state.httpCredentials
      ? { httpCredentials: state.httpCredentials }
      : {}),
  });
  state.contexts.push(context);
  await prepareCaptchaForJourney(
    context,
    base,
    process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
  );
  return context.newPage();
}

async function ownProfile(page: Page, email: string): Promise<void> {
  expect(
    await page.evaluate(async (expected) => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await profile.json().catch(() => ({}));
      return {
        profileStatus: profile.status,
        sameOwnedEmail: body.email === expected,
        emailVerified: body.emailVerified === true,
      };
    }, email),
    "private profile identifies the same verified owned account",
  ).toEqual({
    profileStatus: 200,
    sameOwnedEmail: true,
    emailVerified: true,
  });
}

async function passwordSignIn(
  page: Page,
  base: string,
  state: ResetMail,
  password: string,
): Promise<CapturedResponse> {
  await page.goto(`${base}/login?returnTo=%2Faccount`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await inputSecret(
    page.locator('input[autocomplete="username"]'),
    state.email,
  );
  await inputSecret(
    page.locator('input[autocomplete="current-password"]'),
    password,
  );
  const pending = captureResponse(page, "/v1/auth/login");
  await page.getByTestId("password-login-submit").click();
  return pending;
}

Given(
  "a uniquely registered verified Academy account is owned for a reset-mail journey with its original password",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const state: ResetMail = {
      email: `password-reset-mail-2906-${randomUUID()}@example.test`,
      password: `Original-${randomUUID()}-aA1!`,
      newPassword: `Replacement-${randomUUID()}-aA1!`,
      contexts: [],
      httpCredentials,
      resetPosts: [],
    };
    resets.set(page, state);
    expect(
      state.newPassword !== state.password,
      "distinct valid passwords",
    ).toBe(true);
    const registered = await privatePage(browser, state, world.hostBaseUrl);
    const { code } = await registerOwnedCredentials(
      registered,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const pending = captureResponse(registered, "/v1/auth/verify");
    await inputSecret(
      registered.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "real registration code accepted").toBe(
      200,
    );
    expect(
      verificationEvidence(
        verified.response.request().postData() ?? "",
        verified.body,
        state,
        code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
    await registered.waitForURL((url) => url.pathname === "/account");
    await ownProfile(registered, state.email);
    await assertSecureSession(registered, verified.response, world.hostBaseUrl);
  },
);

When(
  "that owned account requests a reset through the real Academy form with the account return target",
  async ({ page, browser, world }) => {
    const state = resetMail(page);
    const reset = await privatePage(browser, state, world.hostBaseUrl);
    state.reset = reset;
    reset.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        request.method() === "POST" &&
        pathname.startsWith("/v1/auth/password/reset")
      )
        state.resetPosts.push(pathname);
    });
    await reset.goto(`${world.hostBaseUrl}/reset?returnTo=%2Faccount`, {
      waitUntil: "load",
    });
    await reset.waitForLoadState("networkidle");
    expect(new URL(reset.url()).searchParams.get("returnTo")).toBe("/account");
    await inputSecret(
      reset.locator('input[autocomplete="username"]'),
      state.email,
    );
    state.before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
    );
    state.requestedAt = new Date().toISOString();
    const pending = captureResponse(reset, "/v1/auth/password/reset");
    await reset.getByTestId("reset-request-submit").click();
    const requested = await pending;
    expect(
      requested.response.status(),
      "real owned reset request accepted",
    ).toBe(200);
    let identifierMatches = false;
    try {
      identifierMatches =
        JSON.parse(requested.response.request().postData() ?? "{}")
          .identifier === state.email;
    } catch {
      // Malformed secret-bearing data remains a failed boolean, never a parse diagnostic.
    }
    expect(
      {
        exactOwnedIdentifier: identifierMatches,
        neutralAcknowledgement:
          requested.body === JSON.stringify({ status: "reset_requested" }),
      },
      "reset request retains the exact owned identifier and neutral response",
    ).toEqual({ exactOwnedIdentifier: true, neutralAcknowledgement: true });
    await expect(
      reset.locator('input[autocomplete="one-time-code"]'),
    ).toBeVisible();
    expect(new URL(reset.url()).searchParams.get("returnTo")).toBe("/account");
    await assertNoPrivateRegistrationAccess(
      reset,
      (await requested.response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

Then(
  "the fresh recipient-bound reset mail has a leading six-digit code matching both complete branded bodies and footer",
  async ({ page, world }) => {
    const state = resetMail(page);
    if (!state.requestedAt || !state.before)
      throw new Error("Pre-reset recipient checkpoint was not captured");
    state.mail = await fetchRecoveryMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.requestedAt,
      "reset",
    );
    const delivered = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
    );
    const beforeIds = new Set(state.before.messageIds);
    expect(
      delivered.messageIds.filter((id) => !beforeIds.has(id)).length === 1,
      "one new addressed delivery since the pre-reset checkpoint",
    ).toBe(true);
    const { mail } = state;
    // The canonical observer derives the entire subject prefix, bound to the
    // fresh recipient/search ID and reset-purpose tail, from complete details.
    expect(
      {
        leadingSixDigits: /^\d{6}$/.test(mail.code),
        matchingCodeInBothBodies:
          typeof mail.text === "string" &&
          mail.text.includes(mail.code) &&
          typeof mail.html === "string" &&
          mail.html.includes(`<strong>${mail.code}</strong>`),
        brandedLayout:
          typeof mail.text === "string" &&
          mail.text.includes("Doctor.School") &&
          typeof mail.html === "string" &&
          mail.html.includes("Doctor.School") &&
          /<table\b[^>]*role="presentation"/i.test(mail.html),
        completeResetFooter:
          typeof mail.text === "string" &&
          mail.text.includes("Если вы не запрашивали сброс пароля") &&
          typeof mail.html === "string" &&
          mail.html.includes("Если вы не запрашивали сброс пароля") &&
          mail.text.includes("проигнорируйте это письмо") &&
          mail.html.includes("проигнорируйте это письмо"),
      },
      "real reset artifact subject, both bodies, shared brand and footer",
    ).toEqual({
      leadingSixDigits: true,
      matchingCodeInBothBodies: true,
      brandedLayout: true,
      completeResetFooter: true,
    });
  },
);

Then(
  "both complete reset-mail bodies state the real one-hour lifetime and already-open requesting-tab instruction without any navigation",
  async ({ page }) => {
    const { mail } = resetMail(page);
    if (!mail) throw new Error("Fresh owned reset-mail artifact is missing");
    const navigationUrl =
      /[a-z][a-z0-9+.-]*:\/\/|(?:mailto|tel|sms|javascript|data):|www\.|(?:^|[\s"'(>])\/{1,2}[a-z0-9][^\s<]*/i;
    for (const body of [mail.text, mail.html]) {
      expect(
        {
          actualResetExpiry:
            typeof body === "string" &&
            /Код действует\s+1\s+час[.\s<]/u.test(body),
          requestingTabInstruction:
            typeof body === "string" &&
            body.includes("Введите код") &&
            /уже\s+открытой\s+вкладке/u.test(body) &&
            /где\s+вы\s+запросили\s+сброс\s+пароля/u.test(body),
          noNavigation:
            typeof body === "string" &&
            !navigationUrl.test(body) &&
            !/<a\b|<button\b|\bhref\s*=/i.test(body),
        },
        "each entire body, footer included, has the 3600s instruction and no navigation",
      ).toEqual({
        actualResetExpiry: true,
        requestingTabInstruction: true,
        noNavigation: true,
      });
    }
  },
);

When(
  "a different six-digit reset code is generically refused without private access or changing that owned account's password",
  async ({ page, browser, world }) => {
    const state = resetMail(page);
    if (!state.reset || !state.mail)
      throw new Error("Owned reset form and delivered artifact are missing");
    const reset = state.reset;
    const wrong = differentVerificationCode(state.mail.code);
    await inputSecret(
      reset.locator('input[autocomplete="one-time-code"]'),
      wrong,
    );
    await inputSecret(
      reset.locator('input[autocomplete="new-password"]'),
      state.newPassword,
    );
    const pending = captureResponse(reset, "/v1/auth/password/reset/complete");
    await reset.locator('form button[type="submit"]').click();
    const refused = await pending;
    expect(refused.response.status(), "wrong reset code refused").toBe(400);
    let exactOwnedAttempt = false;
    let genericRefusal = false;
    try {
      const request = JSON.parse(refused.response.request().postData() ?? "{}");
      const response = JSON.parse(refused.body);
      exactOwnedAttempt =
        request.identifier === state.email &&
        request.code === wrong &&
        request.newPassword === state.newPassword;
      genericRefusal =
        Object.keys(response).length === 3 &&
        response.statusCode === 400 &&
        response.message === "the request could not be completed" &&
        response.error === "Bad Request";
    } catch {
      // Project malformed data to false without exposing its bytes.
    }
    expect(
      {
        exactOwnedAttempt,
        differentSixDigitCode:
          /^\d{6}$/.test(wrong) && wrong !== state.mail.code,
        genericRefusal,
      },
      "wrong-code request and generic refusal expose only boolean projections",
    ).toEqual({
      exactOwnedAttempt: true,
      differentSixDigitCode: true,
      genericRefusal: true,
    });
    await expect
      .poll(() => reset.getByTestId("reset-error").ariaSnapshot())
      .toBe("- alert: Код не подошёл или пароль отклонён.");
    expect(new URL(reset.url()).pathname).toBe("/reset");
    expect(new URL(reset.url()).searchParams.get("returnTo")).toBe("/account");
    await assertNoPrivateRegistrationAccess(
      reset,
      (await refused.response.headerValue("set-cookie")) ?? "",
      state,
    );
    const unchanged = await privatePage(browser, state, world.hostBaseUrl);
    const original = await passwordSignIn(
      unchanged,
      world.hostBaseUrl,
      state,
      state.password,
    );
    expect(
      original.response.status(),
      "original password survives wrong code",
    ).toBe(200);
    await unchanged.waitForURL((url) => url.pathname === "/account");
    await ownProfile(unchanged, state.email);
  },
);

When(
  "the owned requester confirms the rejected reset digits are cleared and submits the delivered mail code once with a distinct valid new password",
  async ({ page }) => {
    const state = resetMail(page);
    if (!state.reset || !state.mail)
      throw new Error("Owned reset form and delivered artifact are missing");
    const code = state.reset.locator('input[autocomplete="one-time-code"]');
    await expect
      .poll(() =>
        code.evaluate((element) => (element as HTMLInputElement).value === ""),
      )
      .toBe(true);
    await expect
      .poll(() =>
        code.evaluate((element) => {
          const input = element as HTMLInputElement;
          return (
            document.activeElement === input &&
            input.selectionStart === 0 &&
            input.selectionEnd === 0
          );
        }),
      )
      .toBe(true);
    await inputSecret(code, state.mail.code);
    await inputSecret(
      state.reset.locator('input[autocomplete="new-password"]'),
      state.newPassword,
    );
    const pending = captureResponse(
      state.reset,
      "/v1/auth/password/reset/complete",
    );
    await state.reset.locator('form button[type="submit"]').click();
    state.completion = await pending;
    expect(
      state.completion.response.status(),
      "delivered reset code accepted",
    ).toBe(200);
    let exactOwnedReset = false;
    try {
      const request = JSON.parse(
        state.completion.response.request().postData() ?? "{}",
      );
      exactOwnedReset =
        request.identifier === state.email &&
        request.code === state.mail.code &&
        request.newPassword === state.newPassword;
    } catch {
      // The failure assertion must not contain credentials or the delivered code.
    }
    expect(
      {
        exactOwnedReset,
        tokenFreeAcknowledgement:
          state.completion.body ===
          JSON.stringify({ status: "reset_completed" }),
      },
      "delivered-code completion retains the owned command and safe acknowledgement",
    ).toEqual({ exactOwnedReset: true, tokenFreeAcknowledgement: true });
  },
);

Then(
  "the reset opens that same verified account at its return target and only the new password signs in from an independent guest",
  async ({ page, browser, world }) => {
    const state = resetMail(page);
    if (!state.reset || !state.completion)
      throw new Error("Delivered reset code was not completed");
    await state.reset.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await ownProfile(state.reset, state.email);
    await assertSecureSession(
      state.reset,
      state.completion.response,
      world.hostBaseUrl,
    );
    const fresh = await privatePage(browser, state, world.hostBaseUrl);
    const accepted = await passwordSignIn(
      fresh,
      world.hostBaseUrl,
      state,
      state.newPassword,
    );
    expect(
      accepted.response.status(),
      "new password independently accepted",
    ).toBe(200);
    await fresh.waitForURL((url) => url.pathname === "/account");
    await ownProfile(fresh, state.email);
    await assertSecureSession(fresh, accepted.response, world.hostBaseUrl);
    const guest = await privatePage(browser, state, world.hostBaseUrl);
    const refused = await passwordSignIn(
      guest,
      world.hostBaseUrl,
      state,
      state.password,
    );
    expect(
      refused.response.status(),
      "original password refused after reset",
    ).toBe(401);
    let genericRefusal = false;
    try {
      const body = JSON.parse(refused.body);
      genericRefusal =
        Object.keys(body).length === 3 &&
        body.message === "invalid credentials" &&
        body.statusCode === 401 &&
        body.error === "Unauthorized";
    } catch {
      // A broken response projects to false without retaining response bytes.
    }
    expect(genericRefusal, "old-password refusal is generic").toBe(true);
    await assertNoPrivateRegistrationAccess(
      guest,
      (await refused.response.headerValue("set-cookie")) ?? "",
      state,
    );
    expect(
      state.resetPosts,
      "one request, one refusal and one delivered reset",
    ).toEqual([
      "/v1/auth/password/reset",
      "/v1/auth/password/reset/complete",
      "/v1/auth/password/reset/complete",
    ]);
  },
);

After("@password-reset-mail", async ({ page }) => {
  const state = resets.get(page);
  if (!state) return;
  try {
    await Promise.all(
      state.contexts.map(async (context) => {
        try {
          const active = context.pages()[0];
          if (
            active &&
            (await context.cookies()).some(
              (cookie) => cookie.name === "__Host-ds_session",
            )
          ) {
            const revoked = await active.evaluate(async () => {
              const logout = await fetch("/v1/auth/logout", {
                method: "POST",
                credentials: "include",
              });
              const profile = await fetch("/v1/me/profile", {
                credentials: "include",
                cache: "no-store",
              });
              return { logout: logout.status, profile: profile.status };
            });
            expect(
              [200, 401].includes(revoked.logout) && revoked.profile === 401,
              "owned reset-mail session is revoked or already invalidated",
            ).toBe(true);
          }
        } finally {
          // Own pages close before fixture failure diagnostics can retain a code.
          await Promise.all(context.pages().map((owned) => owned.close()));
          await context.close();
        }
      }),
    );
  } finally {
    resets.delete(page);
  }
});
