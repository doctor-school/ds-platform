import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
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
  smsSinkUrl,
  waitForSmsCode,
} from "../lib/sms-sink.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface Owner {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  code: string;
  subject?: string;
}
const attempts = new WeakMap<Page, Owner[]>();
function owners(page: Page): [Owner, Owner] {
  const value = attempts.get(page);
  if (value?.length !== 2)
    throw new Error("Two owned phone challenges required");
  return value as [Owner, Owner];
}

async function assertIdentity(owner: Owner, confirmed: boolean) {
  const { subject, ...evidence } = await owner.page.evaluate(
    async ({ email, phone, subject }) => {
      const profileResponse = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await profileResponse.json();
      const session = await sessionResponse.json();
      return {
        profileStatus: profileResponse.status,
        sessionStatus: sessionResponse.status,
        sameEmail: profile.email === email,
        emailVerified: profile.emailVerified,
        samePhone: profile.phone === phone,
        phoneAbsent: profile.phone === null,
        phoneVerified: profile.phoneVerified,
        sameSubject:
          subject === undefined
            ? typeof session.sub === "string" && !!session.sub
            : subject === session.sub,
        subject: session.sub as string,
      };
    },
    { email: owner.email, phone: owner.phone, subject: owner.subject },
  );
  expect(evidence, "owned phone and identity state").toEqual({
    profileStatus: 200,
    sessionStatus: 200,
    sameEmail: true,
    emailVerified: true,
    samePhone: confirmed,
    phoneAbsent: !confirmed,
    phoneVerified: confirmed ? true : null,
    sameSubject: true,
  });
  return subject;
}

async function logout(owner: Owner) {
  if (
    !(await owner.context.cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    )
  )
    return;
  expect(
    await owner.page.evaluate(async () => {
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
    }),
    "owned active session is revoked",
  ).toEqual({ logout: 200, session: 401, profile: 401 });
  expect(
    (await owner.context.cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    ),
    "owned session cookie cleared",
  ).toBe(false);
}

Given(
  "two owned signed-in Academy doctors retain their distinct actual pending phone confirmation codes",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("Phone isolation requires E2E_SMS_SINK_URL");
    const state: Owner[] = [];
    attempts.set(page, state);
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      const owner: Owner = {
        context,
        page: await context.newPage(),
        email: `phone-isolation-3163-${randomUUID().replaceAll("-", "")}@example.test`,
        phone: freshConfirmablePhone(),
        code: "",
      };
      state.push(owner);
      expect(owner.email.split("@")[0]!.length <= 64).toBe(true);
      if (index === 1)
        expect(owner.phone !== state[0]!.phone, "distinct fresh phones").toBe(
          true,
        );
      await prepareCaptchaForJourney(
        context,
        world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      const { code } = await registerOwnedCredentials(
        owner.page,
        world.hostBaseUrl,
        { email: owner.email, password: `Owned-${randomUUID()}-aA1!` },
        "/account",
      );
      const verifying = captureResponse(
        owner.page,
        signInHostApiPath("/v1/auth/verify"),
      );
      await inputSecret(
        owner.page.locator('input[autocomplete="one-time-code"]'),
        code,
      );
      const verified = await verifying;
      expect(verified.response.status(), "owned registration accepted").toBe(
        200,
      );
      await owner.page.waitForURL((url) => url.pathname === "/account");
      await owner.page.waitForLoadState("networkidle");
      await assertSecureSession(
        owner.page,
        verified.response,
        world.hostBaseUrl,
      );
      owner.subject = await assertIdentity(owner, false);
      await owner.page.getByTestId("profile-phone-action").click();
      await owner.page
        .getByTestId("profile-phone-input")
        .pressSequentially(owner.phone.slice(1));
      const checkpoint = await captureSmsCheckpoint(sink, owner.phone);
      const requesting = captureResponse(owner.page, "/v1/me/phone");
      await owner.page.getByTestId("profile-phone-send").click();
      const requested = await requesting;
      expect({
        status: requested.response.status(),
        ordinary: requested.body === '{"status":"code_sent"}',
      }).toEqual({ status: 200, ordinary: true });
      owner.code = await waitForSmsCode(
        sink,
        owner.phone,
        checkpoint,
        phoneConfirmationCode,
        PHONE_CODE_EVENT,
      );
      expect(
        /^\d{6}$/.test(owner.code),
        "actual addressed six-digit code",
      ).toBe(true);
      await assertIdentity(owner, false);
    }
    const [first, second] = owners(page);
    expect(first.subject !== second.subject, "distinct owned doctors").toBe(
      true,
    );
    expect(
      first.code !== second.code,
      "actual pending codes must differ without reroll",
    ).toBe(true);
  },
);

