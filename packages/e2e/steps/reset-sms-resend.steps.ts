import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { randomUUID } from "node:crypto";
import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import {
  expect,
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
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
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
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface ResendReset {
  email: string;
  password: string;
  newPassword: string;
  phone: string;
  sink: string;
  contexts: BrowserContext[];
  httpCredentials: BrowserContextOptions["httpCredentials"];
  owner?: Page;
  reset?: Page;
  subject?: string;
  cookie?: string;
  resetCompleted: boolean;
  requests: number;
  before?: SmsCheckpoint;
  first?: SmsCheckpoint;
  code?: string;
}
const journeys = new WeakMap<Page, ResendReset>();
function journey(page: Page) {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned SMS reset resend journey missing");
  return state;
}
async function privatePage(browser: Browser, state: ResendReset, base: string) {
  const context = await browser.newContext({
    locale: "ru-RU",
    ...(state.httpCredentials
      ? { httpCredentials: state.httpCredentials }
      : {}),
  });
  state.contexts.push(context);
  context.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname ===
        signInHostApiPath("/v1/auth/password/reset")
    )
      state.requests++;
  });
  await prepareCaptchaForJourney(
    context,
    base,
    process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
  );
  return context.newPage();
}
async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}
async function sameOwner(page: Page, state: ResendReset) {
  const result = await page.evaluate(
    async ({ email, phone, subject }) => {
      const p = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const s = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await p.json().catch(() => ({}));
      const session = await s.json().catch(() => ({}));
      return {
        subject: session.sub as string | undefined,
        evidence: {
          profile: p.status,
          session: s.status,
          sameEmail: profile.email === email,
          verified: profile.emailVerified === true,
          samePhone: profile.phone === phone,
          phoneVerified: profile.phoneVerified === true,
          sameSubject:
            typeof session.sub === "string" &&
            !!session.sub &&
            (subject === undefined || session.sub === subject),
        },
      };
    },
    { email: state.email, phone: state.phone, subject: state.subject },
  );
  expect(result.evidence, "same verified phone-confirmed owner").toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
    samePhone: true,
    phoneVerified: true,
    sameSubject: true,
  });
  if (!result.subject)
    throw new Error("Owned SMS reset resend subject missing");
  state.subject ??= result.subject;
}
async function requestResult(page: Page, state: ResendReset) {
  const result = await captureResponse(
    page,
    signInHostApiPath("/v1/auth/password/reset"),
  );
  let matches = false;
  try {
    matches =
      result.response.request().postDataJSON().identifier === state.phone &&
      result.body === '{"status":"reset_requested"}';
  } catch {
    /* Suppress credential-bearing diagnostics. */
  }
  expect({ status: result.response.status(), matches }).toEqual({
    status: 200,
    matches: true,
  });
  await assertNoPrivateRegistrationAccess(
    page,
    (await result.response.headerValue("set-cookie")) ?? "",
    state,
  );
}
async function delivery(state: ResendReset, before: SmsCheckpoint) {
  const code = await waitForSmsCode(
    state.sink,
    state.phone,
    before,
    resetSmsCode,
    RESET_CODE_EVENT,
  );
  const messages = await smsSinkMessages(state.sink, state.phone, before);
  expect(messages.length, "one fresh addressed sink delivery").toBe(1);
  expect(
    resetSmsCode(messages[0]!) === code && /^\d{6}$/.test(code),
    "fresh reset event carries the received six-digit code",
  ).toBe(true);
  return code;
}
Given(
  "an owned verified Academy doctor with a confirmed phone is prepared for an SMS reset resend",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("SMS reset resend requires the real SMS sink");
    const state: ResendReset = {
      email: `reset-resend-3182-${randomUUID()}@example.test`,
      password: `Old-${randomUUID()}-aA1!`,
      newPassword: `New-${randomUUID()}-aA1!`,
      phone: freshConfirmablePhone(),
      sink,
      contexts: [],
      httpCredentials,
      requests: 0,
      resetCompleted: false,
    };
    journeys.set(page, state);
    const owner = await privatePage(browser, state, world.hostBaseUrl);
    state.owner = owner;
    const { response, body, code } = await registerOwnedCredentials(
      owner,
      world.hostBaseUrl,
      state,
      "/account",
    );
    expect(
      registrationEvidence(
        response.request().postData() ?? "",
        body,
        state,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    const pending = captureResponse(
      owner,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      owner.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect({
      status: verified.response.status(),
      ...verificationEvidence(
        verified.response.request().postData() ?? "",
        verified.body,
        state,
        code,
        world.hostBaseUrl,
      ),
    }).toEqual({
      status: 200,
      credentialsMatch: true,
      acknowledgementMatches: true,
    });
    await owner.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await owner.waitForLoadState("networkidle");
    await assertSecureSession(owner, verified.response, world.hostBaseUrl);
    await confirmOwnedPhone(owner, { phone: state.phone, sink });
    await sameOwner(owner, state);
    const cookie = (await owner.context().cookies()).find(
      (cookie) => cookie.name === SESSION,
    )?.value;
    if (!cookie) throw new Error("Original owner session cookie missing");
    state.cookie = cookie;
    expect(Boolean(state.cookie), "original owner holds a secure session").toBe(
      true,
    );
  },
);
When(
  "the SMS reset resend guest requests an actual reset code and observes disabled resend",
  async ({ page, browser, world }) => {
    const state = journey(page);
    const reset = await privatePage(browser, state, world.hostBaseUrl);
    state.reset = reset;
    await open(reset, `${world.hostBaseUrl}/reset`);
    await inputSecret(
      reset.locator('input[autocomplete="username"]'),
      state.phone,
    );
    await reset.clock.install();
    // Freeze the page before its countdown, using its own clock with protocol headroom.
    const pausePoint = await reset.evaluate(() => Date.now() + 60_000);
    await reset.clock.pauseAt(new Date(pausePoint));
    state.before = await captureSmsCheckpoint(state.sink, state.phone);
    const pending = requestResult(reset, state);
    await reset.getByTestId("reset-request-submit").click();
    await pending;
    await delivery(state, state.before);
    state.first = await captureSmsCheckpoint(state.sink, state.phone);
    await expect(reset.getByTestId("reset-resend")).toBeDisabled();
    expect(state.requests, "exactly one initial reset request").toBe(1);
  },
);
When(
  "only that browser's thirty-second reset cooldown advances before the actual SMS resend click",
  async ({ page }) => {
    const state = journey(page);
    const reset = state.reset!;
    const resend = reset.getByTestId("reset-resend");
    await expect(resend).toBeDisabled();
    // 003 EARS-17: advance page intervals only, never a server clock or counter.
    for (let second = 0; second < 30; second++) {
      await reset.clock.runFor(1000);
      await reset.evaluate(
        () => new Promise<void>((resolve) => queueMicrotask(resolve)),
      );
    }
    await expect(resend).toBeEnabled();
    expect(state.requests, "UI clock advancement sends nothing").toBe(1);
    const before = await captureSmsCheckpoint(state.sink, state.phone);
    expect(
      state.first !== undefined &&
        before.messageIds.length === state.first.messageIds.length &&
        before.messageIds.every((id) => state.first!.messageIds.includes(id)),
      "no extra delivery before the actual resend",
    ).toBe(true);
    const pending = requestResult(reset, state);
    await resend.click();
    await pending;
    state.code = await delivery(state, before);
    expect(state.requests, "initial request and one actual resend only").toBe(
      2,
    );
    await expect(resend).toBeDisabled();
    await expect(resend).toContainText("30");
    await expect(
      reset.locator('input[autocomplete="one-time-code"]'),
    ).toHaveValue("");
    await reset.clock.resume();
    await sameOwner(state.owner!, state);
  },
);
Then(
  "the newest actual reset SMS changes only that owner's password and preserves identity through sign-in reload and logout",
  async ({ page, browser, world }) => {
    const state = journey(page);
    const reset = state.reset!;
    if (!state.code) throw new Error("Resent reset code missing");
    await inputSecret(
      reset.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    await inputSecret(
      reset.locator('input[autocomplete="new-password"]'),
      state.newPassword,
    );
    const pending = captureResponse(
      reset,
      signInHostApiPath("/v1/auth/password/reset/complete"),
    );
    await reset.locator('form button[type="submit"]').click();
    const completed = await pending;
    let matches = false;
    try {
      const body = completed.response.request().postDataJSON();
      matches =
        body.identifier === state.phone &&
        body.code === state.code &&
        body.newPassword === state.newPassword &&
        storefrontCallbackAcknowledgement(completed.body, world.hostBaseUrl);
    } catch {
      /* Discard secret-bearing diagnostics. */
    }
    expect({ status: completed.response.status(), matches }).toEqual({
      status: 200,
      matches: true,
    });
    state.resetCompleted = true;
    await reset.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await reset.waitForLoadState("networkidle");
    await assertSecureSession(reset, completed.response, world.hostBaseUrl, [
      state.cookie!,
    ]);
    await sameOwner(reset, state);
    expect(
      await state.owner!.evaluate(async () => ({
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
      })),
      "reset revoked the original owner session",
    ).toEqual({ session: 401, profile: 401 });
    await reset.reload({ waitUntil: "load" });
    await reset.waitForLoadState("networkidle");
    await sameOwner(reset, state);
    const login = async (password: string) => {
      const target = await privatePage(browser, state, world.hostBaseUrl);
      await open(target, `${world.hostBaseUrl}/login?returnTo=%2Faccount`);
      await inputSecret(
        target.locator('input[autocomplete="username"]'),
        state.email,
      );
      await inputSecret(
        target.locator('input[autocomplete="current-password"]'),
        password,
      );
      const result = captureResponse(
        target,
        signInHostApiPath("/v1/auth/login"),
      );
      await target.getByTestId("password-login-submit").click();
      return { target, result: await result };
    };
    let attemptFailed = false;
    const refused = await runGatedLoginAttempt(
      {
        close: async () => {
          try {
            const accepted = await login(state.newPassword);
            expect(
              accepted.result.response.status(),
              "new password signs in and closes the login failure window",
            ).toBe(200);
            await accepted.target.waitForURL(
              (url) => url.pathname === "/account",
            );
            await accepted.target.waitForLoadState("networkidle");
            await assertSecureSession(
              accepted.target,
              accepted.result.response,
              world.hostBaseUrl,
              [state.cookie!],
            );
            await sameOwner(accepted.target, state);
            await accepted.target.reload({ waitUntil: "load" });
            await accepted.target.waitForLoadState("networkidle");
            await sameOwner(accepted.target, state);
          } catch {
            if (!attemptFailed)
              throw new Error("Owned new-password sign-in closure failed");
            test.info().annotations.push({
              type: "cleanup-failed",
              description:
                "Owned sign-in closure failed; original failure preserved.",
            });
          }
        },
      },
      async () => {
        try {
          return await login(state.password);
        } catch (error) {
          attemptFailed = true;
          throw error;
        }
      },
    );
    expect(
      refused.result.response.status(),
      "the original password is refused",
    ).toBe(401);
    await assertNoPrivateRegistrationAccess(
      refused.target,
      (await refused.result.response.headerValue("set-cookie")) ?? "",
      state,
    );
    expect(
      state.requests,
      "completion and password sign-ins issue no further reset challenges",
    ).toBe(2);
  },
);

After("@reset-sms-resend", async ({ page, world }) => {
  const state = journeys.get(page);
  if (!state) return;
  const failures: string[] = [];
  for (const [index, context] of state.contexts.entries()) {
    try {
      const active = context.pages().find((candidate) => {
        try {
          return (
            new URL(candidate.url()).origin ===
            new URL(world.hostBaseUrl).origin
          );
        } catch {
          return false;
        }
      });
      if (
        active &&
        (await context.cookies()).some((cookie) => cookie.name === SESSION)
      ) {
        // Only the pre-reset registration session is expected to be already revoked.
        const revokedEarlier =
          state.resetCompleted && context === state.owner?.context();
        const evidence = await active.evaluate(async () => {
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
          evidence,
          "exact owned session logout and private refusal",
        ).toEqual({
          logout: revokedEarlier ? 401 : 200,
          session: 401,
          profile: 401,
        });
        if (!revokedEarlier)
          expect(
            (await context.cookies()).some((cookie) => cookie.name === SESSION),
            "owned cookie cleared",
          ).toBe(false);
      } else if (
        (await context.cookies()).some((cookie) => cookie.name === SESSION)
      )
        throw new Error("Owned cleanup page missing");
    } catch {
      failures.push(`context-${index}-logout`);
    } finally {
      await context
        .close()
        .catch(() => failures.push(`context-${index}-close`));
    }
  }
  state.code = "";
  journeys.delete(page);
  if (failures.length) {
    const message = `Owned SMS reset resend cleanup failed: ${failures.join(", ")}`;
    if (test.info().status === test.info().expectedStatus)
      throw new Error(message);
    test.info().annotations.push({
      type: "cleanup-failed",
      description: `${message}; original failure preserved.`,
    });
  }
});
