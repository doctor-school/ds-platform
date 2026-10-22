import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryMail,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import { runGatedLoginAttempt } from "../lib/login-failure-gate.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface ResetForgivenessJourney {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  subject?: string;
  priorCookie?: string | undefined;
  firstFailureAt?: number;
  newPassword: string;
  failed: boolean;
  admissionsProven?: boolean;
  control?: ResetForgivenessJourney;
}
const journeys = new WeakMap<Page, ResetForgivenessJourney>();
function journey(key: Page): ResetForgivenessJourney {
  const state = journeys.get(key);
  if (!state) throw new Error("Owned counter-reset account is absent");
  return state;
}

async function identity(state: ResetForgivenessJourney) {
  return state.page.evaluate(
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
        profile: profileResponse.status,
        session: sessionResponse.status,
        sameEmail: profile.email === email,
        verified: profile.emailVerified === true,
        subject: typeof session.sub === "string" ? session.sub : undefined,
        sameSubject: subject === undefined || subject === session.sub,
      };
    },
    { email: state.email, subject: state.subject },
  );
}

async function revoke(state: ResetForgivenessJourney) {
  expect(
    await state.page.evaluate(async () => {
      const logout = await fetch("/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      return {
        logout: logout.status,
        profile: profile.status,
        session: session.status,
      };
    }),
    "owned session revoked",
  ).toEqual({ logout: 200, profile: 401, session: 401 });
  expect(
    (await state.context.cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    ),
    "owned session cookie cleared",
  ).toBe(false);
}

async function passwordAttempt(
  state: ResetForgivenessJourney,
  base: string,
  password: string,
) {
  await state.page.goto(`${base}/login?returnTo=%2Faccount`, {
    waitUntil: "load",
  });
  await state.page.waitForLoadState("networkidle");
  await inputSecret(
    state.page.locator('input[autocomplete="username"]'),
    state.email,
  );
  await inputSecret(
    state.page.locator('input[autocomplete="current-password"]'),
    password,
  );
  const pending = captureResponse(state.page, "/v1/auth/login");
  await state.page.getByTestId("password-login-submit").click();
  const result = await pending;
  let submitted = false;
  try {
    const body = result.response.request().postDataJSON();
    submitted = body.identifier === state.email && body.password === password;
  } catch {
    /* Never expose credential-bearing parser diagnostics. */
  }
  expect(submitted, "real owned password form submission").toBe(true);
  return result;
}

async function prepareVerifiedOwner(
  state: ResetForgivenessJourney,
  base: string,
) {
  const { code } = await registerOwnedCredentials(
    state.page,
    base,
    state,
    "/account",
  );
  const pending = captureResponse(state.page, "/v1/auth/verify");
  await inputSecret(
    state.page.locator('input[autocomplete="one-time-code"]'),
    code,
  );
  const verified = await pending;
  expect(verified.response.status()).toBe(200);
  await state.page.waitForURL((url) => url.pathname === "/account");
  await state.page.waitForLoadState("networkidle");
  await assertSecureSession(state.page, verified.response, base);
  const { subject, ...evidence } = await identity(state);
  expect(evidence).toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
    sameSubject: true,
  });
  expect(Boolean(subject), "real owned subject exists").toBe(true);
  state.subject = subject;
  state.priorCookie = (await state.context.cookies()).find(
    (cookie) => cookie.name === "__Host-ds_session",
  )?.value;
  await revoke(state);
}

Given(
  "a unique verified Academy reset-forgiveness owner starts as a guest",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    expect(
      process.env.E2E_AUTH_LIMIT_TIER,
      "native loopback default contour selected",
    ).toBe("default");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: ResetForgivenessJourney = {
      context,
      page: await context.newPage(),
      email: `reset-forgiveness-3204-${randomUUID()}@example.test`,
      password: `Owned-${randomUUID()}-aA1!`,
      newPassword: `Replacement-${randomUUID()}-aA1!`,
      failed: false,
    };
    journeys.set(page, state);
    await test.info().attach("owned-fixture", {
      body: JSON.stringify({ issue: 3204, email: state.email }),
      contentType: "application/json",
    });
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await prepareVerifiedOwner(state, world.hostBaseUrl);
    const controlContext = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const control: ResetForgivenessJourney = {
      context: controlContext,
      page: await controlContext.newPage(),
      email: `reset-control-3204-${randomUUID()}@example.test`,
      password: `Control-${randomUUID()}-aA1!`,
      newPassword: "",
      failed: false,
    };
    state.control = control;
    await test.info().attach("owned-control-fixture", {
      body: JSON.stringify({ issue: 3204, email: control.email }),
      contentType: "application/json",
    });
    await prepareCaptchaForJourney(
      controlContext,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await prepareVerifiedOwner(control, world.hostBaseUrl);
  },
);

