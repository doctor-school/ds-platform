import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { runGatedLoginAttempt } from "../lib/login-failure-gate.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface CounterJourney {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  subject?: string;
  priorCookie?: string | undefined;
  firstFailureAt?: number;
}
const journeys = new WeakMap<Page, CounterJourney>();
function journey(key: Page): CounterJourney {
  const state = journeys.get(key);
  if (!state) throw new Error("Owned counter-reset account is absent");
  return state;
}

async function identity(state: CounterJourney) {
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

async function revoke(state: CounterJourney) {
  expect(
    await state.page.evaluate(async () => {
      const logout = await fetch("/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      const profile = await fetch("/v1/me/profile", { credentials: "include" });
      return { logout: logout.status, profile: profile.status };
    }),
    "owned session revoked",
  ).toEqual({ logout: 200, profile: 401 });
}

async function passwordAttempt(
  state: CounterJourney,
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

Given(
  "a unique verified Academy account starts the real login-counter journey as a guest",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: CounterJourney = {
      context,
      page: await context.newPage(),
      email: `counter-reset-3036-${randomUUID()}@example.test`,
      password: `Owned-${randomUUID()}-aA1!`,
    };
    journeys.set(page, state);
    await test.info().attach("owned-fixture", {
      body: JSON.stringify({ issue: 3036, email: state.email }),
      contentType: "application/json",
    });
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      state.page,
      world.hostBaseUrl,
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
    await assertSecureSession(state.page, verified.response, world.hostBaseUrl);
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
    state.priorCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-ds_session",
    )?.value;
    await revoke(state);
  },
);

When(
  "two real Academy password refusals are followed by the owner's successful password login",
  async ({ page, world }) => {
    const state = journey(page);
    let succeeded = false;
    // 003 EARS-13/17: the target success is also the password-gate closure.
    await runGatedLoginAttempt(
      {
        close: async () => {
          if (!succeeded) {
            const cleanup = await passwordAttempt(
              state,
              world.hostBaseUrl,
              state.password,
            );
            expect(
              cleanup.response.status(),
              "owned login closes failed journey's challenge window",
            ).toBe(200);
            await revoke(state);
          }
        },
      },
      async () => {
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
              hasText: "Не удалось войти. Проверьте данные и попробуйте снова.",
            }),
          ).toBeVisible();
          const guest = await identity(state);
          expect({ profile: guest.profile, session: guest.session }).toEqual({
            profile: 401,
            session: 401,
          });
        }
        const accepted = await passwordAttempt(
          state,
          world.hostBaseUrl,
          state.password,
        );
        expect(
          accepted.response.status(),
          "real owned password login succeeds below IdP soft-lock",
        ).toBe(200);
        succeeded = true;
        let tokenFree = false;
        try {
          const body = JSON.parse(accepted.body);
          tokenFree =
            body.status === "authenticated" && Object.keys(body).length === 1;
        } catch {
          /* Never expose authentication response bytes. */
        }
        expect(tokenFree, "login acknowledgement carries no tokens").toBe(true);
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
      },
    );
  },
);

Then(
  "after logout ten same-identifier reset requests are admitted and the eleventh is throttled within the original window",
  async ({ page, world }) => {
    const state = journey(page);
    await revoke(state);
    // 003 EARS-13: use reset SEND admission to avoid Zitadel password soft-lock.
    // Do not complete a reset or authenticate after the target successful login.
    // Without forgiveness, two failures + success leave only seven admissions.
    for (let n = 1; n <= 11; n += 1) {
      await state.page.goto(`${world.hostBaseUrl}/reset`, {
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
          request.identifier === state.email &&
          Object.keys(request).length === 1;
        const body = JSON.parse(result.body);
        neutral =
          n <= 10
            ? body.status === "reset_requested" &&
              Object.keys(body).length === 1
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
        result.response
          .headers()
          ["set-cookie"]?.includes("__Host-ds_session=") ?? false,
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
  },
);

After("@login-counter-reset", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  const failures: string[] = [];
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    )
      await revoke(state);
  } catch {
    failures.push("owned-session-revocation");
  } finally {
    state.password = "";
    await state.context
      .close()
      .catch(() => failures.push("owned-context-close"));
    journeys.delete(page);
  }
  if (failures.length > 0) {
    const description = `Counter-reset cleanup failed: ${failures.join(", ")}`;
    if (test.info().status === test.info().expectedStatus)
      throw new Error(description);
    test.info().annotations.push({ type: "cleanup-failed", description });
  }
});
