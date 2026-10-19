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
import { createOwnedCongressSignup } from "../lib/owned-congress-signup.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  PHONE_CODE_EVENT,
  RESET_CODE_EVENT,
  smsOrigin,
  smsSinkMessages,
  smsSinkUrl,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface ResetTarget {
  phone: string;
  email?: string;
  checkpoint?: AddressedMailCheckpoint;
  guest?: Page;
  requestedAt?: SmsCheckpoint;
  setCookie?: string;
}
interface ResetJourney {
  contexts: BrowserContext[];
  owner?: Page;
  targets: ResetTarget[];
  sink: string;
  mailpit: string;
  password: string;
}
const journeys = new WeakMap<Page, ResetJourney>();
function journey(key: Page): ResetJourney {
  const state = journeys.get(key);
  if (!state) throw new Error("Unconfirmed-phone reset fixtures are absent");
  return state;
}

Given(
  "Academy owns distinct unknown, congress-contact and pending-confirmation phones for reset",
  async ({ page, browser, httpCredentials, world }) => {
    // Real intake mail and the complete negative delivery horizon need a case budget.
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink)
      throw new Error("Unconfirmed reset proof requires E2E_SMS_SINK_URL");
    const phones = new Set<string>();
    while (phones.size < 3) phones.add(freshConfirmablePhone());
    const state: ResetJourney = {
      contexts: [],
      targets: [...phones].map((phone) => ({ phone })),
      sink,
      mailpit: process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      password: `Owned-${randomUUID()}-aA1!`,
    };
    journeys.set(page, state);
    const privatePage = async () => {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      state.contexts.push(context);
      await prepareCaptchaForJourney(
        context,
        world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      return context.newPage();
    };
    for (const target of state.targets) {
      expect(
        (await smsSinkMessages(sink, target.phone, smsOrigin(target.phone)))
          .length,
        "fresh owned number has no earlier SMS",
      ).toBe(0);
    }
    const congress = state.targets[1]!;
    const digits = congress.phone.slice(2);
    const signup = await createOwnedCongressSignup(
      await privatePage(),
      world.hostBaseUrl,
      "reset-congress-3018",
      {
        contactPhone: `8 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`,
      },
    );
    congress.email = signup.email;
    const pending = state.targets[2]!;
    pending.email = `reset-pending-3018-${randomUUID()}@example.test`;
    state.owner = await privatePage();
    const { code } = await registerOwnedCredentials(
      state.owner,
      world.hostBaseUrl,
      { email: pending.email, password: state.password },
      "/account",
    );
    const verifying = captureResponse(state.owner, "/v1/auth/verify");
    await inputSecret(
      state.owner.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await verifying;
    expect(verified.response.status(), "real owned registration verified").toBe(
      200,
    );
    await state.owner.waitForURL((url) => url.pathname === "/account");
    await state.owner.waitForLoadState("networkidle");
    await assertSecureSession(
      state.owner,
      verified.response,
      world.hostBaseUrl,
    );
    await state.owner.getByTestId("profile-phone-action").click();
    await state.owner
      .getByTestId("profile-phone-input")
      .pressSequentially(pending.phone.slice(1));
    const phoneRequestedAt = await captureSmsCheckpoint(sink, pending.phone);
    const requesting = captureResponse(state.owner, "/v1/me/phone");
    await state.owner.getByTestId("profile-phone-send").click();
    const requested = await requesting;
    expect({
      status: requested.response.status(),
      neutral: requested.body === '{"status":"code_sent"}',
    }).toEqual({ status: 200, neutral: true });
    await expect(state.owner.getByTestId("profile-phone-code")).toBeVisible();
    // Observe delivery without reading or submitting the confirmation code.
    await expect
      .poll(
        async () =>
          (
            await smsSinkMessages(
              sink,
              pending.phone,
              phoneRequestedAt,
              PHONE_CODE_EVENT,
            )
          ).length,
        {
          timeout: 20_000,
          message: "real pending-phone confirmation SMS delivered",
        },
      )
      .toBe(1);
    expect(
      await state.owner.evaluate(async (email) => {
        const response = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        const profile = await response.json();
        return {
          status: response.status,
          sameEmail: profile.email === email,
          verifiedEmail: profile.emailVerified,
          phone: profile.phone === null,
          phoneVerified: profile.phoneVerified === null,
        };
      }, pending.email),
      "pending phone grants no confirmed profile phone",
    ).toEqual({
      status: 200,
      sameEmail: true,
      verifiedEmail: true,
      phone: true,
      phoneVerified: true,
    });
    for (const target of state.targets) {
      if (target.email)
        target.checkpoint = await captureAddressedMailCheckpoint(
          nativeRecoveryMail(),
          state.mailpit,
          target.email,
        );
      target.guest = await privatePage();
    }
  },
);

When(
  "independent Academy guests request password reset through the actual form for all three phones",
  async ({ page, world }) => {
    const state = journey(page);
    for (const target of state.targets) {
      const guest = target.guest!;
      await guest.goto(`${world.hostBaseUrl}/reset`, { waitUntil: "load" });
      await guest.waitForLoadState("networkidle");
      await inputSecret(
        guest.getByLabel("Электронная почта или телефон", { exact: true }),
        target.phone,
      );
      // Complete recipient checkpoints immediately before each reset request.
      if (target.email)
        target.checkpoint = await captureAddressedMailCheckpoint(
          nativeRecoveryMail(),
          state.mailpit,
          target.email,
        );
      target.requestedAt = await captureSmsCheckpoint(state.sink, target.phone);
      const requesting = captureResponse(guest, "/v1/auth/password/reset");
      await guest.getByTestId("reset-request-submit").click();
      const captured = await requesting;
      let exactCommand = false;
      try {
        const command = captured.response.request().postDataJSON();
        exactCommand =
          Object.keys(command).join() === "identifier" &&
          command.identifier === target.phone;
      } catch {
        /* Secret-bearing parse diagnostics are deliberately discarded. */
      }
      expect({
        status: captured.response.status(),
        exactCommand,
        exactAcknowledgement: captured.body === '{"status":"reset_requested"}',
      }).toEqual({
        status: 200,
        exactCommand: true,
        exactAcknowledgement: true,
      });
      target.setCookie =
        (await captured.response.headerValue("set-cookie")) ?? "";
      await expect(
        guest.locator('input[autocomplete="one-time-code"]'),
      ).toBeVisible();
      await expect(guest.getByTestId("reset-restart")).toBeEnabled();
      await expect(
        guest.getByText("Код действует 1 час.", { exact: true }),
      ).toBeVisible();
      expect(
        await guest.evaluate(
          (phone) =>
            [...document.querySelectorAll("strong")].some(
              (element) =>
                element.textContent === phone &&
                element.parentElement?.textContent ===
                  `Если телефон ${phone} подтверждён в профиле, мы отправили на него код по SMS. Введите его и задайте новый пароль.`,
            ),
          target.phone,
        ),
        "normal conditional SMS step for every phone state",
      ).toBe(true);
    }
  },
);

Then(
  "all three Academy reset guests remain private-session-free and receive no addressed delivery throughout twenty seconds",
  async ({ page }) => {
    const state = journey(page);
    // Start after the last response: every target gets the full horizon, plus a
    // final query beginning at or after the deadline, independent of inbox clocks.
    const deadline = Date.now() + 20_000;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      for (const target of state.targets) {
        if (!target.requestedAt)
          throw new Error("Reset delivery boundary is absent");
        const messages = await smsSinkMessages(
          state.sink,
          target.phone,
          target.requestedAt,
        );
        expect(
          {
            anyDelivery: messages.length > 0,
            resetDelivery:
              (
                await smsSinkMessages(
                  state.sink,
                  target.phone,
                  target.requestedAt,
                  RESET_CODE_EVENT,
                )
              ).length > 0,
          },
          "no new addressed SMS of any kind or reset event",
        ).toEqual({ anyDelivery: false, resetDelivery: false });
        if (target.email) {
          if (!target.checkpoint)
            throw new Error("Complete mailbox checkpoint is absent");
          const current = await captureAddressedMailCheckpoint(
            nativeRecoveryMail(),
            state.mailpit,
            target.email,
          );
          expect(
            current.messageIds.some(
              (id) => !target.checkpoint!.messageIds.includes(id),
            ),
            "no new mail addressed to either known account",
          ).toBe(false);
        }
      }
      if (finalObservation) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))),
      );
    }
    for (const target of state.targets) {
      await assertNoPrivateRegistrationAccess(
        target.guest!,
        target.setCookie ?? "",
        { email: target.email ?? "", password: state.password },
      );
      expect(
        await target.guest!.evaluate(
          async () =>
            (await fetch("/v1/auth/session", { credentials: "include" }))
              .status,
        ),
        "reset guest cannot read a private session",
      ).toBe(401);
    }
  },
);

After("@reset-unconfirmed-phones", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      state.owner &&
      (await state.owner.context().cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      expect(
        await state.owner.evaluate(async () => {
          const logout = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
          });
          return { logout: logout.status, profile: profile.status };
        }),
        "owned pending-phone session revoked",
      ).toEqual({ logout: 200, profile: 401 });
    }
  } finally {
    const closed = await Promise.allSettled(
      state.contexts.map((context) => context.close()),
    );
    journeys.delete(page);
    expect(
      closed.every((result) => result.status === "fulfilled"),
      "every owned browser context closed",
    ).toBe(true);
  }
});
