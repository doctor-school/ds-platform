import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { signInHostApiPath } from "../lib/sign-in-host-api.js";
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
  RESET_CODE_EVENT,
  captureSmsCheckpoint,
  freshConfirmablePhone,
  resetSmsCode,
  smsSinkMessages,
  smsSinkUrl,
  waitForSmsCode,
} from "../lib/sms-sink.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface SmsResetReuse {
  email: string;
  phone: string;
  sink: string;
  resetRequests: number;
  password: string;
  acceptedPassword: string;
  rejectedPassword: string;
  contexts: BrowserContext[];
  closures: APIRequestContext[];
  httpCredentials: BrowserContextOptions["httpCredentials"];
  recovered?: Page;
  code?: string;
  subject?: string;
  cookie?: string;
}
const journeys = new WeakMap<Page, SmsResetReuse>();
function journey(page: Page): SmsResetReuse {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned reset-code reuse journey missing");
  return state;
}
async function privatePage(
  browser: Browser,
  state: SmsResetReuse,
  base: string,
) {
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
      state.resetRequests++;
  });
  await prepareCaptchaForJourney(
    context,
    base,
    process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
  );
  return context.newPage();
}
async function sameOwner(page: Page, state: SmsResetReuse) {
  const result = await page.evaluate(
    async ({ email, phone, subject }) => {
      const profileResponse = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await profileResponse.json().catch(() => ({}));
      const session = await sessionResponse.json().catch(() => ({}));
      return {
        subject: session.sub as string | undefined,
        evidence: {
          profile: profileResponse.status,
          session: sessionResponse.status,
          sameEmail: profile.email === email,
          verified: profile.emailVerified === true,
          samePhone: profile.phone === phone,
          phoneVerified: profile.phoneVerified === true,
          sameSubject:
            typeof session.sub === "string" &&
            !!session.sub &&
            (subject === undefined || subject === session.sub),
        },
      };
    },
    { email: state.email, phone: state.phone, subject: state.subject },
  );
  expect(result.evidence, "same verified owned account").toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
    samePhone: true,
    phoneVerified: true,
    sameSubject: true,
  });
  if (!result.subject) throw new Error("Owned reset-reuse subject missing");
  state.subject ??= result.subject;
}
async function noPrivateAccess(page: Page) {
  expect(
    (await page.context().cookies()).some((c) => c.name === SESSION),
    "refusal minted no browser session",
  ).toBe(false);
  expect(
    await page.evaluate(async () => ({
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
    "guest cannot access private owner data",
  ).toEqual({ session: 401, profile: 401 });
}
async function passwordLogin(
  page: Page,
  base: string,
  state: SmsResetReuse,
  password: string,
) {
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
  let attemptFailed = false;
  return runGatedLoginAttempt(
    {
      close: async () => {
        let closingFailed = false;
        let closing: Awaited<ReturnType<typeof request.newContext>>;
        try {
          closing = await request.newContext({
            baseURL: base,
            ...(state.httpCredentials
              ? { httpCredentials: state.httpCredentials }
              : {}),
          });
        } catch {
          if (!attemptFailed)
            throw new Error("Owned login closure context could not be created");
          test.info().annotations.push({
            type: "cleanup-failed",
            description:
              "Owned login closure context failed; original password attempt failure retained.",
          });
          return;
        }
        try {
          state.closures.push(closing);
          const accepted = await closing.post("/v1/auth/login", {
            data: { identifier: state.email, password: state.acceptedPassword },
          });
          expect(
            accepted.status(),
            "owned successful sign-in closes the failure window",
          ).toBe(200);
        } catch {
          closingFailed = true;
        } finally {
          try {
            const revoked = await closing.post("/v1/auth/logout");
            expect(
              revoked.status(),
              "exact owned closing session is revoked",
            ).toBe(200);
          } catch {
            closingFailed = true;
          } finally {
            if (!closingFailed) {
              await closing.dispose().catch(() => {
                closingFailed = true;
              });
              if (!closingFailed)
                state.closures = state.closures.filter(
                  (owned) => owned !== closing,
                );
            }
          }
        }
        if (closingFailed) {
          if (!attemptFailed)
            throw new Error(
              "Owned successful-login closure or its session cleanup failed",
            );
          test.info().annotations.push({
            type: "cleanup-failed",
            description:
              "Owned login closure failed; original password attempt failure retained; lead must inspect scoped cleanup.",
          });
        }
      },
    },
    async () => {
      try {
        const pending = captureResponse(
          page,
          signInHostApiPath("/v1/auth/login"),
        );
        await page.getByTestId("password-login-submit").click();
        return await pending;
      } catch (error) {
        attemptFailed = true;
        throw error;
      }
    },
  );
}

Given(
  "a uniquely owned phone-confirmed Academy account consumes its delivered SMS password reset code once",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink)
      throw new Error("SMS sink required for consumed SMS reset proof");
    const state: SmsResetReuse = {
      phone: freshConfirmablePhone(),
      sink,
      resetRequests: 0,
      email: `reset-sms-code-reuse-3128-${randomUUID()}@example.test`,
      password: `Original-${randomUUID()}-aA1!`,
      acceptedPassword: `Accepted-${randomUUID()}-aA1!`,
      rejectedPassword: `Replayed-${randomUUID()}-aA1!`,
      contexts: [],
      closures: [],
      httpCredentials,
    };
    journeys.set(page, state);
    const owner = await privatePage(browser, state, world.hostBaseUrl);
    const { code } = await registerOwnedCredentials(
      owner,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const verifying = captureResponse(
      owner,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      owner.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    expect((await verifying).response.status(), "registration verified").toBe(
      200,
    );
    await owner.waitForURL((url) => url.pathname === "/account");
    await confirmOwnedPhone(owner, { phone: state.phone, sink });
    await sameOwner(owner, state);
    expect(
      await owner.evaluate(
        async () =>
          (
            await fetch("/v1/auth/logout", {
              method: "POST",
              credentials: "include",
            })
          ).status,
      ),
      "owned registration session logged out before reset",
    ).toBe(200);
    await noPrivateAccess(owner);

    const reset = await privatePage(browser, state, world.hostBaseUrl);
    state.recovered = reset;
    await reset.goto(`${world.hostBaseUrl}/reset?returnTo=%2Faccount`, {
      waitUntil: "load",
    });
    await reset.waitForLoadState("networkidle");
    await inputSecret(
      reset.locator('input[autocomplete="username"]'),
      state.phone,
    );
    const before = await captureSmsCheckpoint(state.sink, state.phone);
    const requested = captureResponse(
      reset,
      signInHostApiPath("/v1/auth/password/reset"),
    );
    await reset.getByTestId("reset-request-submit").click();
    expect((await requested).response.status(), "reset requested").toBe(200);
    state.code = await waitForSmsCode(
      state.sink,
      state.phone,
      before,
      resetSmsCode,
      RESET_CODE_EVENT,
    );
    const delivered = await smsSinkMessages(
      state.sink,
      state.phone,
      before,
      RESET_CODE_EVENT,
    );
    expect(
      {
        exactlyOne: delivered.length === 1,
        sameCode:
          delivered.length === 1 && resetSmsCode(delivered[0]!) === state.code,
        sixDigits: /^\d{6}$/.test(state.code),
      },
      "real addressed SMS beyond message-ID checkpoint",
    ).toEqual({
      exactlyOne: true,
      sameCode: true,
      sixDigits: true,
    });
    await inputSecret(
      reset.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    await inputSecret(
      reset.locator('input[autocomplete="new-password"]'),
      state.acceptedPassword,
    );
    const completing = captureResponse(
      reset,
      signInHostApiPath("/v1/auth/password/reset/complete"),
    );
    await reset.locator('form button[type="submit"]').click();
    const completed = await completing;
    let exactCommand = false;
    try {
      const command = completed.response.request().postDataJSON();
      exactCommand =
        command.identifier === state.phone &&
        command.code === state.code &&
        command.newPassword === state.acceptedPassword;
    } catch {
      /* Secret-bearing request diagnostics project to false. */
    }
    expect(
      { status: completed.response.status(), exactCommand },
      "first delivered SMS reset accepted for the exact owner and password",
    ).toEqual({ status: 200, exactCommand: true });
    expect(
      storefrontCallbackAcknowledgement(completed.body, world.hostBaseUrl),
      "token-free reset acknowledgement",
    ).toBe(true);
    await reset.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await reset.waitForLoadState("networkidle");
    await assertSecureSession(reset, completed.response, world.hostBaseUrl);
    await sameOwner(reset, state);
    const cookie = (await reset.context().cookies()).find(
      (c) => c.name === SESSION,
    );
    expect(Boolean(cookie?.value), "recovered session exists").toBe(true);
    state.cookie = cookie!.value;
  },
);

When(
  "a guest Academy browser replays that consumed SMS reset code with a different private password",
  async ({ page, browser, world }) => {
    const state = journey(page);
    expect(
      Boolean(state.code),
      "the actually consumed code was retained privately",
    ).toBe(true);
    expect(
      state.acceptedPassword !== state.rejectedPassword,
      "different policy-conforming replay proposal",
    ).toBe(true);
    const guest = await privatePage(browser, state, world.hostBaseUrl);
    await guest.goto(`${world.hostBaseUrl}/reset`, { waitUntil: "load" });
    await guest.waitForLoadState("networkidle");
    await noPrivateAccess(guest);
    // 003 EARS-12/53: the replay must exercise the consumed challenge.
    const pending = captureResponse(
      guest,
      signInHostApiPath("/v1/auth/password/reset/complete"),
    );
    const evidence = await guest.evaluate(
      async ({ identifier, code, newPassword }) => {
        const response = await fetch("/v1/auth/password/reset/complete", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identifier, code, newPassword }),
        });
        const body = await response.json().catch(() => ({}));
        return {
          status: response.status,
          generic:
            Object.keys(body).length === 3 &&
            body.statusCode === 400 &&
            body.message === "the request could not be completed" &&
            body.error === "Bad Request",
        };
      },
      {
        identifier: state.phone,
        code: state.code,
        newPassword: state.rejectedPassword,
      },
    );
    const refused = await pending;
    expect(evidence, "consumed reset code is refused generically").toEqual({
      status: 400,
      generic: true,
    });
    expect(
      (await refused.response.headerValue("set-cookie")) === null,
      "replay mints no session cookie",
    ).toBe(true);
    await noPrivateAccess(guest);
    expect(
      state.resetRequests,
      "only the original reset challenge was requested",
    ).toBe(1);
    const recovered = state.recovered!;
    await recovered.reload({ waitUntil: "load" });
    await recovered.waitForLoadState("networkidle");
    await sameOwner(recovered, state);
    expect(
      (await recovered.context().cookies()).find((c) => c.name === SESSION)
        ?.value === state.cookie,
      "replay alone preserves the recovered owner's session before further logins",
    ).toBe(true);
  },
);

Then(
  "the accepted SMS reset password still opens the same phone-confirmed Academy account while the replay password cannot sign in",
  async ({ page, browser, world }) => {
    const state = journey(page);
    const rejected = await privatePage(browser, state, world.hostBaseUrl);
    const failure = await passwordLogin(
      rejected,
      world.hostBaseUrl,
      state,
      state.rejectedPassword,
    );
    expect(
      failure.response.status(),
      "replay-proposed password was never installed",
    ).toBe(401);
    expect(
      (await failure.response.headerValue("set-cookie")) === null,
      "rejected password mints no session",
    ).toBe(true);
    await noPrivateAccess(rejected);
    const accepted = await privatePage(browser, state, world.hostBaseUrl);
    const success = await passwordLogin(
      accepted,
      world.hostBaseUrl,
      state,
      state.acceptedPassword,
    );
    expect(success.response.status(), "accepted password remains valid").toBe(
      200,
    );
    expect(
      storefrontCallbackAcknowledgement(success.body, world.hostBaseUrl),
      "token-free login acknowledgement",
    ).toBe(true);
    await accepted.waitForURL((url) => url.pathname === "/account");
    await assertSecureSession(accepted, success.response, world.hostBaseUrl, [
      state.cookie!,
    ]);
    await sameOwner(accepted, state);
    const recovered = state.recovered!;
    await recovered.reload({ waitUntil: "load" });
    await recovered.waitForLoadState("networkidle");
    await sameOwner(recovered, state);
    expect(
      (await recovered.context().cookies()).find((c) => c.name === SESSION)
        ?.value === state.cookie,
      "consumed-code refusal preserves the recovered owner's original cookie",
    ).toBe(true);
  },
);

After("@reset-sms-code-reuse", async ({ page, world }) => {
  const state = journeys.get(page);
  if (!state) return;
  const failures: string[] = [];
  const origin = new URL(world.hostBaseUrl).origin;
  try {
    for (const [index, context] of state.contexts.entries()) {
      let operation = "cookies";
      let statuses:
        { logout: number; session: number; profile: number } | undefined;
      try {
        if ((await context.cookies()).some((c) => c.name === SESSION)) {
          operation = "same-origin-page";
          const active = context
            .pages()
            .find((p) => new URL(p.url()).origin === origin);
          if (!active)
            throw new Error("Owned reset-reuse session has no cleanup page");
          operation = "logout-and-private-refusal";
          statuses = await active.evaluate(async () => {
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
          expect(statuses, "exact owned reset-reuse session revoked").toEqual({
            logout: 200,
            session: 401,
            profile: 401,
          });
        }
      } catch (error) {
        failures.push(
          JSON.stringify({
            context: index,
            operation,
            statuses,
            failure:
              error instanceof Error && error.name === "TimeoutError"
                ? "timeout"
                : "operation-failed",
          }),
        );
      } finally {
        await context.close().catch(() => {
          failures.push(
            JSON.stringify({
              context: index,
              operation: "close-context",
              failure: "operation-failed",
            }),
          );
        });
      }
    }
    for (const closure of state.closures) {
      try {
        const logout = await closure.post(
          `${world.hostBaseUrl}/v1/auth/logout`,
        );
        const session = await closure.get(
          `${world.hostBaseUrl}/v1/auth/session`,
        );
        const profile = await closure.get(`${world.hostBaseUrl}/v1/me/profile`);
        expect(
          {
            logout: logout.status(),
            session: session.status(),
            profile: profile.status(),
          },
          "owned closing session revoked",
        ).toEqual({ logout: 200, session: 401, profile: 401 });
      } catch {
        failures.push("owned-closing-session-revocation");
      } finally {
        await closure
          .dispose()
          .catch(() => failures.push("closing-context-disposal"));
      }
    }
  } finally {
    delete state.code;
    delete state.cookie;
    journeys.delete(page);
  }
  if (failures.length > 0) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error(
        `Owned reset-reuse session cleanup failed: ${failures.join("; ")}`,
      );
    test.info().annotations.push({
      type: "cleanup-failed",
      description: `Owned reset-reuse cleanup failed; original scenario failure retained: ${failures.join("; ")}`,
    });
  }
});
