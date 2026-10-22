import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import {
  captchaStubScript,
  captchaTestTokenFromEnv,
  isSmartCaptchaScriptUrl,
} from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
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
  registrationEvidence,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import {
  captureSmsCheckpoint,
  freshConfirmablePhone,
  resetSmsCode,
  RESET_CODE_EVENT,
  smsSinkUrl,
  waitForSmsCode,
  type SinkContent,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

type Kind =
  "verification" | "email-otp" | "sms-otp" | "email-reset" | "sms-reset";
interface Visitor extends OwnedCredentials {
  kind: Kind;
  purpose: "confirmation" | "resend";
  context: BrowserContext;
  page: Page;
  phone: string;
  code: string;
  tokens: string[];
  confirmationChecks?: number;
  resendChecks?: number;
  confirmation?: { status: number; body: boolean; tokenAbsent: boolean };
  resent?: {
    status: number;
    acknowledgement: boolean;
    fresh: boolean;
    exactCheck: boolean;
  };
}
const journeys = new WeakMap<Page, Visitor[]>();
function visitors(page: Page) {
  const state = journeys.get(page);
  if (!state) throw new Error("S066 owned confirmation visitors absent");
  return state;
}
function selectedVisitors(page: Page, purpose: Visitor["purpose"]) {
  return visitors(page).filter((visitor) => visitor.purpose === purpose);
}
function diagnostic(v: Visitor, path: string, phase: string) {
  return `S066 ${v.purpose}/${v.kind} ${phase} ${path}`;
}
function reset(v: Visitor) {
  return v.kind.endsWith("reset");
}
function sms(v: Visitor) {
  return v.kind.startsWith("sms");
}
function requestPath(v: Visitor) {
  return v.kind === "verification"
    ? "/v1/auth/verify/resend"
    : reset(v)
      ? "/v1/auth/password/reset"
      : "/v1/auth/login/otp/request";
}
function acknowledgement(v: Visitor, body: string) {
  const status =
    v.kind === "verification"
      ? "resend_requested"
      : reset(v)
        ? "reset_requested"
        : "otp_sent";
  return body === JSON.stringify({ status });
}
function confirmationPath(v: Visitor) {
  return v.kind === "verification"
    ? "/v1/auth/verify"
    : reset(v)
      ? "/v1/auth/password/reset/complete"
      : "/v1/auth/login/otp";
}
function resendId(v: Visitor) {
  return v.kind === "verification"
    ? "verify-resend"
    : reset(v)
      ? "reset-resend"
      : "otp-resend";
}
async function open(page: Page, target: string) {
  await page.goto(target, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}
async function instrument(v: Visitor) {
  // 003 EARS-17: BOTOFF proves distinct frontend token bytes; BOTON uses the
  // supported fixed provider test token and proves distinct execution revisions.
  await v.context.exposeBinding("__s066Issued", (_source, token: string) => {
    v.tokens.push(token);
  });
  await v.context.route(isSmartCaptchaScriptUrl, async (route) => {
    const onload =
      new URL(route.request().url()).searchParams.get("onload") ??
      "__onSmartCaptchaReady";
    const bypass = process.env.BOT_PROTECTION_ENABLED === "false";
    const script = captchaStubScript(
      bypass ? "s066" : captchaTestTokenFromEnv(),
      onload,
    ).replace(
      "w.response = TOKEN;",
      `${bypass ? 'TOKEN = "s066-" + crypto.randomUUID(); ' : ""}window.__s066Issued(TOKEN); w.response = TOKEN;`,
    );
    if (!script.includes("window.__s066Issued(TOKEN)"))
      throw new Error("S066 provider instrumentation did not bind");
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: script,
    });
  });
}
async function logout(v: Visitor) {
  if (!(await v.context.cookies()).some((c) => c.name === "__Host-ds_session"))
    return;
  const result = await v.page.evaluate(async () => {
    const out = await fetch("/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    const session = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    return { logout: out.status, session: session.status };
  });
  expect(result, "exact owned S066 session revoked").toEqual({
    logout: 200,
    session: 401,
  });
  expect(
    (await v.context.cookies()).some((c) => c.name === "__Host-ds_session"),
  ).toBe(false);
}
async function requestCode(v: Visitor, base: string, loginPath: string) {
  const mailpit = process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base);
  const mail = await captureAddressedMailCheckpoint(
    nativeRecoveryMail(),
    mailpit,
    v.email,
  );
  const sink = smsSinkUrl();
  const beforeSms =
    sms(v) && sink ? await captureSmsCheckpoint(sink, v.phone) : undefined;
  await open(
    v.page,
    reset(v)
      ? `${base}/reset?returnTo=%2Faccount`
      : `${base}${loginPath}?returnTo=%2Faccount`,
  );
  if (reset(v))
    await inputSecret(
      v.page.locator('input[autocomplete="username"]'),
      sms(v) ? v.phone : v.email,
    );
  else {
    await v.page.getByTestId("login-method-otp").click();
    await v.page
      .getByTestId(sms(v) ? "otp-channel-sms" : "otp-channel-email")
      .click();
    await inputSecret(
      v.page.getByTestId("otp-identifier"),
      sms(v) ? v.phone : v.email,
    );
  }
  const checks = v.tokens.length;
  const pending = captureResponse(v.page, requestPath(v));
  await v.page
    .getByTestId(reset(v) ? "reset-request-submit" : "otp-send")
    .click();
  const result = await pending;
  expect(
    {
      status: result.response.status(),
      acknowledgement: acknowledgement(v, result.body),
    },
    diagnostic(v, requestPath(v), "initial actual response"),
  ).toEqual({ status: 200, acknowledgement: true });
  await expect.poll(() => v.tokens.length).toBe(checks + 1);
  expect(
    result.response.request().headers()["x-smartcaptcha-token"] ===
      v.tokens.at(-1),
    "initial request carries its own emitted token",
  ).toBe(true);
  v.code = await deliveredCode(v, base, mail, beforeSms, "initial");
  await expect(v.page.getByTestId(resendId(v))).toBeDisabled();
}
async function deliveredCode(
  v: Visitor,
  base: string,
  mail: AddressedMailCheckpoint,
  beforeSms: SmsCheckpoint | undefined,
  phase: string,
) {
  const sink = smsSinkUrl();
  const mailpit = process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(base);
  try {
    if (sms(v)) {
      if (!sink || !beforeSms) throw new Error("S066 requires SMS sink");
      const pick = reset(v)
        ? resetSmsCode
        : (message: SinkContent) => {
            if (
              message.json?.contextInfo?.eventType !==
              "session.otp.sms.challenged"
            )
              return null;
            const args = message.json.args as
              { oTP?: unknown; code?: unknown } | undefined;
            const code = String(args?.oTP ?? args?.code ?? "");
            return /^\d{6}$/.test(code) ? code : null;
          };
      return await waitForSmsCode(
        sink,
        v.phone,
        beforeSms,
        pick,
        reset(v) ? RESET_CODE_EVENT : "session.otp.sms.challenged",
      );
    } else
      return await fetchRecoveryCode(
        nativeRecoveryMail(),
        mailpit,
        v.email,
        mail,
        v.kind === "verification" ? "register" : reset(v) ? "reset" : "login",
      );
  } catch {
    throw new Error(
      diagnostic(
        v,
        requestPath(v),
        `${phase}: no addressed delivery after accepted request`,
      ),
    );
  }
}

