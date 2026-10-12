import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface RequestObservation {
  requestedAt: string;
  status: number;
  neutralBody: boolean;
  setCookie: string;
  controls: {
    codeLength: string | null;
    inputMode: string | null;
    codeLabel: string;
    submitLabel: string;
    backLabel: string;
    resendDisabled: boolean;
  };
}

interface SilentLoginRequest extends OwnedCredentials {
  contexts: BrowserContext[];
  existing: Page;
  visitor?: Page;
  unknownEmail: string;
  references: RequestObservation[];
  unknown?: RequestObservation;
}

const requests = new WeakMap<Page, SilentLoginRequest>();

function silentRequest(key: Page): SilentLoginRequest {
  const state = requests.get(key);
  if (!state) throw new Error("Owned login-code comparison was not prepared");
  return state;
}

function statusOnlyBody(body: string, status: string): boolean {
  try {
    const value: unknown = JSON.parse(body);
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      "status" in value &&
      value.status === status
    );
  } catch {
    return false;
  }
}

async function requestThroughAcademy(
  page: Page,
  base: string,
  email: string,
): Promise<RequestObservation> {
  const door = new URL("/login", base);
  door.searchParams.set("method", "code");
  door.searchParams.set("returnTo", "/account");
  await page.goto(door.toString(), { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("login-method-otp")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByTestId("otp-channel-email").click();
  await inputSecret(page.getByTestId("otp-identifier"), email);
  const requestedAt = new Date().toISOString();
  const pending = captureResponse(page, "/v1/auth/login/otp/request");
  await page.getByTestId("otp-send").click();
  const captured = await pending;
  const code = page.locator('input[autocomplete="one-time-code"]');
  await expect(code).toBeVisible();
  await expect(code).toHaveAttribute("maxlength", "6");
  await expect(code).toHaveAttribute("inputmode", "numeric");
  expect((await code.inputValue()) === "", "code is not submitted").toBe(true);
  await expect(page.getByTestId("otp-verify")).toBeVisible();
  await expect(page.getByTestId("otp-change-method")).toBeVisible();
  await expect(page.getByTestId("otp-change-method")).toBeEnabled();
  await expect(page.getByTestId("otp-resend")).toBeVisible();
  await expect(page.getByTestId("otp-identifier")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  return {
    requestedAt,
    status: captured.response.status(),
    neutralBody: statusOnlyBody(captured.body, "otp_sent"),
    setCookie: (await captured.response.headerValue("set-cookie")) ?? "",
    controls: {
      codeLength: await code.getAttribute("maxlength"),
      inputMode: await code.getAttribute("inputmode"),
      codeLabel: await page.locator("label").innerText(),
      submitLabel: await page.getByTestId("otp-verify").innerText(),
      backLabel: await page.getByTestId("otp-change-method").innerText(),
      resendDisabled: await page.getByTestId("otp-resend").isDisabled(),
    },
  };
}

Given(
  "a unique unknown Academy address and owned unverified and verified login-code observations",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: SilentLoginRequest = {
      contexts: [context],
      existing: owned,
      email: `login-existing-2795-${randomUUID()}@example.test`,
      password: `Login-${randomUUID()}-aA1!`,
      unknownEmail: `login-unknown-2795-${randomUUID()}@example.test`,
      references: [],
    };
    requests.set(page, state);
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const registered = captureResponse(owned, "/v1/auth/register");
    await registerOwnedCredentials(owned, world.hostBaseUrl, state);
    const registration = await registered;
    expect(
      registrationEvidence(
        registration.response.request().postData() ?? "",
        registration.body,
        state,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    await assertNoPrivateRegistrationAccess(
      owned,
      (await registration.response.headerValue("set-cookie")) ?? "",
      state,
    );
    const mailpit =
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl);
    const unverified = await requestThroughAcademy(
      owned,
      world.hostBaseUrl,
      state.email,
    );
    state.references.push(unverified);
    await assertNoPrivateRegistrationAccess(owned, unverified.setCookie, state);
    const code = await fetchRecoveryCode(
      nativeRecoveryMail(),
      mailpit,
      state.email,
      unverified.requestedAt,
      "login",
    );
    const accepted = captureResponse(owned, "/v1/auth/login/otp");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const login = await accepted;
    expect(login.response.status(), "owned mailbox code accepted").toBe(200);
    expect(
      statusOnlyBody(login.body, "authenticated"),
      "accepted code has a token-free acknowledgement",
    ).toBe(true);
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(owned, login.response, world.hostBaseUrl);
    const verifiedProfile = await owned.evaluate(async (email) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await response.json().catch(() => ({}));
      return {
        status: response.status,
        sameAccount: profile.email === email,
        emailVerified: profile.emailVerified === true,
      };
    }, state.email);
    expect(verifiedProfile, "owned reference is now verified").toEqual({
      status: 200,
      sameAccount: true,
      emailVerified: true,
    });
    const logout = captureResponse(owned, "/v1/auth/logout");
    await owned.getByTestId("logout").click();
    expect((await logout).response.status(), "owned session revoked").toBe(200);
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/",
    );
    const verified = await requestThroughAcademy(
      owned,
      world.hostBaseUrl,
      state.email,
    );
    state.references.push(verified);
    await assertNoPrivateRegistrationAccess(owned, verified.setCookie, state);
    // Positive delivery in both account states prevents a dead inbox proving absence.
    await fetchRecoveryCode(
      nativeRecoveryMail(),
      mailpit,
      state.email,
      verified.requestedAt,
      "login",
    );
    const visitorContext = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    state.contexts.push(visitorContext);
    state.visitor = await visitorContext.newPage();
    await prepareCaptchaForJourney(
      visitorContext,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
  },
);

When(
  "the fresh Academy visitor requests an email login code for the unique unknown address",
  async ({ page, world }) => {
    const state = silentRequest(page);
    if (!state.visitor)
      throw new Error("Fresh unknown-address visitor is absent");
    state.unknown = await requestThroughAcademy(
      state.visitor,
      world.hostBaseUrl,
      state.unknownEmail,
    );
  },
);

Then(
  "the unknown request matches both owned account states in neutral status, body, and six-digit code-entry controls",
  async ({ page }) => {
    const state = silentRequest(page);
    expect(
      state.references.length,
      "both existing account states captured",
    ).toBe(2);
    if (!state.unknown) throw new Error("Unknown login-code request is absent");
    for (const observation of [...state.references, state.unknown]) {
      expect({
        status: observation.status,
        neutralBody: observation.neutralBody,
      }).toEqual({ status: 200, neutralBody: true });
      expect(observation.controls).toEqual(state.references[0]!.controls);
    }
  },
);

Then(
  "no mail reaches the unique unknown address throughout the full 15-second delivery window",
  async ({ page, world }) => {
    const state = silentRequest(page);
    if (!state.unknown) throw new Error("Unknown login-code request is absent");
    await assertNoAddressedMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.unknownEmail,
      state.unknown.requestedAt,
    );
  },
);

Then(
  "the unknown code request grants no private browser session or profile access",
  async ({ page }) => {
    const state = silentRequest(page);
    if (!state.visitor || !state.unknown)
      throw new Error("Unknown login-code request is absent");
    await assertNoPrivateRegistrationAccess(
      state.visitor,
      state.unknown.setCookie,
      state,
    );
    expect(
      await state.visitor.evaluate(
        async () =>
          (await fetch("/v1/auth/session", { credentials: "include" })).status,
      ),
      "unknown request creates no private principal",
    ).toBe(401);
  },
);

After("@login-email-nonexistent", async ({ page }) => {
  const state = requests.get(page);
  if (!state) return;
  try {
    if (
      (await state.existing.context().cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const revoked = await state.existing.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(revoked, "owned comparison session revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    for (const context of state.contexts) {
      await Promise.all(context.pages().map((owned) => owned.close()));
      await context.close();
    }
    requests.delete(page);
  }
});
