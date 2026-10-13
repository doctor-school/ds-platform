import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  fetchRecoveryMail,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  differentVerificationCode,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  verificationRefusalEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface VerificationMail extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  authPosts: string[];
  before?: AddressedMailCheckpoint;
  requestedAt: string;
  code?: string;
  mail?: Awaited<ReturnType<typeof fetchRecoveryMail>>;
  accepted?: CapturedResponse;
}

const registrations = new WeakMap<Page, VerificationMail>();

function registration(key: Page): VerificationMail {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned verification mail was not prepared");
  return state;
}

Given(
  "a fresh owned Academy registration is completed in its requesting tab without consuming a code",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const account: OwnedCredentials = {
      email: `verification-mail-2858-${randomUUID()}@example.test`,
      password: `Verification-${randomUUID()}-aA1!`,
    };
    const state: VerificationMail = {
      ...account,
      context,
      page: owned,
      authPosts: [],
      requestedAt: new Date().toISOString(),
    };
    registrations.set(page, state);
    state.before = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      account.email,
    );
    expect(
      state.before.messageIds.length,
      "owned mailbox starts without mail",
    ).toBe(0);
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const pending = captureResponse(owned, "/v1/auth/register");
    const { response, code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      account,
      "/account",
    );
    const captured = await pending;
    state.code = code;
    expect(response.status(), "real owned registration accepted").toBe(200);
    expect(
      registrationEvidence(
        captured.response.request().postData() ?? "",
        captured.body,
        account,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    expect(
      new URL(owned.url()).searchParams.get("email") === state.email,
      "the requesting code step retains the owned address",
    ).toBe(true);
    expect(new URL(owned.url()).searchParams.get("returnTo")).toBe("/account");
    expect(
      (await owned
        .locator('input[autocomplete="one-time-code"]')
        .inputValue()) === "",
      "the delivered code has not been entered",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(
      owned,
      (await captured.response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

When(
  "the real BFF verification mail arrives for that owned Academy registration",
  async ({ page, world }) => {
    const state = registration(page);
    state.mail = await fetchRecoveryMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.requestedAt,
      "register",
    );
    expect(
      state.mail.code === state.code,
      "the strict fresh addressed artifact carries the registration code",
    ).toBe(true);
    // returnCode and the IdP's no-native-send mechanism retain their native
    // ownership in apps/api/test/auth/zitadel-email-verify.e2e-spec.ts:192.
    // This browser observes actual mail, not provider HTTP or internal SMTP.
  },
);

Then(
  "exactly one email of any purpose is addressed to that owned registrant over the full delivery horizon",
  async ({ page, world }) => {
    const state = registration(page);
    if (!state.before)
      throw new Error("Pre-registration mail checkpoint is missing");
    const base =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const delivered = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      base,
      state.email,
    );
    const beforeIds = new Set(state.before.messageIds);
    expect(
      delivered.messageIds.filter((id) => !beforeIds.has(id)).length === 1 &&
        new Set(delivered.messageIds).size === delivered.messageIds.length,
      "exactly one addressed delivery was added since the pre-registration checkpoint",
    ).toBe(true);
    // The checkpoint includes the actual delivery. No purpose filter may hide
    // a second IdP email; the shared helper's final query starts after all 15s.
    await assertNoAddressedMail(
      nativeRecoveryMail(),
      base,
      state.email,
      state.requestedAt,
      delivered,
    );
    await test.info().attach("verification-mail-checkpoint", {
      body: JSON.stringify({
        baselineMessageIds: state.before.messageIds,
        deliveredMessageIds: delivered.messageIds,
        oneAddressedDelivery: true,
        fullAbsenceHorizonObserved: true,
      }),
      contentType: "application/json",
    });
  },
);

Then(
  "the delivered BFF verification email is branded with a leading six-digit subject code and that code in both bodies",
  async ({ page }) => {
    const { mail } = registration(page);
    if (!mail) throw new Error("Fresh verification artifact was not observed");
    // fetchRecoveryMail derives code from the entire prefix of the matching
    // subject's exact verification-purpose tail, so sixDigits proves the lead.
    expect(
      {
        leadingSixDigits: /^\d{6}$/.test(mail.code),
        sameCodeInBothBodies:
          typeof mail.text === "string" &&
          mail.text.includes(mail.code) &&
          typeof mail.html === "string" &&
          mail.html.includes(`<strong>${mail.code}</strong>`),
        brandedBodies:
          typeof mail.text === "string" &&
          mail.text.includes("Doctor.School") &&
          typeof mail.html === "string" &&
          mail.html.includes("Doctor.School"),
      },
      "same leading subject token in the real branded HTML and plain text",
    ).toEqual({
      leadingSixDigits: true,
      sameCodeInBothBodies: true,
      brandedBodies: true,
    });
  },
);

Then(
  "the delivered verification email has no link, button or navigation URL in any block including its footer",
  async ({ page }) => {
    const { mail } = registration(page);
    if (!mail) throw new Error("Fresh verification artifact was not observed");
    const navigationUrl =
      /[a-z][a-z0-9+.-]*:\/\/|(?:mailto|tel|sms|javascript|data):|www\.|(?:^|[\s"'(>])\/{1,2}[a-z0-9][^\s<]*/i;
    expect(
      typeof mail.text === "string" &&
        typeof mail.html === "string" &&
        !navigationUrl.test(mail.text) &&
        !navigationUrl.test(mail.html) &&
        !/<a\b|<button\b|\bhref\s*=/i.test(mail.html),
      "the complete delivered bodies, footer included, contain no navigation",
    ).toBe(true);
  },
);

Then(
  "its HTML and plain text show the same real code, one-hour expiry and requesting-tab instruction",
  async ({ page }) => {
    const { mail } = registration(page);
    if (!mail) throw new Error("Fresh verification artifact was not observed");
    // 003 design §13.3; VERIFY_EMAIL_CODE is 3600s. This checks the received
    // expiry against that actual purpose, without an artificial one-hour wait.
    for (const body of [mail.text, mail.html]) {
      expect(
        {
          sameCode: typeof body === "string" && body.includes(mail.code),
          actualPurposeExpiry:
            typeof body === "string" &&
            /Код действует\s+1\s+час[.\s<]/u.test(body),
          requestingTabInstruction:
            typeof body === "string" &&
            body.includes("Введите код") &&
            /уже\s+открытой\s+вкладке/u.test(body) &&
            /где\s+вы\s+его\s+запросили/u.test(body),
        },
        "each real body states the code, 3600-second lifetime and requesting tab",
      ).toEqual({
        sameCode: true,
        actualPurposeExpiry: true,
        requestingTabInstruction: true,
      });
    }
  },
);

When(
  "the registrant rejects a different code and enters that delivered verification code once in the same Academy tab",
  async ({ page }) => {
    const state = registration(page);
    if (!state.code) throw new Error("The real verification code is missing");
    const codeField = state.page.locator('input[autocomplete="one-time-code"]');
    const wrong = differentVerificationCode(state.code);
    const refusalPending = captureResponse(state.page, "/v1/auth/verify");
    await inputSecret(codeField, wrong);
    const rejected = await refusalPending;
    expect(rejected.response.status(), "different code refused").toBe(400);
    expect(
      verificationRefusalEvidence(
        rejected.response.request().postData() ?? "",
        rejected.body,
        state,
        state.code,
        wrong,
      ),
    ).toEqual({
      credentialsMatch: true,
      wrongCode: true,
      refusalMatches: true,
    });
    await expect(
      state.page.getByRole("alert").filter({
        hasText: "Код не подошёл. Проверьте его или запросите новый.",
      }),
    ).toBeVisible();
    expect(new URL(state.page.url()).pathname).toBe("/verify");
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await rejected.response.headerValue("set-cookie")) ?? "",
      state,
    );
    await inputSecret(codeField, "");
    expect(
      (await codeField.inputValue()) === "",
      "registrant clears refused digits before entering the delivered code",
    ).toBe(true);
    const acceptedPending = captureResponse(state.page, "/v1/auth/verify");
    await inputSecret(codeField, state.code);
    state.accepted = await acceptedPending;
    expect(state.accepted.response.status(), "delivered code accepted").toBe(
      200,
    );
    expect(
      verificationEvidence(
        state.accepted.response.request().postData() ?? "",
        state.accepted.body,
        state,
        state.code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
  },
);

Then(
  "only that delivered code opens the same email-verified owned Academy account with a secure BFF session and the account return target",
  async ({ page, world }) => {
    const state = registration(page);
    if (!state.accepted) throw new Error("The delivered code was not accepted");
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(
      state.page,
      state.accepted.response,
      world.hostBaseUrl,
    );
    expect(
      await state.page.evaluate(async (email) => {
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        const body = await profile.json().catch(() => ({}));
        const session = await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        const claims = await session.json().catch(() => ({}));
        return {
          profileStatus: profile.status,
          sameOwnedEmail: body.email === email,
          emailVerified: body.emailVerified === true,
          sessionStatus: session.status,
          hasSubject: typeof claims.sub === "string" && claims.sub.length > 0,
        };
      }, state.email),
      "private reads identify the same verified owned registrant",
    ).toEqual({
      profileStatus: 200,
      sameOwnedEmail: true,
      emailVerified: true,
      sessionStatus: 200,
      hasSubject: true,
    });
    expect(
      state.authPosts,
      "one registration, one refusal and one accepted code; no sign-in replay",
    ).toEqual(["/v1/auth/register", "/v1/auth/verify", "/v1/auth/verify"]);
  },
);

After("@verification-mail", async ({ page }) => {
  const state = registrations.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const revoked = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(revoked, "owned verification session revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
    await state.context.close();
    registrations.delete(page);
  }
});
