import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
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
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface PhoneChange {
  context: BrowserContext;
  page: Page;
  email: string;
  originalPhone: string;
  replacementPhone: string;
  sink: string;
  subject?: string;
  cookie?: string;
  requestedAt?: string;
}

const changes = new WeakMap<Page, PhoneChange>();
function stateFor(page: Page): PhoneChange {
  const state = changes.get(page);
  if (!state) throw new Error("The owned phone-change account is missing");
  return state;
}

async function identity(page: Page) {
  return page.evaluate(async () => {
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
      profileStatus: profileResponse.status,
      sessionStatus: sessionResponse.status,
      email: profile.email,
      emailVerified: profile.emailVerified,
      phone: profile.phone,
      phoneVerified: profile.phoneVerified,
      subject: session.sub,
    };
  });
}

async function assertSameIdentity(
  state: PhoneChange,
  pending: boolean,
  base: string,
) {
  const current = await identity(state.page);
  expect(
    {
      profile: current.profileStatus,
      session: current.sessionStatus,
      sameEmail: current.email === state.email,
      emailVerified: current.emailVerified,
      sameSubject: current.subject === state.subject,
      expectedPhone: pending
        ? current.phone === null
        : current.phone === state.replacementPhone,
      phoneVerified: current.phoneVerified,
    },
    "the same private identity has exactly the expected phone state",
  ).toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    emailVerified: true,
    sameSubject: true,
    expectedPhone: true,
    phoneVerified: pending ? null : true,
  });
  const cookie = (await state.context.cookies()).find(
    (candidate) => candidate.name === "__Host-ds_session",
  );
  expect(
    {
      sameCookie: Boolean(cookie) && cookie!.value === state.cookie,
      domain: cookie?.domain,
      path: cookie?.path,
      secure: cookie?.secure,
      httpOnly: cookie?.httpOnly,
      sameSite: cookie?.sameSite,
    },
    "the phone change preserves the same secure host-only session",
  ).toEqual({
    sameCookie: true,
    domain: new URL(base).hostname,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });
}

Given(
  "an owned verified Academy account has confirmed its original phone through an actual SMS",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("Phone change requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const originalPhone = freshConfirmablePhone();
    let replacementPhone = freshConfirmablePhone();
    while (replacementPhone === originalPhone)
      replacementPhone = freshConfirmablePhone();
    const state: PhoneChange = {
      context,
      page: owned,
      email: `phone-change-3009-${randomUUID()}@example.test`,
      originalPhone,
      replacementPhone,
      sink,
    };
    changes.set(page, state);
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      { email: state.email, password: `Owned-${randomUUID()}-aA1!` },
      "/account",
    );
    const verification = captureResponse(owned, "/v1/auth/verify");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await verification;
    expect(verified.response.status(), "owned email verified").toBe(200);
    await owned.waitForURL((url) => url.pathname === "/account");
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, verified.response, world.hostBaseUrl);
    await confirmOwnedPhone(owned, { phone: originalPhone, sink });
    const initial = await identity(owned);
    expect(
      {
        profile: initial.profileStatus,
        session: initial.sessionStatus,
        sameEmail: initial.email === state.email,
        emailVerified: initial.emailVerified,
        samePhone: initial.phone === originalPhone,
        phoneVerified: initial.phoneVerified,
        hasSubject:
          typeof initial.subject === "string" && initial.subject.length > 0,
      },
      "a real confirmed original phone belongs to this private identity",
    ).toEqual({
      profile: 200,
      session: 200,
      sameEmail: true,
      emailVerified: true,
      samePhone: true,
      phoneVerified: true,
      hasSubject: true,
    });
    state.subject = initial.subject;
    const cookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-ds_session",
    )?.value;
    expect(Boolean(cookie), "owned session exists before displacement").toBe(
      true,
    );
    if (!cookie) throw new Error("The owned session cookie is missing");
    state.cookie = cookie;
  },
);

When(
  "that Academy account requests a code for a different fresh phone through its phone row",
  async ({ page }) => {
    const state = stateFor(page);
    await state.page.getByTestId("profile-phone-action").click();
    await state.page
      .getByTestId("profile-phone-input")
      .pressSequentially(state.replacementPhone.slice(1));
    state.requestedAt = new Date().toISOString();
    const requested = captureResponse(state.page, "/v1/me/phone");
    await state.page.getByTestId("profile-phone-send").click();
    const response = await requested;
    expect(response.response.status(), "replacement code requested").toBe(200);
    expect(response.body, "exact code-free acknowledgement").toBe(
      '{"status":"code_sent"}',
    );
  },
);

Then(
  "the phone awaits confirmation and the same Academy profile immediately has no confirmed phone",
  async ({ page, world }) => {
    const state = stateFor(page);
    await expect(state.page.getByTestId("profile-phone-code")).toBeVisible();
    await expect(
      state.page.getByTestId("profile-phone-code-sent"),
    ).toBeVisible();
    await expect(state.page.getByTestId("profile-phone-verified")).toHaveCount(
      0,
    );
    await assertSameIdentity(state, true, world.hostBaseUrl);
  },
);

When(
  "the account enters the actual confirmation SMS delivered to its replacement phone",
  async ({ page }) => {
    const state = stateFor(page);
    if (!state.requestedAt)
      throw new Error("Replacement delivery boundary is missing");
    const code = await waitForSmsCode(
      state.sink,
      state.replacementPhone,
      state.requestedAt,
      phoneConfirmationCode,
      PHONE_CODE_EVENT,
    );
    expect(/^\d{6}$/.test(code), "replacement SMS has six digits").toBe(true);
    const confirmation = captureResponse(state.page, "/v1/me/phone/confirm");
    await inputSecret(state.page.getByTestId("profile-phone-code"), code);
    expect(
      (await confirmation).response.status(),
      "replacement phone confirmed",
    ).toBe(200);
  },
);

Then(
  "reloading Academy retains only the verified replacement phone on that same account and session",
  async ({ page, world }) => {
    const state = stateFor(page);
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    await expect(state.page.getByTestId("profile-phone-code")).toHaveCount(0);
    await assertSameIdentity(state, false, world.hostBaseUrl);
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    await assertSameIdentity(state, false, world.hostBaseUrl);
    await state.page.screenshot({
      path: test.info().outputPath("phone-change-confirmed.png"),
    });
  },
);

After("@phone-change", async ({ page }) => {
  const state = changes.get(page);
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
        "owned phone-change session revoked",
      ).toEqual({ logout: 200, profile: 401 });
    }
  } finally {
    await state.context.close();
    changes.delete(page);
  }
});
