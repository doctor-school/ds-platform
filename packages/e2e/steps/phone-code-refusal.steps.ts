import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  freshConfirmablePhone,
  PHONE_CODE_EVENT,
  phoneConfirmationCode,
  smsSinkUrl,
  waitForSmsCode,
} from "../lib/sms-sink.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface PhoneAttempt {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  code: string;
  subject?: string;
  checkpoint?: AddressedMailCheckpoint;
  attemptedAt?: string;
}
const attempts = new WeakMap<Page, PhoneAttempt>();
function attempt(key: Page): PhoneAttempt {
  const state = attempts.get(key);
  if (!state) throw new Error("Owned wrong-phone-code attempt absent");
  return state;
}

async function identity(state: PhoneAttempt) {
  return state.page.evaluate(
    async ({ email, phone, subject }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await response.json();
      const session = await sessionResponse.json();
      return {
        status: response.status,
        sessionStatus: sessionResponse.status,
        sameEmail: profile.email === email,
        emailVerified: profile.emailVerified,
        phoneAbsent: profile.phone === null,
        samePhone: profile.phone === phone,
        phoneVerified: profile.phoneVerified,
        sameSubject:
          subject === undefined
            ? typeof session.sub === "string" && !!session.sub
            : session.sub === subject,
        subject: session.sub as string,
      };
    },
    { email: state.email, phone: state.phone, subject: state.subject },
  );
}

Given(
  "an owned verified Academy account requests a fresh phone code and receives its actual SMS",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink)
      throw new Error("Wrong-phone-code proof requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: PhoneAttempt = {
      context,
      page: await context.newPage(),
      email: `phone-refusal-3007-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      code: "",
    };
    attempts.set(page, state);
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      state.page,
      world.hostBaseUrl,
      { email: state.email, password: `Owned-${randomUUID()}-aA1!` },
      "/account",
    );
    const verifying = captureResponse(state.page, "/v1/auth/verify");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await verifying;
    expect(verified.response.status(), "real owned registration verified").toBe(
      200,
    );
    await state.page.waitForURL((url) => url.pathname === "/account");
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(state.page, verified.response, world.hostBaseUrl);
    const before = await identity(state);
    const { subject, ...evidence } = before;
    expect(evidence, "verified owner starts without a confirmed phone").toEqual(
      {
        status: 200,
        sessionStatus: 200,
        sameEmail: true,
        emailVerified: true,
        phoneAbsent: true,
        samePhone: false,
        phoneVerified: null,
        sameSubject: true,
      },
    );
    state.subject = subject;
    await state.page.getByTestId("profile-phone-action").click();
    await state.page
      .getByTestId("profile-phone-input")
      .pressSequentially(state.phone.slice(1));
    const requestedAt = new Date().toISOString();
    const requesting = captureResponse(state.page, "/v1/me/phone");
    await state.page.getByTestId("profile-phone-send").click();
    const requested = await requesting;
    expect(requested.response.status()).toBe(200);
    expect(JSON.parse(requested.body)).toEqual({ status: "code_sent" });
    state.code = await waitForSmsCode(
      sink,
      state.phone,
      requestedAt,
      phoneConfirmationCode,
      PHONE_CODE_EVENT,
    );
    expect(
      /^\d{6}$/.test(state.code),
      "actual addressed six-digit phone code",
    ).toBe(true);
  },
);

When(
  "the owner submits a different six-digit phone code through the Academy code field",
  async ({ page, world }) => {
    const state = attempt(page);
    state.checkpoint = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
    );
    const wrong = `${(Number(state.code[0]) + 1) % 10}${state.code.slice(1)}`;
    expect(
      /^\d{6}$/.test(wrong) && wrong !== state.code,
      "well-formed code differs from the real delivery",
    ).toBe(true);
    state.attemptedAt = new Date().toISOString();
    const pending = captureResponse(state.page, "/v1/me/phone/confirm");
    await inputSecret(state.page.getByTestId("profile-phone-code"), wrong);
    const refused = await pending;
    let genericFailure = false;
    try {
      const body = JSON.parse(refused.body);
      genericFailure =
        body.statusCode === 400 &&
        body.message === "the request could not be completed" &&
        body.error === "Bad Request" &&
        Object.keys(body).length === 3;
    } catch {
      /* Discard diagnostics that could quote a submitted code. */
    }
    expect({ status: refused.response.status(), genericFailure }).toEqual({
      status: 400,
      genericFailure: true,
    });
  },
);

Then(
  "Academy shows the generic phone-code refusal and the same owner stays unconfirmed with no addressed mail for 15 seconds",
  async ({ page, world }) => {
    const state = attempt(page);
    await expect(state.page.locator("#profile-phone-code-error")).toHaveText(
      "Неверный код",
    );
    await expect(state.page.getByTestId("profile-phone-code")).toBeVisible();
    await expect(state.page.getByTestId("profile-phone-verified")).toHaveCount(
      0,
    );
    const { subject: _subject, ...before } = await identity(state);
    expect(before).toEqual({
      status: 200,
      sessionStatus: 200,
      sameEmail: true,
      emailVerified: true,
      phoneAbsent: true,
      samePhone: false,
      phoneVerified: null,
      sameSubject: true,
    });
    if (!state.checkpoint || !state.attemptedAt)
      throw new Error("Wrong-code mail boundary absent");
    await assertNoAddressedMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.attemptedAt,
      state.checkpoint,
    );
    const { subject: _afterSubject, ...after } = await identity(state);
    expect(after).toEqual(before);
  },
);

Then(
  "the retained real SMS code confirms that phone on the same Academy account",
  async ({ page }) => {
    const state = attempt(page);
    const pending = captureResponse(state.page, "/v1/me/phone/confirm");
    await inputSecret(state.page.getByTestId("profile-phone-code"), state.code);
    const accepted = await pending;
    expect(
      accepted.response.status(),
      "retained actual code remains usable",
    ).toBe(200);
    let acceptedOwnedPhone = false;
    try {
      const body = JSON.parse(accepted.body);
      acceptedOwnedPhone =
        body.status === "confirmed" &&
        body.phone === state.phone &&
        Object.keys(body).length === 2;
    } catch {
      /* Discard sensitive response diagnostics. */
    }
    expect(acceptedOwnedPhone).toBe(true);
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    await expect(state.page.locator("#profile-phone-code-error")).toHaveCount(
      0,
    );
    const { subject: _subject, ...after } = await identity(state);
    expect(after).toEqual({
      status: 200,
      sessionStatus: 200,
      sameEmail: true,
      emailVerified: true,
      phoneAbsent: false,
      samePhone: true,
      phoneVerified: true,
      sameSubject: true,
    });
  },
);

After("@phone-code-refusal", async ({ page }) => {
  const state = attempts.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      expect(
        await state.page.evaluate(async () => {
          const logout = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
          });
          return { logout: logout.status, profile: profile.status };
        }),
        "owned wrong-code session revoked",
      ).toEqual({ logout: 200, profile: 401 });
    }
  } finally {
    state.code = "";
    await state.context.close();
    attempts.delete(page);
  }
});