When(
  "the second doctor submits the first doctor's live phone code and observes generic refusal with unchanged profiles and mailbox snapshot",
  async ({ page, world }) => {
    const [first, second] = owners(page);
    const mail =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mail,
      second.email,
    );
    const confirming = captureResponse(second.page, "/v1/me/phone/confirm");
    await inputSecret(
      second.page.getByTestId("profile-phone-code"),
      first.code,
    );
    const refused = await confirming;
    let generic = false;
    try {
      const body = JSON.parse(refused.body);
      generic =
        body.statusCode === 400 &&
        body.message === "the request could not be completed" &&
        body.error === "Bad Request" &&
        Object.keys(body).length === 3;
    } catch {
      // Do not expose submitted code or response diagnostics.
    }
    expect({ status: refused.response.status(), generic }).toEqual({
      status: 400,
      generic: true,
    });
    await expect(second.page.locator("#profile-phone-code-error")).toHaveText(
      /^⚠?\s*Неверный код$/,
    );
    for (const owner of [first, second]) {
      await expect(owner.page.getByTestId("profile-phone-code")).toBeVisible();
      await expect(
        owner.page.getByTestId("profile-phone-verified"),
      ).toHaveCount(0);
      await assertIdentity(owner, false);
    }
    const after = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      mail,
      second.email,
    );
    expect(
      after.messageIds.length === before.messageIds.length &&
        after.messageIds.every((id) => before.messageIds.includes(id)),
      "no new addressed mail in the immediate post-refusal snapshot",
    ).toBe(true);
  },
);

Then(
  "both retained rightful phone codes confirm only their owners and both profiles survive reload before logout",
  async ({ page }) => {
    const [first, second] = owners(page);
    for (const owner of [first, second]) {
      const field = owner.page.getByTestId("profile-phone-code");
      await field.press("ControlOrMeta+A");
      await field.press("Backspace");
      await expect(field).toHaveValue("");
      const confirming = captureResponse(owner.page, "/v1/me/phone/confirm");
      await inputSecret(field, owner.code);
      const accepted = await confirming;
      let rightfulPhone = false;
      try {
        const body = JSON.parse(accepted.body);
        rightfulPhone =
          body.status === "confirmed" &&
          body.phone === owner.phone &&
          Object.keys(body).length === 2;
      } catch {
        // Do not expose owned phone response diagnostics.
      }
      expect({ status: accepted.response.status(), rightfulPhone }).toEqual({
        status: 200,
        rightfulPhone: true,
      });
      await expect(
        owner.page.getByTestId("profile-phone-verified"),
      ).toBeVisible();
      await expect(owner.page.locator("#profile-phone-code-error")).toHaveCount(
        0,
      );
      await assertIdentity(owner, true);
      await owner.page.reload();
      await expect(
        owner.page.getByTestId("profile-phone-verified"),
      ).toBeVisible();
      await assertIdentity(owner, true);
      if (owner === first) await assertIdentity(second, false);
    }
    for (const owner of [first, second]) await logout(owner);
  },
);

After("@phone-code-isolation", async ({ page }) => {
  const state = attempts.get(page);
  if (!state) return;
  const results = await Promise.allSettled(
    state.map(async (owner) => {
      try {
        await logout(owner);
      } finally {
        owner.code = "";
        await owner.context.close();
      }
    }),
  );
  attempts.delete(page);
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
});