When(
  "two real Academy password refusals precede that owner's delivered email reset completion",
  async ({ page, world }) => {
    const state = journey(page);

    // 003 EARS-12/13: do not mask reset forgiveness with a password login.
    await runGatedLoginAttempt(
      {
        close: async () => {
          try {
            const control = state.control;
            if (!control)
              throw new Error("Owned challenge-cleanup control absent");
            const closing = await passwordAttempt(
              control,
              world.hostBaseUrl,
              control.password,
            );
            expect(
              closing.response.status(),
              "distinct owned control login closes only the IP challenge after target proof",
            ).toBe(200);
            await control.page.waitForURL((url) => url.pathname === "/account");
            await control.page.waitForLoadState("networkidle");
            const { subject: _subject, ...evidence } = await identity(control);
            expect(evidence).toEqual({
              profile: 200,
              session: 200,
              sameEmail: true,
              verified: true,
              sameSubject: true,
            });
            await revoke(control);
          } catch {
            if (!state.failed)
              throw new Error(
                "Owned control challenge closure or session revocation failed",
              );
            test.info().annotations.push({
              type: "cleanup-failed",
              description:
                "Owned control challenge closure failed; original target failure retained; lead must inspect scoped cleanup.",
            });
          }
        },
      },
      async () => {
        try {
          state.firstFailureAt = Date.now();
          for (let n = 0; n < 2; n += 1) {
            const refused = await passwordAttempt(
              state,
              world.hostBaseUrl,
              `${state.password}-wrong`,
            );
            let generic = false;
            try {
              const body = JSON.parse(refused.body);
              generic =
                body.statusCode === 401 &&
                body.message === "invalid credentials" &&
                body.error === "Unauthorized" &&
                Object.keys(body).length === 3;
            } catch {
              /* Project sensitive responses to booleans. */
            }
            expect({ status: refused.response.status(), generic }).toEqual({
              status: 401,
              generic: true,
            });
            await expect(
              state.page.getByRole("alert").filter({
                hasText:
                  "Не удалось войти. Проверьте данные и попробуйте снова.",
              }),
            ).toBeVisible();
            const guest = await identity(state);
            expect({ profile: guest.profile, session: guest.session }).toEqual({
              profile: 401,
              session: 401,
            });
          }
          const before = await captureAddressedMailCheckpoint(
            nativeRecoveryMail(),
            process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
            state.email,
          );
          await state.page.goto(
            `${world.hostBaseUrl}/reset?returnTo=%2Faccount`,
            { waitUntil: "load" },
          );
          await state.page.waitForLoadState("networkidle");
          await inputSecret(
            state.page.locator('input[autocomplete="username"]'),
            state.email,
          );
          const requested = captureResponse(
            state.page,
            "/v1/auth/password/reset",
          );
          await state.page.getByTestId("reset-request-submit").click();
          const send = await requested;
          let sameRequest = false;
          try {
            const command = send.response.request().postDataJSON();
            sameRequest =
              command.identifier === state.email &&
              Object.keys(command).length === 1 &&
              send.body === '{"status":"reset_requested"}';
          } catch {
            /* Discard identifier-bearing diagnostics. */
          }
          expect({ status: send.response.status(), sameRequest }).toEqual({
            status: 200,
            sameRequest: true,
          });
          const delivery = await fetchRecoveryMail(
            nativeRecoveryMail(),
            process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
            state.email,
            before,
            "reset",
          );
          expect(
            /^\d{6}$/.test(delivery.code),
            "fresh addressed reset code has six digits",
          ).toBe(true);
          await inputSecret(
            state.page.locator('input[autocomplete="one-time-code"]'),
            delivery.code,
          );
          await inputSecret(
            state.page.locator('input[autocomplete="new-password"]'),
            state.newPassword,
          );
          const completing = captureResponse(
            state.page,
            "/v1/auth/password/reset/complete",
          );
          await state.page.locator('form button[type="submit"]').click();
          const accepted = await completing;
          let exactCompletion = false;
          try {
            const command = accepted.response.request().postDataJSON();
            exactCompletion =
              command.identifier === state.email &&
              command.code === delivery.code &&
              command.newPassword === state.newPassword &&
              Object.keys(command).length === 3;
          } catch {
            /* Discard secret-bearing diagnostics. */
          }
          expect({
            status: accepted.response.status(),
            exactCompletion,
          }).toEqual({ status: 200, exactCompletion: true });
          let tokenFree = false;
          try {
            const body = JSON.parse(accepted.body);
            tokenFree =
              body.status === "reset_completed" &&
              Object.keys(body).length === 1;
          } catch {
            /* Never expose authentication response bytes. */
          }
          expect(tokenFree, "reset acknowledgement carries no tokens").toBe(
            true,
          );
          await state.page.waitForURL((url) => url.pathname === "/account");
          await state.page.waitForLoadState("networkidle");
          await assertSecureSession(
            state.page,
            accepted.response,
            world.hostBaseUrl,
            state.priorCookie ? [state.priorCookie] : [],
          );
          const { subject: _subject, ...evidence } = await identity(state);
          expect(evidence).toEqual({
            profile: 200,
            session: 200,
            sameEmail: true,
            verified: true,
            sameSubject: true,
          });
          await proveAdmissions(state, world.hostBaseUrl);
        } catch (error) {
          state.failed = true;
          throw error;
        }
      },
    );
  },
);

