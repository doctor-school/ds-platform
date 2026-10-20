import { randomUUID } from "node:crypto";
import {
  expect,
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { runGatedLoginAttempt } from "../lib/login-failure-gate.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  assertNoPrivateRegistrationAccess,
  differentVerificationCode,
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  RESET_CODE_EVENT,
  captureSmsCheckpoint,
  freshConfirmablePhone,
  resetSmsCode,
  smsSinkMessages,
  smsSinkUrl,
  waitForSmsCode,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface ResetRefusal {
  email: string;
  password: string;
  newPassword: string;
  phone: string;
  sink: string;
  httpCredentials: BrowserContextOptions["httpCredentials"];
  contexts: BrowserContext[];
  closures: APIRequestContext[];
  owner?: Page;
  reset?: Page;
  subject?: string;
  cookie?: string | undefined;
  code?: string;
  resetCompleted?: boolean;
  resetPosts: string[];
}
const journeys = new WeakMap<Page, ResetRefusal>();
function journey(page: Page) {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned SMS reset refusal account missing");
  return state;
}
async function privatePage(
  browser: Browser,
  state: ResetRefusal,
  base: string,
) {
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
async function sameOwner(page: Page, state: ResetRefusal) {
  const result = await page.evaluate(
    async (owned) => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const p = await profile.json().catch(() => ({}));
      const s = await session.json().catch(() => ({}));
      return {
        subject: typeof s.sub === "string" ? s.sub : null,
        safe: {
          profile: profile.status,
          session: session.status,
          sameEmail: p.email === owned.email,
          emailVerified: p.emailVerified === true,
          samePhone: p.phone === owned.phone,
          phoneVerified: p.phoneVerified === true,
          sameSubject:
            typeof s.sub === "string" &&
            s.sub.length > 0 &&
            (!owned.subject || s.sub === owned.subject),
        },
      };
    },
    { email: state.email, phone: state.phone, subject: state.subject },
  );
  expect(result.safe, "original verified doctor and confirmed phone").toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    emailVerified: true,
    samePhone: true,
    phoneVerified: true,
    sameSubject: true,
  });
  if (!result.subject) throw new Error("Owned SMS reset subject missing");
  state.subject ??= result.subject;
}
async function revoke(context: APIRequestContext, base: string) {
  const logout = await context.post(`${base}/v1/auth/logout`);
  const session = await context.get(`${base}/v1/auth/session`);
  const profile = await context.get(`${base}/v1/me/profile`);
  expect(
    {
      logout: logout.status(),
      session: session.status(),
      profile: profile.status(),
    },
    "exact owned session revoked or already invalidated",
  ).toEqual({ logout: 200, session: 401, profile: 401 });
}
async function revokeBrowser(page: Page) {
  const result = await page.evaluate(async () => {
    const logout = await fetch("/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    const session = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    const profile = await fetch("/v1/me/profile", {
      credentials: "include",
      cache: "no-store",
    });
    return {
      logout: logout.status,
      session: session.status,
      profile: profile.status,
    };
  });
  expect(
    result,
    "same-browser fingerprint revokes the exact owned session",
  ).toEqual({ logout: 200, session: 401, profile: 401 });
  expect(
    (await page.context().cookies()).some((c) => c.name === SESSION),
    "logout removes the private browser cookie",
  ).toBe(false);
}
async function passwordSignIn(
  page: Page,
  state: ResetRefusal,
  base: string,
  password: string,
) {
  await page.goto(`${base}/login?method=password&returnTo=%2Faccount`, {
    waitUntil: "load",
  });
  await page.waitForLoadState("networkidle");
  await inputSecret(
    page.locator('input[autocomplete="username"]'),
    state.email,
  );
  await inputSecret(
    page.locator('input[autocomplete="current-password"]'),
    password,
  );
  let attemptFailed = false;
  const accepted = await runGatedLoginAttempt(
    {
      close: async () => {
        let failed = false;
        let closure: APIRequestContext | undefined;
        try {
          closure = await request.newContext({
            baseURL: base,
            ...(state.httpCredentials
              ? { httpCredentials: state.httpCredentials }
              : {}),
          });
          state.closures.push(closure);
          const response = await closure.post("/v1/auth/login", {
            data: { identifier: state.email, password },
          });
          expect(
            response.status(),
            "owned successful login closes suite gate",
          ).toBe(200);
          await revoke(closure, base);
          await closure.dispose();
          state.closures = state.closures.filter((owned) => owned !== closure);
        } catch {
          failed = true;
        }
        if (failed) {
          if (!attemptFailed)
            throw new Error("Owned password closure or cleanup failed");
          test.info().annotations.push({
            type: "cleanup-failed",
            description:
              "Owned password closure failed; original attempt failure retained.",
          });
        }
      },
    },
    async () => {
      try {
        const pending = captureResponse(page, "/v1/auth/login");
        await page.getByTestId("password-login-submit").click();
        const result = await pending;
        let exactCommand = false;
        try {
          const command = result.response.request().postDataJSON();
          exactCommand =
            command.identifier === state.email && command.password === password;
        } catch {
          /* Secret-bearing commands project to false. */
        }
        expect(
          {
            status: result.response.status(),
            exactCommand,
            tokenFree: result.body === '{"status":"authenticated"}',
          },
          "owned password is accepted by actual login",
        ).toEqual({ status: 200, exactCommand: true, tokenFree: true });
        return result;
      } catch (error) {
        attemptFailed = true;
        throw error;
      }
    },
  );
  await page.waitForURL((url) => url.pathname === "/account");
  await sameOwner(page, state);
  await assertSecureSession(page, accepted.response, base);
}

