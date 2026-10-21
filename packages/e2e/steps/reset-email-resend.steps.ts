import { randomUUID } from "node:crypto";
import {
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryMail,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { runGatedLoginAttempt } from "../lib/login-failure-gate.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface ResentReset extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  subject?: string;
  priorCookies: string[];
  before?: AddressedMailCheckpoint;
  code?: string;
  requests: number;
  newPassword: string;
  extra: BrowserContext[];
  closures: APIRequestContext[];
  closedClosures: Set<APIRequestContext>;
  firstDelivery?: AddressedMailCheckpoint;
  profile?: string;
}
const resets = new WeakMap<Page, ResentReset>();
function reset(key: Page): ResentReset {
  const state = resets.get(key);
  if (!state) throw new Error("Owned verified reset account was not prepared");
  return state;
}

async function assertOwnedVerifiedIdentity(state: ResentReset) {
  const result = await state.page.evaluate(
    async ({ email, subject, previous }) => {
      const profileResponse = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await profileResponse.json().catch(() => ({}));
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await sessionResponse.json().catch(() => ({}));
      return {
        profile: JSON.stringify(profile),
        subject: typeof session.sub === "string" ? session.sub : undefined,
        evidence: {
          profileStatus: profileResponse.status,
          sameEmail: profile.email === email,
          unchangedProfile:
            previous === undefined || previous === JSON.stringify(profile),
          emailVerified: profile.emailVerified === true,
          sessionStatus: sessionResponse.status,
          subjectPresent:
            typeof session.sub === "string" && session.sub.length > 0,
          sameSubject: subject === undefined || session.sub === subject,
          doctorGuest:
            Array.isArray(session.roles) &&
            session.roles.includes("doctor_guest"),
        },
      };
    },
    { email: state.email, subject: state.subject, previous: state.profile },
  );
  expect(
    result.evidence,
    "private profile belongs to the same verified owned identity",
  ).toEqual({
    profileStatus: 200,
    sameEmail: true,
    unchangedProfile: true,
    emailVerified: true,
    sessionStatus: 200,
    subjectPresent: true,
    sameSubject: true,
    doctorGuest: true,
  });
  state.subject ??= result.subject;
  state.profile ??= result.profile;
}

Given(
  "a uniquely registered verified Academy doctor is logged out for an email reset resend",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: ResentReset = {
      context,
      page: page,
      email: `reset-resend-3181-${randomUUID()}@example.test`,
      password: `Verified-${randomUUID()}-aA1!`,
      priorCookies: [],
      newPassword: `Replacement-${randomUUID()}-aA1!`,
      extra: [],
      closures: [],
      closedClosures: new Set(),
      requests: 0,
    };
    resets.set(page, state);
    const owned = await context.newPage();
    state.page = owned;
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { response, code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
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
    const verified = captureResponse(owned, "/v1/auth/verify").then(
      ({ response, body }) => ({
        response,
        evidence: verificationEvidence(
          response.request().postData() ?? "",
          body,
          state,
          code,
        ),
      }),
    );
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const accepted = await verified;
    expect(accepted.response.status(), "owned registration code accepted").toBe(
      200,
    );
    expect(accepted.evidence).toEqual({
      credentialsMatch: true,
      acknowledgementMatches: true,
    });
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, accepted.response, world.hostBaseUrl);
    await assertOwnedVerifiedIdentity(state);
    state.priorCookies = (await context.cookies())
      .filter((cookie) => cookie.name === SESSION)
      .map((cookie) => cookie.value);

    const loggedOut = captureResponse(owned, "/v1/auth/logout");
    await owned.getByTestId("logout").click();
    const logout = await loggedOut;
    expect(
      logout.response.status(),
      "ordinary account sign-out succeeded",
    ).toBe(200);
    const cleared = (await logout.response.headerValue("set-cookie")) ?? "";
    expect(
      cleared.includes(`${SESSION}=`),
      "sign-out clears private session cookie",
    ).toBe(true);
    expect(
      /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cleared),
      "sign-out expires private session cookie",
    ).toBe(true);
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/",
    );
    await assertNoPrivateRegistrationAccess(owned, "", state);
  },
);

