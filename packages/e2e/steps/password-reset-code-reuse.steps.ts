import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
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
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";
import { browserOf, closeOwnedLoginWindow } from "../lib/host-sign-in.js";

const SESSION = "__Host-ds_session";
interface ResetReuse {
  email: string;
  password: string;
  acceptedPassword: string;
  rejectedPassword: string;
  contexts: BrowserContext[];
  httpCredentials: BrowserContextOptions["httpCredentials"];
  recovered?: Page;
  code?: string;
  subject?: string;
  cookie?: string;
}
const journeys = new WeakMap<Page, ResetReuse>();
function journey(page: Page): ResetReuse {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned reset-code reuse journey missing");
  return state;
}
async function privatePage(browser: Browser, state: ResetReuse, base: string) {
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
async function sameOwner(page: Page, state: ResetReuse) {
  const result = await page.evaluate(
    async ({ email, subject }) => {
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
          sameSubject:
            typeof session.sub === "string" &&
            !!session.sub &&
            (subject === undefined || subject === session.sub),
        },
      };
    },
    { email: state.email, subject: state.subject },
  );
  expect(result.evidence, "same verified owned account").toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
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
  state: ResetReuse,
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
        return await pending;
      } catch (error) {
        attemptFailed = true;
        throw error;
      }
    },
  );
}

Given(
  "a uniquely owned verified Academy account completes a delivered password reset once",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const state: ResetReuse = {
      email: `reset-code-reuse-3070-${randomUUID()}@example.test`,
      password: `Original-${randomUUID()}-aA1!`,
      acceptedPassword: `Accepted-${randomUUID()}-aA1!`,
      rejectedPassword: `Replayed-${randomUUID()}-aA1!`,
      contexts: [],
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
      state.email,
    );
    const mailbox =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mailbox,
      state.email,
    );
    const requested = captureResponse(
      reset,
      signInHostApiPath("/v1/auth/password/reset"),
    );
    await reset.getByTestId("reset-request-submit").click();
    expect((await requested).response.status(), "reset requested").toBe(200);
    state.code = await fetchRecoveryCode(
      nativeRecoveryMail(),
      mailbox,
      state.email,
      before,
      "reset",
    );
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
    expect(completed.response.status(), "first delivered reset accepted").toBe(
      200,
    );
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
  "a guest Academy browser replays that consumed reset code with a different private password",
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
    // #3172 — the storefront `/reset` is now an entry to the sign-in host,
    // whose origin has no storefront session or profile to observe. The replay
    // targets the storefront's own reset BFF (still served) from a storefront
    // page, where the same tab reads its session and profile.
    await guest.goto(`${world.hostBaseUrl}/`, { waitUntil: "load" });
    await guest.waitForLoadState("networkidle");
    await noPrivateAccess(guest);
    // Replay the retained code without requesting a replacement challenge.
    const pending = captureResponse(guest, "/v1/auth/password/reset/complete");
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
        identifier: state.email,
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
  "the accepted password still opens the same Academy account while the replay password cannot sign in",
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

After("@password-reset-code-reuse", async ({ page, world }) => {
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
  } finally {
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