Given(
  "an owned Academy SMS-reset refusal account verifies email and confirms a fresh phone while staying signed in",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("SMS reset refusal requires E2E_SMS_SINK_URL");
    const state: ResetRefusal = {
      email: `wave-q-3101-${randomUUID()}@example.test`,
      password: `Original-${randomUUID()}-aA1!`,
      newPassword: `Replacement-${randomUUID()}-aA1!`,
      phone: freshConfirmablePhone(),
      sink,
      httpCredentials,
      contexts: [],
      closures: [],
      resetPosts: [],
    };
    journeys.set(page, state);
    await test.info().attach("owned-fixture", {
      body: JSON.stringify({
        issue: 3101,
        email: state.email,
        phone: state.phone,
      }),
      contentType: "application/json",
    });
    const owner = await privatePage(browser, state, world.hostBaseUrl);
    state.owner = owner;
    const { code } = await registerOwnedCredentials(
      owner,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const pending = captureResponse(owner, "/v1/auth/verify");
    await inputSecret(
      owner.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "real registration email verified").toBe(
      200,
    );
    await owner.waitForURL((url) => url.pathname === "/account");
    await owner.waitForLoadState("networkidle");
    await assertSecureSession(owner, verified.response, world.hostBaseUrl);
    await confirmOwnedPhone(owner, { phone: state.phone, sink });
    await sameOwner(owner, state);
    state.cookie = (await owner.context().cookies()).find(
      (c) => c.name === SESSION,
    )?.value;
    expect(Boolean(state.cookie), "original session cookie exists").toBe(true);
  },
);