function mailbox(state: ResentReset, base: string) {
  return captureAddressedMailCheckpoint(
    nativeRecoveryMail(),
    process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base),
    state.email,
  );
}

async function requestResult(page: Page, state: ResentReset) {
  const { response, body } = await captureResponse(
    page,
    "/v1/auth/password/reset",
  );
  let matches = false;
  try {
    const request = response.request().postDataJSON();
    matches =
      request.identifier === state.email &&
      Object.keys(request).length === 1 &&
      body === '{"status":"reset_requested"}';
  } catch {
    // Discard credential-bearing parser diagnostics.
  }
  expect({ status: response.status(), matches }).toEqual({
    status: 200,
    matches: true,
  });
  await assertNoPrivateRegistrationAccess(
    page,
    (await response.headerValue("set-cookie")) ?? "",
    state,
  );
}

async function deliveredCode(
  state: ResentReset,
  base: string,
  before: AddressedMailCheckpoint,
) {
  const mail = await fetchRecoveryMail(
    nativeRecoveryMail(),
    process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base),
    state.email,
    before,
    "reset",
  );
  expect(
    {
      sixDigits: /^\d{6}$/.test(mail.code),
      completeBodies:
        typeof mail.text === "string" &&
        mail.text.includes(mail.code) &&
        typeof mail.html === "string" &&
        mail.html.includes(`<strong>${mail.code}</strong>`),
      resetPurpose:
        typeof mail.text === "string" &&
        mail.text.includes("Если вы не запрашивали сброс пароля") &&
        typeof mail.html === "string" &&
        mail.html.includes("Если вы не запрашивали сброс пароля"),
    },
    "full fresh addressed reset delivery",
  ).toEqual({ sixDigits: true, completeBodies: true, resetPurpose: true });
  const after = await mailbox(state, base);
  expect(
    after.messageIds.filter((id) => !before.messageIds.includes(id)).length,
    "exactly one new recipient-bound delivery after the checkpoint",
  ).toBe(1);
  return { code: mail.code, after };
}

When(
  "the reset resend owner requests a real email password reset and observes disabled resend",
  async ({ page, world }) => {
    const state = reset(page);
    await state.page.goto(`${world.hostBaseUrl}/reset?returnTo=%2Faccount`, {
      waitUntil: "load",
    });
    await state.page.waitForLoadState("networkidle");
    await inputSecret(
      state.page.locator('input[autocomplete="username"]'),
      state.email,
    );
    await state.page.clock.install();
    // Sample the page clock with protocol headroom before the countdown starts (#3035).
    const pausePoint = await state.page.evaluate(() => Date.now() + 60_000);
    await state.page.clock.pauseAt(new Date(pausePoint));
    state.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/auth/password/reset"
      )
        state.requests += 1;
    });
    state.before = await mailbox(state, world.hostBaseUrl);
    const pending = requestResult(state.page, state);
    await state.page.getByTestId("reset-request-submit").click();
    await pending;
    const delivery = await deliveredCode(
      state,
      world.hostBaseUrl,
      state.before,
    );
    state.firstDelivery = delivery.after;
    await expect(state.page.getByTestId("reset-resend")).toBeDisabled();
    expect(state.requests, "only the actual initial reset request").toBe(1);
  },
);

