import { randomUUID } from "node:crypto";
import {
  expect,
  request,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { runGatedLoginAttempt } from "../lib/login-failure-gate.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  PHONE_CODE_EVENT,
  phoneConfirmationCode,
  smsSinkMessages,
  smsSinkUrl,
  waitForSmsCode,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface AbandonedPhone {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  original: string;
  replacement: string;
  sink: string;
  subject?: string | undefined;
}
const journeys = new WeakMap<Page, AbandonedPhone>();
function journey(page: Page): AbandonedPhone {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned abandoned-phone journey is missing");
  return state;
}

async function profile(state: AbandonedPhone, confirmed: boolean) {
  const evidence = await state.page.evaluate(
    async ({ email, subject, phone }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      const claims = await session.json().catch(() => ({}));
      return {
        status: response.status,
        session: session.status,
        sameEmail: data.email === email,
        sameSubject:
          subject === undefined
            ? typeof claims.sub === "string" && claims.sub.length > 0
            : claims.sub === subject,
        emailVerified: data.emailVerified,
        expectedPhone: data.phone === phone,
        phoneVerified: data.phoneVerified,
        subject: claims.sub as string | undefined,
      };
    },
    {
      email: state.email,
      subject: state.subject,
      phone: confirmed ? state.original : null,
    },
  );
  const { subject, ...safe } = evidence;
  expect(safe, "same account and exact confirmed-phone state").toEqual({
    status: 200,
    session: 200,
    sameEmail: true,
    sameSubject: true,
    emailVerified: true,
    expectedPhone: true,
    phoneVerified: confirmed ? true : null,
  });
  if (!state.subject) state.subject = subject;
}

async function logout(state: AbandonedPhone) {
  const result = await state.page.evaluate(async () => {
    const response = await fetch("/v1/auth/logout", {
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
      logout: response.status,
      profile: profile.status,
      session: session.status,
    };
  });
  expect(result, "owned logout revokes private access").toEqual({
    logout: 200,
    profile: 401,
    session: 401,
  });
}

async function passwordSignIn(state: AbandonedPhone, base: string) {
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
    state.password,
  );
  const accepted = await runGatedLoginAttempt(
    {
      close: async () => {
        const user = process.env.E2E_HTTP_USER;
        const password = process.env.E2E_HTTP_PASS;
        const closing = await request.newContext({
          baseURL: base,
          ...(user && password
            ? { httpCredentials: { username: user, password } }
            : {}),
        });
        try {
          const response = await closing.post("/v1/auth/login", {
            data: { identifier: state.email, password: state.password },
          });
          expect(
            response.status(),
            "owned successful sign-in closes the failure window",
          ).toBe(200);
        } finally {
          try {
            const revoked = await closing.post("/v1/auth/logout");
            expect(revoked.status(), "owned closing session is revoked").toBe(
              200,
            );
          } finally {
            await closing.dispose();
          }
        }
      },
    },
    async () => {
      const pending = captureResponse(state.page, "/v1/auth/login");
      await state.page.getByTestId("password-login-submit").click();
      return pending;
    },
  );
  expect(accepted.response.status(), "email password still signs in").toBe(200);
  await state.page.waitForURL((url) => url.pathname === "/account");
  await state.page.waitForLoadState("networkidle");
  await assertSecureSession(state.page, accepted.response, base);
}

async function requestReplacement(state: AbandonedPhone) {
  await state.page.getByTestId("profile-phone-action").click();
  await state.page
    .getByTestId("profile-phone-input")
    .pressSequentially(state.replacement.slice(1));
  const after = await captureSmsCheckpoint(state.sink, state.replacement);
  const pending = captureResponse(state.page, "/v1/me/phone");
  await state.page.getByTestId("profile-phone-send").click();
  const answer = await pending;
  expect({
    status: answer.response.status(),
    neutral: answer.body === '{"status":"code_sent"}',
  }).toEqual({ status: 200, neutral: true });
  await expect(state.page.getByTestId("profile-phone-code")).toBeVisible();
  const code = await waitForSmsCode(
    state.sink,
    state.replacement,
    after,
    phoneConfirmationCode,
    PHONE_CODE_EVENT,
  );
  expect(
    /^\d{6}$/.test(code),
    "actual fresh replacement confirmation SMS arrived",
  ).toBe(true);
}

Given(
  "an owned Academy account confirms phone A and receives but never enters a replacement phone B code",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink)
      throw new Error("Abandoned phone proof requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const original = freshConfirmablePhone();
    let replacement = freshConfirmablePhone();
    while (replacement === original) replacement = freshConfirmablePhone();
    const state: AbandonedPhone = {
      context,
      page: owned,
      email: `phone-abandoned-3016-${randomUUID()}@example.test`,
      password: `Owned-${randomUUID()}-aA1!`,
      original,
      replacement,
      sink,
    };
    journeys.set(page, state);
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const pending = captureResponse(owned, "/v1/auth/verify");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "owned email verified").toBe(200);
    await owned.waitForURL((url) => url.pathname === "/account");
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, verified.response, world.hostBaseUrl);
    await confirmOwnedPhone(owned, { phone: original, sink });
    await profile(state, true);
    await requestReplacement(state);
    await profile(state, false);
  },
);