When(
  "an independent Academy guest retains the real addressed SMS reset code and submits different valid digits with a new password",
  async ({ page, browser, world }) => {
    const state = journey(page);
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
    await inputSecret(
      reset.locator('input[autocomplete="username"]'),
      state.phone,
    );
    const checkpoint = await captureSmsCheckpoint(state.sink, state.phone);
    const pending = captureResponse(reset, "/v1/auth/password/reset");
    await reset.getByTestId("reset-request-submit").click();
    const requested = await pending;
    expect({
      status: requested.response.status(),
      neutral: requested.body === '{"status":"reset_requested"}',
    }).toEqual({ status: 200, neutral: true });
    state.code = await waitForSmsCode(
      state.sink,
      state.phone,
      checkpoint,
      resetSmsCode,
      RESET_CODE_EVENT,
    );
    const delivered = await smsSinkMessages(
      state.sink,
      state.phone,
      checkpoint,
      RESET_CODE_EVENT,
    );
    expect(
      {
        oneFreshDelivery: delivered.length === 1,
        sameCode:
          delivered.length === 1 && resetSmsCode(delivered[0]!) === state.code,
        sixDigits: /^\d{6}$/.test(state.code),
      },
      "real recipient-bound reset SMS beyond store message-ID checkpoint",
    ).toEqual({ oneFreshDelivery: true, sameCode: true, sixDigits: true });
    await assertNoPrivateRegistrationAccess(
      reset,
      (await requested.response.headerValue("set-cookie")) ?? "",
      state,
    );
    const wrong = differentVerificationCode(state.code);
    expect(
      /^\d{6}$/.test(wrong) && wrong !== state.code,
      "different valid six-digit code",
    ).toBe(true);
    await inputSecret(
      reset.locator('input[autocomplete="one-time-code"]'),
      wrong,
    );
    await inputSecret(
      reset.locator('input[autocomplete="new-password"]'),
      state.newPassword,
    );
    const completion = captureResponse(
      reset,
      "/v1/auth/password/reset/complete",
    );
    await reset.locator('form button[type="submit"]').click();
    const refused = await completion;
    let exactCommand = false;
    let genericRefusal = false;
    try {
      const command = refused.response.request().postDataJSON();
      const body = JSON.parse(refused.body);
      exactCommand =
        command.identifier === state.phone &&
        command.code === wrong &&
        command.newPassword === state.newPassword;
      genericRefusal =
        Object.keys(body).length === 3 &&
        body.statusCode === 400 &&
        body.message === "the request could not be completed" &&
        body.error === "Bad Request";
    } catch {
      /* Never retain secret-bearing parse diagnostics. */
    }
    expect({
      status: refused.response.status(),
      exactCommand,
      genericRefusal,
    }).toEqual({ status: 400, exactCommand: true, genericRefusal: true });
    await expect
      .poll(() => reset.getByTestId("reset-error").ariaSnapshot())
      .toBe("- alert: Код не подошёл или пароль отклонён.");
    await assertNoPrivateRegistrationAccess(
      reset,
      (await refused.response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

Then(
  "the SMS reset refusal preserves the original owner's session identity and password without replacing the retained challenge",
  async ({ page, browser, world }) => {
    const state = journey(page);
    if (!state.owner) throw new Error("Original SMS reset owner page missing");
    await sameOwner(state.owner, state);
    expect(
      (await state.owner.context().cookies()).find((c) => c.name === SESSION)
        ?.value === state.cookie,
      "wrong reset code leaves original owner cookie unchanged",
    ).toBe(true);
    const unchanged = await privatePage(browser, state, world.hostBaseUrl);
    // 003 EARS-12; ZitadelIdpClient.completePasswordReset owns the User-v2
    // challenge independently from the Session-v2 password-login check.
    await passwordSignIn(unchanged, state, world.hostBaseUrl, state.password);
    await revokeBrowser(unchanged);
  },
);

When(
  "the SMS reset guest submits that same retained delivered code with the distinct new password",
  async ({ page, world }) => {
    const state = journey(page);
    if (!state.reset || !state.code || !state.cookie)
      throw new Error("Retained SMS reset state missing");
    const reset = state.reset;
    const code = reset.locator('input[autocomplete="one-time-code"]');
    await expect
      .poll(() =>
        code.evaluate((element) => (element as HTMLInputElement).value === ""),
      )
      .toBe(true);
    await expect
      .poll(() =>
        code.evaluate(
          (element) =>
            document.activeElement === element &&
            (element as HTMLInputElement).selectionStart === 0 &&
            (element as HTMLInputElement).selectionEnd === 0,
        ),
      )
      .toBe(true);
    expect(new URL(reset.url()).pathname).toBe("/reset");
    expect(new URL(reset.url()).searchParams.get("returnTo")).toBe("/account");
    await inputSecret(code, state.code);
    await inputSecret(
      reset.locator('input[autocomplete="new-password"]'),
      state.newPassword,
    );
    const pending = captureResponse(reset, "/v1/auth/password/reset/complete");
    await reset.locator('form button[type="submit"]').click();
    const completed = await pending;
    let exactCommand = false;
    try {
      const command = completed.response.request().postDataJSON();
      exactCommand =
        command.identifier === state.phone &&
        command.code === state.code &&
        command.newPassword === state.newPassword;
    } catch {
      /* Secret-bearing command projects to false. */
    }
    expect({
      status: completed.response.status(),
      exactCommand,
      tokenFree: completed.body === '{"status":"reset_completed"}',
    }).toEqual({ status: 200, exactCommand: true, tokenFree: true });
    state.resetCompleted = true;
    await reset.waitForURL((url) => url.pathname === "/account");
    await sameOwner(reset, state);
    await assertSecureSession(reset, completed.response, world.hostBaseUrl, [
      state.cookie,
    ]);
  },
);

Then(
  "SMS reset completion revokes the prior owner session and the new password signs in the original doctor before owned logout",
  async ({ page, browser, world }) => {
    const state = journey(page);
    if (!state.owner || !state.reset)
      throw new Error("SMS reset browser contexts missing");
    const denied = await state.owner.evaluate(async () => ({
      profile: (
        await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        })
      ).status,
      session: (
        await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        })
      ).status,
    }));
    expect(denied, "prior owner session revoked by successful reset").toEqual({
      profile: 401,
      session: 401,
    });
    const fresh = await privatePage(browser, state, world.hostBaseUrl);
    await passwordSignIn(fresh, state, world.hostBaseUrl, state.newPassword);
    await fresh.reload({ waitUntil: "load" });
    await fresh.waitForLoadState("networkidle");
    await sameOwner(fresh, state);
    expect(
      state.resetPosts,
      "one reset request, one refusal, same delivered-code completion",
    ).toEqual([
      "/v1/auth/password/reset",
      "/v1/auth/password/reset/complete",
      "/v1/auth/password/reset/complete",
    ]);
    await revokeBrowser(fresh);
    await revokeBrowser(state.reset);
  },
);

