import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import {
  expect,
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
import { browserOf, closeOwnedLoginWindow } from "../lib/host-sign-in.js";

const SESSION = "__Host-ds_session";
interface ResetAccount {
  email: string;
  phone: string;
  sink: string;
  resetRequests: number;
  password: string;
  acceptedPassword: string;
  replacement: string;
  contexts: BrowserContext[];
  closures: APIRequestContext[];
  httpCredentials: BrowserContextOptions["httpCredentials"];
  ownedContexts: BrowserContext[];
  expectedRevoked: Set<BrowserContext>;
  owner?: Page;
  reset?: Page;
  code?: string;
  subject?: string;
  cookie?: string | undefined;
}
interface ResetIsolation {
  accounts: ResetAccount[];
  expectedRevoked: Set<BrowserContext>;
  contexts: BrowserContext[];
  closures: APIRequestContext[];
}
const journeys = new WeakMap<Page, ResetIsolation>();
function journey(page: Page): ResetIsolation {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned SMS reset isolation journey missing");
  return state;
}
async function privatePage(
  browser: Browser,
  state: ResetAccount,
  base: string,
) {
  const context = await browser.newContext({
    locale: "ru-RU",
    ...(state.httpCredentials
      ? { httpCredentials: state.httpCredentials }
      : {}),
  });
  state.contexts.push(context);
  state.ownedContexts.push(context);
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
async function sameOwner(page: Page, state: ResetAccount) {
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
  if (!result.subject)
    throw new Error("Owned SMS reset isolation subject missing");
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
  state: ResetAccount,
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
      close: () =>
        closeOwnedLoginWindow(
          browserOf(page),
          base,
          { email: state.email, password: state.acceptedPassword },
          attemptFailed,
        ),
    },
    async () => {
      try {
        const pending = captureResponse(
          page,
          signInHostApiPath("/v1/auth/login"),
        );
        await page.getByTestId("password-login-submit").click();
        const result = await pending;
        let exactCommand = false;
        try {
          const command = result.response.request().postDataJSON();
          exactCommand =
            command.identifier === state.email && command.password === password;
        } catch {
          /* Secret-bearing diagnostics project only to false. */
        }
        expect(
          exactCommand,
          "exact owned identifier and password submitted",
        ).toBe(true);
        return result;
      } catch (error) {
        attemptFailed = true;
        throw error;
      }
    },
  );
}

async function signInAndIdentify(
  page: Page,
  base: string,
  account: ResetAccount,
  password: string,
) {
  const result = await passwordLogin(page, base, account, password);
  expect(
    {
      status: result.response.status(),
      tokenFree: storefrontCallbackAcknowledgement(result.body, base),
    },
    "owned password accepted",
  ).toEqual({ status: 200, tokenFree: true });
  await page.waitForURL((url) => url.pathname === "/account");
  await assertSecureSession(page, result.response, base);
  await sameOwner(page, account);
}

