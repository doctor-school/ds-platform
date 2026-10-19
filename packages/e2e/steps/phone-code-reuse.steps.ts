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
  smsSinkMessages,
  smsSinkUrl,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface ConsumedPhone {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  code: string;
  mailpit: string;
  subject?: string;
  profile?: string;
  cookie?: string;
  checkpoint?: AddressedMailCheckpoint;
}
const journeys = new WeakMap<Page, ConsumedPhone>();
function journey(key: Page): ConsumedPhone {
  const state = journeys.get(key);
  if (!state) throw new Error("Owned consumed-phone-code journey missing");
  return state;
}

async function assertIdentity(state: ConsumedPhone, base: string) {
  const result = await state.page.evaluate(
    async ({ email, phone, subject, previous }) => {
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
          samePhone: profile.phone === phone,
          phoneVerified: profile.phoneVerified === true,
          sameSubject:
            subject === undefined
              ? typeof session.sub === "string" && !!session.sub
              : subject === session.sub,
          unchangedProfile:
            previous === undefined || previous === JSON.stringify(profile),
        },
      };
    },
    {
      email: state.email,
      phone: state.phone,
      subject: state.subject,
      previous: state.profile,
    },
  );
  expect(
    result.evidence,
    "the same verified private profile survives consumed-code replay",
  ).toEqual({
    profileStatus: 200,
    sessionStatus: 200,
    sameEmail: true,
    emailVerified: true,
    samePhone: true,
    phoneVerified: true,
    sameSubject: true,
    unchangedProfile: true,
  });
  if (!result.subject) throw new Error("Owned session subject missing");
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
    "the original secure host-only session survives",
  ).toEqual({
    present: true,
    same: true,
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    host: true,
  });
  if (!cookie) throw new Error("Owned secure session missing");
  state.cookie ??= cookie.value;
  await expect(state.page.getByTestId("profile-phone")).toBeVisible();
  expect(
    await state.page
      .getByTestId("profile-phone")
      .evaluate(
        (element, phone) =>
          element.textContent?.replace(/\D/g, "") === phone.replace(/\D/g, ""),
        state.phone,
      ),
    "the visible phone row still contains the exact verified number",
  ).toBe(true);
  await expect(state.page.getByTestId("profile-phone-verified")).toBeVisible();
  await expect(state.page.getByTestId("profile-phone-code")).toHaveCount(0);
}

Given(
  "an owned Academy account has actually consumed its only phone SMS code through the profile UI",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink)
      throw new Error("Consumed-phone-code proof requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: ConsumedPhone = {
      context,
      page: await context.newPage(),
      email: `phone-reuse-3025-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      code: "",
      mailpit: process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
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
    const mail = nativeRecoveryMail();
    const before = await captureAddressedMailCheckpoint(
      mail,
      state.mailpit,
      state.email,
    );
    const requestedAt = new Date().toISOString();
    await confirmOwnedPhone(state.page, { phone: state.phone, sink });
    const messages = await smsSinkMessages(
      sink,
      state.phone,
      requestedAt,
      PHONE_CODE_EVENT,
    );
    expect(messages.length, "exactly one actual phone confirmation SMS").toBe(
      1,
    );
    state.code = phoneConfirmationCode(messages[0]!) ?? "";
    expect(
      /^\d{6}$/.test(state.code),
      "the retained code is the actual consumed SMS",
    ).toBe(true);
    await assertIdentity(state, world.hostBaseUrl);
    const deadline = Date.now() + 20_000;
    while (true) {
      const current = await captureAddressedMailCheckpoint(
        mail,
        state.mailpit,
        state.email,
      );
      const fresh = current.messageIds.filter(
        (id) => !before.messageIds.includes(id),
      );
      expect(
        fresh.length <= 1,
        "only the original addressed phone-success notice arrives",
      ).toBe(true);
      if (fresh.length === 1) {
        const response = await mail.get(
          `${state.mailpit}/api/v1/message/${encodeURIComponent(fresh[0]!)}`,
        );
        if (!response.ok())
          throw new Error("Owned phone notice could not be read");
        const notice = (await response.json()) as {
          Subject?: string;
          To?: { Address: string }[];
        };
        expect(
          {
            subject:
              notice.Subject ===
              "Doctor.School — в аккаунте подтверждён номер телефона",
            recipient:
              notice.To?.some(
                (item) =>
                  item.Address.toLowerCase() === state.email.toLowerCase(),
              ) === true,
          },
          "the original phone-success notice reached its owner",
        ).toEqual({ subject: true, recipient: true });
        state.checkpoint = current;
        break;
      }
      if (Date.now() >= deadline)
        throw new Error("Original addressed phone-success notice missing");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  },
);

When(
  "that authenticated Academy browser replays exactly the consumed phone code without requesting another challenge",
  async ({ page }) => {
    const state = journey(page);
    let newChallenge = false;
    state.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/v1/me/phone"
      )
        newChallenge = true;
    });
    const result = await state.page.evaluate(async (code) => {
      const response = await fetch("/v1/me/phone/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
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
    }, state.code);
    expect(
      { ...result, newChallenge },
      "the exact consumed code is generically refused without a replacement challenge",
    ).toEqual({ status: 400, generic: true, newChallenge: false });
  },
);

Then(
  "the same verified Academy phone profile and secure session persist with no second addressed notice for 20 seconds",
  async ({ page, world }) => {
    const state = journey(page);
    if (!state.checkpoint)
      throw new Error("Original phone notice checkpoint missing");
    await assertIdentity(state, world.hostBaseUrl);
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
        "no additional addressed mail over the complete replay observation",
      ).toBe(false);
      if (finalObservation) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await assertIdentity(state, world.hostBaseUrl);
  },
);

After("@phone-code-reuse", async ({ page }) => {
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
        "owned consumed-code session revoked",
      ).toEqual({ logout: 200, profile: 401, session: 401 });
    }
  } finally {
    state.code = "";
    await state.context.close();
    journeys.delete(page);
  }
});