After("@sms-reset-code-refusal", async ({ page, world }) => {
  const state = journeys.get(page);
  if (!state) return;
  const failures: string[] = [];
  for (const context of state.contexts) {
    try {
      if ((await context.cookies()).some((c) => c.name === SESSION)) {
        const origin = new URL(world.hostBaseUrl).origin;
        const active = context.pages().find((owned) => {
          try {
            return new URL(owned.url()).origin === origin;
          } catch {
            return false;
          }
        });
        if (!active) throw new Error("Owned SMS reset cleanup page missing");
        if (state.resetCompleted && context === state.owner?.context()) {
          const denied = await active.evaluate(async () => ({
            session: (
              await fetch("/v1/auth/session", {
                credentials: "include",
                cache: "no-store",
              })
            ).status,
            profile: (
              await fetch("/v1/me/profile", {
                credentials: "include",
                cache: "no-store",
              })
            ).status,
          }));
          expect(
            denied,
            "completed reset already revoked the original owner session",
          ).toEqual({ session: 401, profile: 401 });
        } else await revokeBrowser(active);
      }
    } catch {
      failures.push("owned-browser-session-revocation");
    } finally {
      await context.close().catch(() => failures.push("browser-context-close"));
    }
  }
  for (const closure of state.closures) {
    try {
      await revoke(closure, world.hostBaseUrl);
    } catch {
      failures.push("owned-closing-session-revocation");
    } finally {
      await closure
        .dispose()
        .catch(() => failures.push("closing-context-disposal"));
    }
  }
  delete state.code;
  delete state.cookie;
  journeys.delete(page);
  if (failures.length) {
    const message = `Owned SMS reset refusal cleanup failed: ${failures.join(", ")}`;
    if (test.info().status === test.info().expectedStatus)
      throw new Error(message);
    test.info().annotations.push({
      type: "cleanup-failed",
      description: `${message}; original scenario failure retained.`,
    });
  }
});