When(
  "the owner abandons replacement and signs into Academy again by email and password",
  async ({ page, world }) => {
    const state = journey(page);
    await logout(state);
    await passwordSignIn(state, world.hostBaseUrl);
  },
);

Then(
  "the same reloaded Academy identity has no confirmed phone and neither A nor B can request an SMS sign-in code",
  async ({ page, world }) => {
    const state = journey(page);
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await profile(state, false);
    await expect(state.page.getByTestId("profile-phone-verified")).toHaveCount(
      0,
    );
    await logout(state);
    const boundaries: {
      phone: string;
      after: SmsCheckpoint;
      deadline: number;
    }[] = [];
    for (const phone of [state.original, state.replacement]) {
      await state.page.goto(
        `${world.hostBaseUrl}/login?method=code&returnTo=%2Faccount`,
        { waitUntil: "load" },
      );
      await state.page.waitForLoadState("networkidle");
      await state.page.getByTestId("otp-channel-sms").click();
      await inputSecret(state.page.getByTestId("otp-identifier"), phone);
      const after = await captureSmsCheckpoint(state.sink, phone);
      const pending = captureResponse(state.page, "/v1/auth/login/otp/request");
      await state.page.getByTestId("otp-send").click();
      const answer = await pending;
      let exactCommand = false;
      try {
        const body = answer.response.request().postDataJSON();
        exactCommand =
          Object.keys(body).sort().join() === "channel,identifier" &&
          body.channel === "sms" &&
          body.identifier === phone;
      } catch {
        /* Secret-bearing parser diagnostics are not evidence. */
      }
      expect({
        status: answer.response.status(),
        neutral: answer.body === '{"status":"otp_sent"}',
        exactCommand,
      }).toEqual({ status: 200, neutral: true, exactCommand: true });
      await expect(
        state.page.locator('input[autocomplete="one-time-code"]'),
      ).toBeVisible();
      expect(
        await state.page.evaluate(async () => ({
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
        })),
        "each phone request leaves this visitor unauthorized",
      ).toEqual({ profile: 401, session: 401 });
      expect(
        (await state.context.cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        ),
        "each phone request issues no private cookie",
      ).toBe(false);
      boundaries.push({ phone, after, deadline: Date.now() + 20_000 });
    }
    while (true) {
      const finalObservation = boundaries.every(
        ({ deadline }) => Date.now() >= deadline,
      );
      for (const boundary of boundaries) {
        expect(
          (await smsSinkMessages(state.sink, boundary.phone, boundary.after))
            .length,
          "no addressed SMS after abandoned replacement",
        ).toBe(0);
      }
      if (finalObservation) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(
      await state.page.evaluate(async () => ({
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
      })),
      "neither neutral request grants private access",
    ).toEqual({ profile: 401, session: 401 });
    expect(
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "no private cookie from either phone",
    ).toBe(false);
  },
);

Then(
  "the email owner can return to the profile and request a fresh actual confirmation SMS for B",
  async ({ page, world }) => {
    const state = journey(page);
    await passwordSignIn(state, world.hostBaseUrl);
    await profile(state, false);
    await requestReplacement(state);
    await profile(state, false);
  },
);

After("@phone-abandoned", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    )
      await logout(state);
  } finally {
    await state.context.close();
    journeys.delete(page);
  }
});