Then(
  "after reset logout ten real same-owner requests are admitted and the eleventh is throttled inside the original window",
  async ({ page }) => {
    const state = journey(page);
    expect(
      state.admissionsProven,
      "full admission boundary completed before challenge cleanup",
    ).toBe(true);
    const guest = await identity(state);
    expect({ profile: guest.profile, session: guest.session }).toEqual({
      profile: 401,
      session: 401,
    });
  },
);

async function proveAdmissions(state: ResetForgivenessJourney, base: string) {
  await revoke(state);
  // 003 EARS-13: reset SEND probes the per-user window without another login.
  for (let n = 1; n <= 11; n += 1) {
    await state.page.goto(`${base}/reset`, {
      waitUntil: "load",
    });
    await state.page.waitForLoadState("networkidle");
    await inputSecret(
      state.page.locator('input[autocomplete="username"]'),
      state.email,
    );
    const pending = captureResponse(state.page, "/v1/auth/password/reset");
    await state.page.getByTestId("reset-request-submit").click();
    const result = await pending;
    let sameIdentifier = false;
    let neutral = false;
    try {
      const request = result.response.request().postDataJSON();
      sameIdentifier =
        request.identifier === state.email && Object.keys(request).length === 1;
      const body = JSON.parse(result.body);
      neutral =
        n <= 10
          ? body.status === "reset_requested" && Object.keys(body).length === 1
          : body.statusCode === 429 &&
            body.message === "too many requests, please try again later" &&
            Object.keys(body).length === 2;
    } catch {
      /* Keep the account and response bytes out of diagnostics. */
    }
    expect({
      ordinal: n,
      status: result.response.status(),
      sameIdentifier,
      neutral,
    }).toEqual({
      ordinal: n,
      status: n <= 10 ? 200 : 429,
      sameIdentifier: true,
      neutral: true,
    });
    expect(
      result.response.headers()["set-cookie"]?.includes("__Host-ds_session=") ??
        false,
      "reset admission mints no session cookie",
    ).toBe(false);
    if (n <= 10)
      await expect(
        state.page.locator('input[autocomplete="one-time-code"]'),
      ).toBeVisible();
    expect(
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "admission probes mint no session",
    ).toBe(false);
  }
  if (!state.firstFailureAt)
    throw new Error("Original failure-window checkpoint absent");
  expect(
    Date.now() - state.firstFailureAt,
    "all admissions stay inside the original real 15-minute window",
  ).toBeLessThan(15 * 60 * 1000);
  const guest = await identity(state);
  expect({ profile: guest.profile, session: guest.session }).toEqual({
    profile: 401,
    session: 401,
  });
  state.admissionsProven = true;
}

After("@reset-counter-forgiveness", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  const failures: string[] = [];
  for (const owned of [state, state.control].filter(
    (value): value is ResetForgivenessJourney => value !== undefined,
  )) {
    try {
      if (
        (await owned.context.cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        )
      )
        await revoke(owned);
    } catch {
      failures.push("owned-session-revocation");
    } finally {
      owned.password = "";
      owned.newPassword = "";
      await owned.context
        .close()
        .catch(() => failures.push("owned-context-close"));
    }
  }
  journeys.delete(page);
  if (failures.length > 0) {
    const description = `Counter-reset cleanup failed: ${failures.join(", ")}`;
    if (test.info().status === test.info().expectedStatus)
      throw new Error(description);
    test.info().annotations.push({ type: "cleanup-failed", description });
  }
});
