import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
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

interface ExpiringPhone {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  sink: string;
  mailpit: string;
  code: string;
  ttlMs: number;
  deliveredAt: number;
  subject?: string;
  cookie?: string;
  profile?: string;
  checkpoint?: AddressedMailCheckpoint;
}
const journeys = new WeakMap<Page, ExpiringPhone>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function journey(page: Page): ExpiringPhone {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned phone-expiry journey missing");
  return state;
}

/** Read only: no lifetime writes, stored-code aging or clock substitution. */
async function livePhoneLifetimeMs(): Promise<number> {
  const issuer = process.env.IDP_ISSUER;
  const token = process.env.IDP_SERVICE_TOKEN;
  if (!issuer || !token)
    throw new Error("Phone expiry requires IDP_ISSUER and IDP_SERVICE_TOKEN");
  let payload: { secretGenerator?: { expiry?: string; length?: number } };
  try {
    const response = await fetch(
      `${issuer.replace(/\/$/, "")}/admin/v1/secretgenerators/SECRET_GENERATOR_TYPE_VERIFY_PHONE_CODE`,
      {
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status !== 200) throw new Error("Generator read refused");
    payload = await response.json();
  } catch {
    throw new Error("Live phone-code generator could not be read");
  }
  const generator = payload?.secretGenerator;
  const seconds = Number(
    /^([0-9]+(?:\.[0-9]+)?)s$/.exec(generator?.expiry ?? "")?.[1],
  );
  expect(
    generator?.length === 6 &&
      Number.isFinite(seconds) &&
      seconds > 0 &&
      seconds <= 86_400,
    "live six-digit phone generator has a positive lifetime within one day",
  ).toBe(true);
  return seconds * 1000;
}

async function assertIdentity(
  state: ExpiringPhone,
  base: string,
  confirmed = false,
) {
  const result = await state.page.evaluate(
    async ({ email, phone, subject, previous, confirmed }) => {
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
        profile: JSON.stringify(profile),
        subject: session.sub as string | undefined,
        evidence: {
          profileStatus: profileResponse.status,
          sessionStatus: sessionResponse.status,
          sameEmail: profile.email === email,
          emailVerified: profile.emailVerified === true,
          expectedPhone: profile.phone === (confirmed ? phone : null),
          expectedVerification:
            profile.phoneVerified === (confirmed ? true : null),
          sameSubject:
            subject === undefined
              ? typeof session.sub === "string" && !!session.sub
              : subject === session.sub,
          unchangedProfile:
            confirmed ||
            previous === undefined ||
            previous === JSON.stringify(profile),
        },
      };
    },
    {
      email: state.email,
      phone: state.phone,
      subject: state.subject,
      previous: state.profile,
      confirmed,
    },
  );
  expect(
    result.evidence,
    "owned profile and subject have the expected confirmation state",
  ).toEqual({
    profileStatus: 200,
    sessionStatus: 200,
    sameEmail: true,
    emailVerified: true,
    expectedPhone: true,
    expectedVerification: true,
    sameSubject: true,
    unchangedProfile: true,
  });
  if (!result.subject) throw new Error("Owned expiry subject missing");
  state.subject ??= result.subject;
  state.profile ??= result.profile;
  const cookie = (await state.context.cookies()).find(
    (item) => item.name === "__Host-ds_session",
  );
  expect(
    {
      present: Boolean(cookie),
      same: state.cookie === undefined || cookie?.value === state.cookie,
      secure: cookie?.secure,
      httpOnly: cookie?.httpOnly,
      sameSite: cookie?.sameSite,
      path: cookie?.path,
      host: cookie?.domain === new URL(base).hostname,
    },
    "the same secure host-only session remains",
  ).toEqual({
    present: true,
    same: true,
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    host: true,
  });
  if (!cookie) throw new Error("Owned expiry cookie missing");
  state.cookie ??= cookie.value;
}