When(
  "only the reset browser cooldown advances before one real email reset resend restarts it",
  async ({ page, world }) => {
    const state = reset(page);
    const resend = state.page.getByTestId("reset-resend");
    await expect(resend).toBeDisabled();
    // 003 EARS-17: advance only page intervals, never server/IdP time or quotas.
    for (let second = 0; second < 30; second++) {
      await state.page.clock.runFor(1000);
      await state.page.evaluate(
        () => new Promise<void>((resolve) => queueMicrotask(resolve)),
      );
    }
    await expect(resend).toBeEnabled();
    expect(state.requests, "advancing the UI timer sends nothing").toBe(1);
    const before = await mailbox(state, world.hostBaseUrl);
    if (!state.firstDelivery)
      throw new Error("Initial reset delivery checkpoint missing");
    expect(
      before.messageIds.length === state.firstDelivery.messageIds.length &&
        before.messageIds.every((id) =>
          state.firstDelivery!.messageIds.includes(id),
        ),
      "no extra addressed delivery precedes actual resend",
    ).toBe(true);
    const pending = requestResult(state.page, state);
    await resend.click();
    await pending;
    state.code = (await deliveredCode(state, world.hostBaseUrl, before)).code;
    expect(state.requests, "initial reset plus exactly one actual resend").toBe(
      2,
    );
    await expect(resend).toBeDisabled();
    await expect(resend).toContainText("30");
    await expect(
      state.page.locator('input[autocomplete="one-time-code"]'),
    ).toHaveValue("");
    await assertNoPrivateRegistrationAccess(state.page, "", state);
    await state.page.clock.resume();
  },
);