Given(
  "a visitor already requested a verification, login, or reset code through a protected action",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(300_000);
    expect(world.host.id).toBe("academy");
    if (process.env.BOT_PROTECTION_ENABLED !== "false")
      captchaTestTokenFromEnv();
    const state: Visitor[] = [];
    journeys.set(page, state);
    for (const purpose of ["confirmation", "resend"] as const) {
      for (const kind of [
        "verification",
        "email-otp",
        "sms-otp",
        "email-reset",
        "sms-reset",
      ] as const) {
        const context = await browser.newContext({
          locale: "ru-RU",
          ...(httpCredentials ? { httpCredentials } : {}),
        });
        const v: Visitor = {
          kind,
          purpose,
          context,
          page: await context.newPage(),
          email: `captcha-confirm-3243-${randomUUID()}@example.test`,
          password: `Owned-${randomUUID()}-aA1!`,
          phone: freshConfirmablePhone(),
          code: "",
          tokens: [],
        };
        state.push(v);
        await instrument(v);
        if (purpose === "resend") {
          await v.page.clock.install();
          const pause = await v.page.evaluate(() => Date.now() + 60_000);
          await v.page.clock.pauseAt(new Date(pause));
        }
        const registered = await registerOwnedCredentials(
          v.page,
          world.hostBaseUrl,
          v,
          "/account",
        );
        expect(
          registrationEvidence(
            registered.response.request().postData() ?? "",
            await registered.response.text(),
            v,
          ),
        ).toEqual({
          credentialsMatch: true,
          consentMatches: true,
          acknowledgementMatches: true,
        });
        v.code = registered.code;
        expect(v.tokens.length, "registration emitted a check").toBe(1);
        if (kind !== "verification") {
          const pending = captureResponse(v.page, "/v1/auth/verify");
          await inputSecret(
            v.page.locator('input[autocomplete="one-time-code"]'),
            v.code,
          );
          const accepted = await pending;
          expect(accepted.response.status()).toBe(200);
          expect(
            verificationEvidence(
              accepted.response.request().postData() ?? "",
              accepted.body,
              v,
              v.code,
            ),
          ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
          await v.page.waitForURL((url) => url.pathname === "/account");
          await v.page.waitForLoadState("networkidle");
          if (sms(v)) {
            const sink = smsSinkUrl();
            if (!sink)
              throw new Error("S066 SMS variant requires real SMS sink");
            await confirmOwnedPhone(v.page, { phone: v.phone, sink });
          }
          await logout(v);
          await requestCode(v, world.hostBaseUrl, world.host.loginPath);
        }
        v.confirmationChecks = v.tokens.length;
      }
    }
  },
);
When(
  "the visitor submits that verification code or login OTP, or completes password reset",
  async ({ page, world }) => {
    for (const v of selectedVisitors(page, "confirmation")) {
      const pending = captureResponse(v.page, confirmationPath(v));
      await inputSecret(
        v.page.locator('input[autocomplete="one-time-code"]'),
        v.code,
      );
      if (reset(v)) {
        await inputSecret(
          v.page.locator('input[autocomplete="new-password"]'),
          `Changed-${randomUUID()}-aA1!`,
        );
        await v.page.locator('form button[type="submit"]').click();
      }
      const accepted = await pending;
      const expected =
        v.kind === "verification"
          ? "verified"
          : reset(v)
            ? "reset_completed"
            : "authenticated";
      v.confirmation = {
        status: accepted.response.status(),
        body: accepted.body === JSON.stringify({ status: expected }),
        tokenAbsent: !(
          "x-smartcaptcha-token" in accepted.response.request().headers()
        ),
      };
      await v.page.waitForURL((url) => url.pathname === "/account");
      await v.page.waitForLoadState("networkidle");
      await assertSecureSession(v.page, accepted.response, world.hostBaseUrl);
      const identity = await v.page.evaluate(async (email) => {
        const response = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        return {
          status: response.status,
          sameOwner: body.email === email,
          verified: body.emailVerified === true,
        };
      }, v.email);
      expect(identity).toEqual({
        status: 200,
        sameOwner: true,
        verified: true,
      });
    }
  },
);
Then(
  "the portal sends the confirmation without requesting CAPTCHA",
  async ({ page }) => {
    for (const v of selectedVisitors(page, "confirmation")) {
      expect(
        v.confirmation,
        `${v.kind} real success without CAPTCHA header`,
      ).toEqual({ status: 200, body: true, tokenAbsent: true });
      expect(
        v.tokens.length,
        `${v.kind} confirmation executed no new invisible check`,
      ).toBe(v.confirmationChecks);
    }
  },
);
When(
  "the visitor explicitly asks to resend a code",
  async ({ page, world }) => {
    for (const v of selectedVisitors(page, "resend")) {
      const before = [...v.tokens];
      v.resendChecks = before.length;
      // 003 EARS-17: only the browser countdown advances, never API/IdP time or counters.
      for (let second = 0; second < 30; second++) {
        await v.page.clock.runFor(1000);
        await v.page.evaluate(
          () => new Promise<void>((resolve) => queueMicrotask(resolve)),
        );
      }
      const resend = v.page.getByTestId(resendId(v));
      await expect(resend).toBeEnabled();
      expect(v.tokens.length, "countdown sends no challenge").toBe(
        before.length,
      );
      const mail = await captureAddressedMailCheckpoint(
        nativeRecoveryMail(),
        process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
        v.email,
      );
      const sink = smsSinkUrl();
      const beforeSms =
        sms(v) && sink ? await captureSmsCheckpoint(sink, v.phone) : undefined;
      const pending = captureResponse(v.page, requestPath(v));
      await resend.click();
      const accepted = await pending;
      await expect.poll(() => v.tokens.length).toBe(before.length + 1);
      const token = accepted.response.request().headers()[
        "x-smartcaptcha-token"
      ];
      v.resent = {
        status: accepted.response.status(),
        acknowledgement: acknowledgement(v, accepted.body),
        fresh:
          !!token &&
          token === v.tokens.at(-1) &&
          (process.env.BOT_PROTECTION_ENABLED === "false"
            ? !before.includes(token)
            : token === captchaTestTokenFromEnv()),
        exactCheck: v.tokens.length === before.length + 1,
      };
      expect(
        v.resent,
        diagnostic(
          v,
          requestPath(v),
          "actual resend acknowledgement and token",
        ),
      ).toEqual({
        status: 200,
        acknowledgement: true,
        fresh: true,
        exactCheck: true,
      });
      await deliveredCode(v, world.hostBaseUrl, mail, beforeSms, "resend");
      // 003 EARS-17: dedicated resend journeys synchronize and assert cooldown reset;
      // S066 observes the accepted request before resuming this browser clock.
      await v.page.clock.resume();
    }
  },
);
Then(
  "the portal executes a new invisible check and uses a fresh token for that resend",
  async ({ page }) => {
    for (const v of selectedVisitors(page, "resend")) {
      expect(
        v.resent,
        `${v.kind} real resend carries exactly one fresh frontend token`,
      ).toEqual({
        status: 200,
        acknowledgement: true,
        fresh: true,
        exactCheck: true,
      });
      expect(v.tokens.length).toBe(v.resendChecks! + 1);
    }
  },
);
After("@captcha-confirmation", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  let failed = false;
  for (const v of state) {
    try {
      await logout(v);
    } catch {
      failed = true;
    } finally {
      v.code = "";
      await v.context.close().catch(() => {
        failed = true;
      });
    }
  }
  journeys.delete(page);
  if (failed) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned S066 session cleanup failed");
    test.info().annotations.push({
      type: "cleanup-failed",
      description: "Owned S066 cleanup failed; original failure retained.",
    });
  }
});