Given(
  "an owned verified Academy account receives a phone SMS under the live unchanged generator lifetime",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("Phone expiry requires E2E_SMS_SINK_URL");
    const ttlMs = await livePhoneLifetimeMs();
    test.setTimeout(ttlMs + 240_000);
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: ExpiringPhone = {
      context,
      page: await context.newPage(),
      email: `phone-expiry-3035-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      sink,
      mailpit: process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      code: "",
      ttlMs,
      deliveredAt: 0,
    };
    journeys.set(page, state);
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
    expect(verified.response.status(), "owned email verified").toBe(200);
    await state.page.waitForURL((url) => url.pathname === "/account");
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(state.page, verified.response, world.hostBaseUrl);
    await assertIdentity(state, world.hostBaseUrl);
    await state.page.getByTestId("profile-phone-action").click();
    await state.page
      .getByTestId("profile-phone-input")
      .pressSequentially(state.phone.slice(1));
    const requestedAt = new Date().toISOString();
    const requesting = captureResponse(state.page, "/v1/me/phone");
    await state.page.getByTestId("profile-phone-send").click();
    const requested = await requesting;
    expect(requested.response.status()).toBe(200);
    expect(requested.body).toBe('{"status":"code_sent"}');
    state.code = await waitForSmsCode(
      sink,
      state.phone,
      requestedAt,
      phoneConfirmationCode,
      PHONE_CODE_EVENT,
    );
    expect(/^\d{6}$/.test(state.code), "actual addressed phone code").toBe(
      true,
    );
    state.deliveredAt = performance.now();
    state.checkpoint = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      state.mailpit,
      state.email,
    );
  },
);

When(
  "the owner waits the complete natural phone-code lifetime and submits exactly that received SMS in Academy",
  async ({ page }) => {
    const state = journey(page);
    const deadline = state.deliveredAt + state.ttlMs + 2000;
    while (performance.now() < deadline)
      await sleep(Math.min(30_000, deadline - performance.now()));
    expect(
      performance.now() - state.deliveredAt > state.ttlMs,
      "full real lifetime elapsed after delivery",
    ).toBe(true);
    expect(
      await livePhoneLifetimeMs(),
      "live generator lifetime remained unchanged",
    ).toBe(state.ttlMs);
    const pending = captureResponse(state.page, "/v1/me/phone/confirm");
    await inputSecret(state.page.getByTestId("profile-phone-code"), state.code);
    const refused = await pending;
    let generic = false;
    try {
      const body = JSON.parse(refused.body);
      generic =
        Object.keys(body).length === 3 &&
        body.statusCode === 400 &&
        body.message === "the request could not be completed" &&
        body.error === "Bad Request";
    } catch {
      /* Do not retain code-bearing response diagnostics. */
    }
    expect({ status: refused.response.status(), generic }).toEqual({
      status: 400,
      generic: true,
    });
  },
);

Then(
  "the expired code shows generic refusal and preserves the same unconfirmed secure owner with no addressed mail for twenty seconds",
  async ({ page, world }) => {
    const state = journey(page);
    await expect(state.page.locator("#profile-phone-code-error")).toHaveText(
      /^⚠?\s*Неверный код$/,
    );
    await expect(state.page.getByTestId("profile-phone-code")).toBeVisible();
    await expect(state.page.getByTestId("profile-phone-verified")).toHaveCount(
      0,
    );
    await assertIdentity(state, world.hostBaseUrl);
    if (!state.checkpoint)
      throw new Error("Phone-expiry mailbox checkpoint missing");
    const deadline = Date.now() + 20_000;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      const current = await captureAddressedMailCheckpoint(
        nativeRecoveryMail(),
        state.mailpit,
        state.email,
      );
      expect(
        current.messageIds.some(
          (id) => !state.checkpoint!.messageIds.includes(id),
        ),
        "no addressed mail through full expiry refusal horizon",
      ).toBe(false);
      if (finalObservation) break;
      await sleep(Math.min(500, Math.max(1, deadline - Date.now())));
    }
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await assertIdentity(state, world.hostBaseUrl);
  },
);

Then(
  "a newly requested actual SMS promptly confirms the same Academy owner's phone as the fresh control",
  async ({ page, world }) => {
    const state = journey(page);
    await confirmOwnedPhone(state.page, {
      phone: state.phone,
      sink: state.sink,
    });
    await assertIdentity(state, world.hostBaseUrl, true);
  },
);

After("@phone-code-expiry", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (item) => item.name === "__Host-ds_session",
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
        "owned phone-expiry session revoked",
      ).toEqual({ logout: 200, profile: 401, session: 401 });
    }
  } finally {
    state.code = "";
    await state.context.close();
    journeys.delete(page);
  }
});