Then(
  "the newest delivered reset code changes only that owner's password and both owned sessions log out",
  async ({ page, browser, httpCredentials, world }) => {
    const state = reset(page);
    if (!state.code) throw new Error("Resent addressed reset code missing");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      state.code,
    );
    await inputSecret(
      state.page.locator('input[autocomplete="new-password"]'),
      state.newPassword,
    );
    const pending = captureResponse(
      state.page,
      "/v1/auth/password/reset/complete",
    ).then(({ response, body }) => {
      let matches = false;
      try {
        const request = response.request().postDataJSON();
        matches =
          request.identifier === state.email &&
          request.code === state.code &&
          request.newPassword === state.newPassword &&
          Object.keys(request).length === 3 &&
          body === '{"status":"reset_completed"}';
      } catch {
        // Discard code-bearing parser diagnostics.
      }
      return { response, matches };
    });
    await state.page.locator('form button[type="submit"]').click();
    const accepted = await pending;
    expect({
      status: accepted.response.status(),
      matches: accepted.matches,
    }).toEqual({ status: 200, matches: true });
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(
      state.page,
      accepted.response,
      world.hostBaseUrl,
      state.priorCookies,
    );
    await assertOwnedVerifiedIdentity(state);
    const cookie = (await state.context.cookies()).find(
      (entry) => entry.name === SESSION,
    )?.value;
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await assertOwnedVerifiedIdentity(state);
    expect(
      cookie !== undefined &&
        (await state.context.cookies()).find((entry) => entry.name === SESSION)
          ?.value === cookie,
      "the exact owned reset session survives reload",
    ).toBe(true);
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "account renders the original reset owner",
    ).toBe(true);
    await expect(
      state.page.getByTestId("profile-email-verified"),
    ).toBeVisible();

    const signIn = async (password: string) => {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      state.extra.push(context);
      await prepareCaptchaForJourney(
        context,
        world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      const guest = await context.newPage();
      await guest.goto(`${world.hostBaseUrl}/login?returnTo=%2Faccount`, {
        waitUntil: "load",
      });
      await guest.waitForLoadState("networkidle");
      await inputSecret(
        guest.locator('input[autocomplete="username"]'),
        state.email,
      );
      await inputSecret(
        guest.locator('input[autocomplete="current-password"]'),
        password,
      );
      let attemptFailed = false;
      const response = await runGatedLoginAttempt(
        {
          close: async () => {
            let closingFailed = false;
            let closing: Awaited<ReturnType<typeof request.newContext>>;
            try {
              closing = await request.newContext({
                baseURL: world.hostBaseUrl,
                ...(httpCredentials
                  ? { httpCredentials: httpCredentials }
                  : {}),
              });
            } catch {
              if (!attemptFailed)
                throw new Error(
                  "Owned login closure context could not be created",
                );
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
                data: { identifier: state.email, password: state.newPassword },
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
                state.closedClosures.add(closing);
                const session = await closing.get("/v1/auth/session");
                const profile = await closing.get("/v1/me/profile");
                expect(
                  { session: session.status(), profile: profile.status() },
                  "closed gate session has no private access",
                ).toEqual({ session: 401, profile: 401 });
              } catch {
                closingFailed = true;
              } finally {
                if (!closingFailed) {
                  await closing.dispose().catch(() => {
                    closingFailed = true;
                  });
                  if (!closingFailed)
                    state.closures.splice(state.closures.indexOf(closing), 1);
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
            const pending = captureResponse(guest, "/v1/auth/login");
            await guest.getByTestId("password-login-submit").click();
            const result = await pending;
            let exactCommand = false;
            try {
              const command = result.response.request().postDataJSON();
              exactCommand =
                command.identifier === state.email &&
                command.password === password;
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
      return { guest, context, ...response };
    };
    const refused = await signIn(state.password);
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
      // Discard response parser diagnostics.
    }
    expect(genericRefusal, "old-password refusal stays generic").toBe(true);
    await assertNoPrivateRegistrationAccess(
      refused.guest,
      (await refused.response.headerValue("set-cookie")) ?? "",
      state,
    );
    const fresh = await signIn(state.newPassword);
    expect(
      fresh.response.status(),
      "replacement password independently accepted",
    ).toBe(200);
    await fresh.guest.waitForURL((url) => url.pathname === "/account");
    await assertSecureSession(
      fresh.guest,
      fresh.response,
      world.hostBaseUrl,
      state.priorCookies,
    );
    await assertOwnedVerifiedIdentity({ ...state, page: fresh.guest });
    expect(state.requests, "exactly initial reset plus one resend").toBe(2);
    await revokeOwnedSession({
      ...state,
      page: fresh.guest,
      context: fresh.context,
    });
    await revokeOwnedSession(state);
  },
);

async function revokeOwnedSession(state: ResentReset) {
  const revoked = await state.page.evaluate(async () => {
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
  expect(revoked, "only this owned resend session is revoked").toEqual({
    logout: 200,
    session: 401,
    profile: 401,
  });
  expect(
    (await state.context.cookies()).some((entry) => entry.name === SESSION),
    "owned cookie cleared after exact logout",
  ).toBe(false);
}

After("@reset-email-resend", async ({ page }) => {
  const state = resets.get(page);
  if (!state) return;
  let cleanupFailed = false;
  try {
    for (const context of [state.context, ...state.extra]) {
      try {
        if ((await context.cookies()).some((entry) => entry.name === SESSION)) {
          const owned = context.pages()[0];
          if (!owned) throw new Error("Owned cleanup page missing");
          await revokeOwnedSession({ ...state, page: owned, context });
        }
      } catch {
        cleanupFailed = true;
      }
    }
  } catch {
    cleanupFailed = true;
  } finally {
    state.code = "";
    for (const context of [state.context, ...state.extra]) {
      try {
        await context.close();
      } catch {
        cleanupFailed = true;
      }
    }
    for (const closing of state.closures) {
      try {
        const logout = await closing.post("/v1/auth/logout");
        const session = await closing.get("/v1/auth/session");
        const profile = await closing.get("/v1/me/profile");
        expect(
          {
            logout: logout.status(),
            session: session.status(),
            profile: profile.status(),
          },
          "retained owned gate session is revoked",
        ).toEqual({
          logout: state.closedClosures.has(closing) ? 401 : 200,
          session: 401,
          profile: 401,
        });
      } catch {
        cleanupFailed = true;
      } finally {
        try {
          await closing.dispose();
        } catch {
          cleanupFailed = true;
        }
      }
    }
    resets.delete(page);
  }
  if (cleanupFailed) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned reset-email-resend session cleanup failed");
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned reset-email-resend session cleanup failed; original failure preserved; lead must inspect scoped cleanup.",
    });
  }
});