Given(
  "two owned Academy doctors retain distinct live SMS password reset codes for their confirmed phones",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("SMS sink required for account isolation proof");
    const state: ResetIsolation = {
      accounts: [],
      contexts: [],
      closures: [],
      expectedRevoked: new Set(),
    };
    journeys.set(page, state);
    for (let index = 0; index < 2; index++) {
      const password = `Original-${randomUUID()}-aA1!`;
      const account: ResetAccount = {
        email: `sms-reset-isolation-3139-${index}-${randomUUID()}@example.test`,
        phone: freshConfirmablePhone(),
        sink,
        resetRequests: 0,
        password,
        acceptedPassword: password,
        replacement: `Replacement-${randomUUID()}-aA1!`,
        ownedContexts: [],
        expectedRevoked: state.expectedRevoked,
        contexts: state.contexts,
        closures: state.closures,
        httpCredentials,
      };
      state.accounts.push(account);
      const owner = await privatePage(browser, account, world.hostBaseUrl);
      account.owner = owner;
      const { code } = await registerOwnedCredentials(
        owner,
        world.hostBaseUrl,
        account,
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
      await confirmOwnedPhone(owner, { phone: account.phone, sink });
      await sameOwner(owner, account);
      account.cookie = (await owner.context().cookies()).find(
        (cookie) => cookie.name === SESSION,
      )?.value;
      expect(Boolean(account.cookie), "owned session cookie present").toBe(
        true,
      );
    }
    expect(
      state.accounts[0]!.phone !== state.accounts[1]!.phone,
      "two different owned phones",
    ).toBe(true);
    // 003 EARS-12/53: each identifier owns its own provider reset challenge.
    for (const account of state.accounts) {
      const reset = await privatePage(browser, account, world.hostBaseUrl);
      account.reset = reset;
      await reset.goto(`${world.hostBaseUrl}/reset?returnTo=%2Faccount`, {
        waitUntil: "load",
      });
      await reset.waitForLoadState("networkidle");
      await inputSecret(
        reset.locator('input[autocomplete="username"]'),
        account.phone,
      );
      const before = await captureSmsCheckpoint(sink, account.phone);
      const pending = captureResponse(
        reset,
        signInHostApiPath("/v1/auth/password/reset"),
      );
      await reset.getByTestId("reset-request-submit").click();
      const requested = await pending;
      expect({
        status: requested.response.status(),
        neutral: requested.body === '{"status":"reset_requested"}',
      }).toEqual({ status: 200, neutral: true });
      account.code = await waitForSmsCode(
        sink,
        account.phone,
        before,
        resetSmsCode,
        RESET_CODE_EVENT,
      );
      const delivered = await smsSinkMessages(
        sink,
        account.phone,
        before,
        RESET_CODE_EVENT,
      );
      expect(
        {
          one: delivered.length === 1,
          sameCode:
            delivered.length === 1 &&
            resetSmsCode(delivered[0]!) === account.code,
          sixDigits: /^\d{6}$/.test(account.code),
        },
        "real addressed retained SMS",
      ).toEqual({ one: true, sameCode: true, sixDigits: true });
      await noPrivateAccess(reset);
    }
    expect(
      state.accounts[0]!.code !== state.accounts[1]!.code,
      "delivered codes differ without reroll or resend",
    ).toBe(true);
  },
);

When(
  "the second doctor's reset form submits the first doctor's retained SMS code with a different password",
  async ({ page }) => {
    const [first, second] = journey(page).accounts;
    if (!first?.code || !second?.reset)
      throw new Error("Two retained reset challenges missing");
    const reset = second.reset;
    await inputSecret(
      reset.locator('input[autocomplete="one-time-code"]'),
      first.code,
    );
    await inputSecret(
      reset.locator('input[autocomplete="new-password"]'),
      second.replacement,
    );
    const pending = captureResponse(
      reset,
      signInHostApiPath("/v1/auth/password/reset/complete"),
    );
    await reset.locator('form button[type="submit"]').click();
    const refused = await pending;
    let exactCommand = false;
    let generic = false;
    try {
      const command = refused.response.request().postDataJSON();
      const body = JSON.parse(refused.body);
      exactCommand =
        command.identifier === second.phone &&
        command.code === first.code &&
        command.newPassword === second.replacement;
      generic =
        Object.keys(body).length === 3 &&
        body.statusCode === 400 &&
        body.message === "the request could not be completed" &&
        body.error === "Bad Request";
    } catch {
      /* Secret-bearing diagnostics project only to false. */
    }
    expect(
      {
        status: refused.response.status(),
        exactCommand,
        generic,
        noCookie: (await refused.response.headerValue("set-cookie")) === null,
      },
      "another account's live code is refused generically",
    ).toEqual({
      status: 400,
      exactCommand: true,
      generic: true,
      noCookie: true,
    });
    await expect
      .poll(() => reset.getByTestId("reset-error").ariaSnapshot())
      .toBe("- alert: Код не подошёл или пароль отклонён.");
    await noPrivateAccess(reset);
  },
);

Then(
  "both original SMS reset owners keep their identities and the second doctor's password is unchanged",
  async ({ page, browser, world }) => {
    const state = journey(page);
    for (const account of state.accounts) {
      await account.owner!.reload({ waitUntil: "load" });
      await account.owner!.waitForLoadState("networkidle");
      await sameOwner(account.owner!, account);
      expect(
        (await account.owner!.context().cookies()).find(
          (cookie) => cookie.name === SESSION,
        )?.value === account.cookie,
        "foreign code preserves the original owner's cookie",
      ).toBe(true);
    }
    const second = state.accounts[1]!;
    const rejected = await privatePage(browser, second, world.hostBaseUrl);
    const failure = await passwordLogin(
      rejected,
      world.hostBaseUrl,
      second,
      second.replacement,
    );
    expect(
      {
        status: failure.response.status(),
        noCookie: (await failure.response.headerValue("set-cookie")) === null,
      },
      "foreign-code proposal was never installed",
    ).toEqual({ status: 401, noCookie: true });
    await noPrivateAccess(rejected);
    const accepted = await privatePage(browser, second, world.hostBaseUrl);
    await signInAndIdentify(
      accepted,
      world.hostBaseUrl,
      second,
      second.password,
    );
  },
);

