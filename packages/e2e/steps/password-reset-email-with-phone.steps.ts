import { randomUUID } from "node:crypto";
import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import { installCaptchaStub } from "../lib/captcha-stub.js";
import {
  captureAddressedMailCheckpoint,
  fetchRecoveryCode,
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
  smsSinkMessages,
  smsSinkUrl,
} from "../lib/sms-sink.js";
import { After, Before, Given, Then, When } from "./support/auth-fixtures.js";

interface EmailReset {
  email: string;
  phone: string;
  sink: string;
  mailpit: string;
  contexts: BrowserContext[];
  account: Page;
  guest: Page;
  mailbox?: AddressedMailCheckpoint;
  requestedAt?: string;
}
const resets = new WeakMap<Page, EmailReset>();
function stateFor(page: Page): EmailReset {
  const state = resets.get(page);
  if (!state) throw new Error("Owned email-reset account was not prepared");
  return state;
}
function post(page: Page, path: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().method() === "POST",
  );
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Before("@email-reset-with-phone", async ({ $testInfo }) => {
  $testInfo.skip(
    smsSinkUrl() === null,
    "@email-reset-with-phone requires E2E_SMS_SINK_URL",
  );
});

Given(
  "a uniquely owned verified Academy account has confirmed a fresh phone in its profile",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const contexts: BrowserContext[] = [];
    const privatePage = async () => {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      contexts.push(context);
      await installCaptchaStub(context);
      return context.newPage();
    };
    const account = await privatePage();
    const state: EmailReset = {
      email: `reset-email-2962-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      sink: smsSinkUrl()!,
      mailpit: process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      contexts,
      account,
      guest: await privatePage(),
    };
    resets.set(page, state);
    const { code } = await registerOwnedCredentials(
      account,
      world.hostBaseUrl,
      { email: state.email, password: `Owned-${randomUUID()}-aA1!` },
      "/account",
    );
    const verified = post(account, "/v1/auth/verify");
    await inputSecret(
      account.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const response = await verified;
    expect(response.status(), "registration code accepted").toBe(200);
    await account.waitForURL((url) => url.pathname === "/account");
    await account.waitForLoadState("networkidle");
    await assertSecureSession(account, response, world.hostBaseUrl);
    expect(
      await account.evaluate(async (email) => {
        const response = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        const profile = await response.json();
        return {
          status: response.status,
          sameEmail: profile.email === email,
          emailVerified: profile.emailVerified,
        };
      }, state.email),
    ).toEqual({ status: 200, sameEmail: true, emailVerified: true });
    const before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      state.mailpit,
      state.email,
    );
    await confirmOwnedPhone(account, state);
    // EARS-52 is detached: observe its delivery before accepting a stable baseline.
    let previous = before;
    for (let attempt = 0; attempt < 10; attempt++) {
      await wait(3000);
      const next = await captureAddressedMailCheckpoint(
        nativeRecoveryMail(),
        state.mailpit,
        state.email,
      );
      if (
        next.messageIds.some((id) => !before.messageIds.includes(id)) &&
        [...next.messageIds].sort().join() ===
          [...previous.messageIds].sort().join()
      ) {
        state.mailbox = next;
        return;
      }
      previous = next;
    }
    throw new Error("Phone-confirmation notice mailbox did not settle");
  },
);

When(
  "an independent guest requests reset using that Academy account's email",
  async ({ page, world }) => {
    const state = stateFor(page);
    await state.guest.goto(`${world.hostBaseUrl}/reset`, { waitUntil: "load" });
    await state.guest.waitForLoadState("networkidle");
    expect(
      (await state.guest.context().cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "reset requester is a guest",
    ).toBe(false);
    await inputSecret(
      state.guest.locator('input[autocomplete="username"]'),
      state.email,
    );
    state.requestedAt = new Date().toISOString();
    const pending = post(state.guest, "/v1/auth/password/reset");
    await state.guest.getByTestId("reset-request-submit").click();
    const response = await pending;
    expect(response.status(), "neutral reset status").toBe(200);
    expect(
      await response.json(),
      "exact neutral reset acknowledgement",
    ).toEqual({ status: "reset_requested" });
  },
);

Then(
  "Academy delivers one fresh six-digit email reset code, shows the email step and sends no SMS for twenty seconds",
  async ({ page }) => {
    const state = stateFor(page);
    if (!state.requestedAt || !state.mailbox)
      throw new Error("Reset delivery boundary is missing");
    const code = await fetchRecoveryCode(
      nativeRecoveryMail(),
      state.mailpit,
      state.email,
      state.requestedAt,
      "reset",
    );
    expect(
      /^\d{6}$/.test(code),
      "fresh addressed reset code has six digits",
    ).toBe(true);
    await expect(
      state.guest.locator('input[autocomplete="one-time-code"]'),
    ).toBeVisible();
    await expect(
      state.guest.getByText(
        `Код отправлен на ${state.email}. Введите его и задайте новый пароль.`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      state.guest.getByText(
        "Код действует 1 час. Не видите письмо — проверьте папку «Спам».",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      state.guest.getByText(/Если телефон .* подтверждён в профиле/),
    ).toHaveCount(0);
    // Start the full negative horizon only after positive email delivery is proven.
    const deadline = Date.now() + 20_000;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      expect(
        (await smsSinkMessages(state.sink, state.phone, state.requestedAt))
          .length,
        "no addressed SMS after email reset",
      ).toBe(0);
      if (finalObservation) break;
      await wait(Math.min(500, Math.max(0, deadline - Date.now())));
    }
    const delivered = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      state.mailpit,
      state.email,
    );
    const previous = new Set(state.mailbox.messageIds);
    expect(
      {
        added: delivered.messageIds.filter((id) => !previous.has(id)).length,
        baselineRemains: state.mailbox.messageIds.every((id) =>
          delivered.messageIds.includes(id),
        ),
      },
      "exactly one email added after the settled confirmation notice",
    ).toEqual({ added: 1, baselineRemains: true });
  },
);

After("@email-reset-with-phone", async ({ page }) => {
  const state = resets.get(page);
  if (!state) return;
  try {
    if (
      (await state.account.context().cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      expect(
        await state.account.evaluate(async () => {
          const response = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
          });
          return { logout: response.status, profile: profile.status };
        }),
        "owned session revoked",
      ).toEqual({ logout: 200, profile: 401 });
    }
  } finally {
    await Promise.all(state.contexts.map((context) => context.close()));
    resets.delete(page);
  }
});