When(
  "each SMS reset owner submits their own same retained code and a new password without requesting another challenge",
  async ({ page, world }) => {
    const state = journey(page);
    for (const account of state.accounts) {
      if (!account.reset || !account.code)
        throw new Error("Retained owner reset missing");
      const reset = account.reset;
      await inputSecret(
        reset.locator('input[autocomplete="one-time-code"]'),
        account.code,
      );
      await inputSecret(
        reset.locator('input[autocomplete="new-password"]'),
        account.replacement,
      );
      const pending = captureResponse(
        reset,
        signInHostApiPath("/v1/auth/password/reset/complete"),
      );
      await reset.locator('form button[type="submit"]').click();
      const completed = await pending;
      let exactCommand = false;
      try {
        const command = completed.response.request().postDataJSON();
        exactCommand =
          command.identifier === account.phone &&
          command.code === account.code &&
          command.newPassword === account.replacement;
      } catch {
        /* Secret-bearing diagnostics project only to false. */
      }
      expect(
        {
          status: completed.response.status(),
          exactCommand,
          tokenFree: storefrontCallbackAcknowledgement(
            completed.body,
            world.hostBaseUrl,
          ),
        },
        "same retained code completes only its owner's reset",
      ).toEqual({ status: 200, exactCommand: true, tokenFree: true });
      // 003 EARS-12: only contexts predating this successful reset are revoked.
      for (const context of account.ownedContexts) {
        if (context !== reset.context()) state.expectedRevoked.add(context);
      }
      account.acceptedPassword = account.replacement;
      await reset.waitForURL((url) => url.pathname === "/account");
      await assertSecureSession(reset, completed.response, world.hostBaseUrl, [
        account.cookie!,
      ]);
      await sameOwner(reset, account);
      expect(
        await account.owner!.evaluate(async () => ({
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
        "successful reset revokes the prior owner session",
      ).toEqual({ session: 401, profile: 401 });
    }
  },
);

Then(
  "both new passwords sign in only their original phone-confirmed doctors before all owned SMS isolation sessions are logged out",
  async ({ page, browser, world }) => {
    const state = journey(page);
    for (const account of state.accounts) {
      const accepted = await privatePage(browser, account, world.hostBaseUrl);
      await signInAndIdentify(
        accepted,
        world.hostBaseUrl,
        account,
        account.replacement,
      );
      await accepted.reload({ waitUntil: "load" });
      await accepted.waitForLoadState("networkidle");
      await sameOwner(accepted, account);
    }
    expect(
      state.accounts.map((account) => account.resetRequests),
      "exactly two challenges and no resend",
    ).toEqual([1, 1]);
  },
);

After("@sms-reset-account-isolation", async ({ page, world }) => {
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
            throw new Error(
              "Owned SMS reset isolation session has no cleanup page",
            );
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
          const alreadyRevoked = state.expectedRevoked.has(context);
          expect(
            statuses,
            "active sessions log out; explicitly reset-revoked sessions remain private",
          ).toEqual({
            logout: alreadyRevoked ? 401 : 200,
            session: 401,
            profile: 401,
          });
          if (!alreadyRevoked) {
            expect(
              (await context.cookies()).some(
                (cookie) => cookie.name === SESSION,
              ),
              "active logout clears its browser cookie",
            ).toBe(false);
          }
          // A reset-revoked cookie is discarded by closing this owned context.
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
    for (const account of state.accounts) {
      delete account.code;
      delete account.cookie;
    }
    journeys.delete(page);
  }
  if (failures.length > 0) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error(
        `Owned SMS reset isolation session cleanup failed: ${failures.join("; ")}`,
      );
    test.info().annotations.push({
      type: "cleanup-failed",
      description: `Owned SMS reset isolation cleanup failed; original scenario failure retained: ${failures.join("; ")}`,
    });
  }
});
