import {
  expect,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";

import { goldenDoctorPassword, resolveGoldenDoctor } from "../lib/golden.js";
import { fetchLoginCode, mailpitUrlFor } from "../lib/mailpit.js";
import { signInGoldenDoctor } from "../lib/sign-in.js";
import { Given, Then, When } from "./support/fixtures.js";

const SEED = "verified-cardiologist";
const SESSION_COOKIE = "__Host-ds_session";
const GENERIC_PASSWORD_ERROR =
  "Не удалось войти. Проверьте данные и попробуйте снова.";
const loginResponses = new WeakMap<Page, Response>();
const otpRequestResponses = new WeakMap<Page, Response>();
const otpLoginResponses = new WeakMap<Page, Response>();
const refusedLoginResponses = new WeakMap<Page, Response>();
type SessionCookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];
const preLogoutCookies = new WeakMap<Page, SessionCookie>();
const logoutResponses = new WeakMap<Page, Response>();

Given(
  'the golden doctor "verified-cardiologist" is available for password sign-in',
  async () => {
    // Resolve the named seeded identity and require its provisioned IdP password.
    goldenDoctorPassword(resolveGoldenDoctor(SEED));
  },
);

Given(
  'the golden doctor "verified-cardiologist" has a verified email for code sign-in',
  async () => {
    expect(resolveGoldenDoctor(SEED).email).toBeTruthy();
  },
);

When(
  "that doctor requests an email login code and submits the delivered code through Academy",
  async ({ page, request, world }) => {
    expect(world.host.id).toBe("academy");
    const doctor = resolveGoldenDoctor(SEED);
    await page.goto(`${world.hostBaseUrl}${world.host.loginPath}`, {
      waitUntil: "load",
    });
    await page.waitForLoadState("networkidle");
    await page.getByTestId("login-method-otp").click();
    await page.getByTestId("otp-channel-email").click();
    await page.getByTestId("otp-identifier").fill(doctor.email);
    const requestedAt = new Date().toISOString();
    const requestResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/login/otp/request" &&
        response.request().method() === "POST",
    );
    await page.getByTestId("otp-send").click();
    otpRequestResponses.set(page, await requestResponse);
    const code = await fetchLoginCode(
      request,
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      doctor.email,
      requestedAt,
    );
    const loginResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/login/otp" &&
        response.request().method() === "POST",
    );
    // The eighth digit auto-submits the shipped OTP form.
    await page.locator('input[autocomplete="one-time-code"]').fill(code);
    otpLoginResponses.set(page, await loginResponse);
    world.signedInAs = doctor.seedName;
  },
);

Then(
  "the email-code login succeeds and opens the authenticated webinar listing",
  async ({ page }) => {
    expect(otpRequestResponses.get(page)?.ok(), "code request succeeded").toBe(
      true,
    );
    expect(
      otpLoginResponses.get(page)?.ok(),
      "delivered code was accepted",
    ).toBe(true);
    await expect(page).toHaveURL(/\/webinars(?:\?|$)/);
    await expect(page.getByTestId("storefront-header")).toBeVisible();
  },
);

When(
  "that doctor signs in through the Academy password form",
  async ({ page, world }) => {
    expect(world.host.id).toBe("academy");
    const loginResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/login" &&
        response.request().method() === "POST",
    );
    const doctor = await signInGoldenDoctor(page, world.host, SEED);
    world.signedInAs = doctor.seedName;
    loginResponses.set(page, await loginResponse);
  },
);

Then(
  "the Academy opens the authenticated webinar listing",
  async ({ page }) => {
    expect(new URL(page.url()).pathname).toBe("/webinars");
    await expect(page.getByTestId("storefront-header")).toBeVisible();
  },
);

Then(
  "the doctor's own profile is readable through the BFF",
  async ({ page, world }) => {
    const doctor = resolveGoldenDoctor(world.signedInAs ?? "");
    // The BFF binds the session to the browser fingerprint. A Playwright API
    // request does not carry that fingerprint even when its cookie jar is shared.
    const profileResponse = await page.evaluate(async () => {
      const response = await fetch("/v1/me/profile", {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      return { status: response.status, body: await response.json() };
    });
    expect(profileResponse.status, "authenticated self-profile read").toBe(200);
    expect(profileResponse.body).toMatchObject({ email: doctor.email });
    await page.goto(`${world.hostBaseUrl}/account`);
    await expect(page.getByTestId("profile-email")).toHaveText(doctor.email);
  },
);

Then(
  "the browser holds a host-only __Host-ds_session cookie with HttpOnly, Secure, and SameSite=Lax",
  async ({ page }) => {
    const response = loginResponses.get(page) ?? otpLoginResponses.get(page);
    expect(response, "login response was captured").toBeDefined();
    expect(response!.ok(), "login succeeded").toBe(true);
    const setCookie = await response!.headerValue("set-cookie");
    expect(setCookie, "login sets the BFF session cookie").toContain(
      `${SESSION_COOKIE}=`,
    );
    expect(setCookie).not.toMatch(/(?:^|;)\s*Domain=/i);
    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
    expect(session, "private session cookie exists").toBeDefined();
    expect(session!.domain).toBe(new URL(page.url()).hostname);
    expect(session!).toMatchObject({
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
  },
);

Then(
  "neither the login response nor JavaScript-readable browser stores expose access or refresh tokens",
  async ({ page }) => {
    const response = loginResponses.get(page) ?? otpLoginResponses.get(page);
    expect(response, "login response was captured").toBeDefined();
    const loginBody = await response!.text();
    expect(loginBody).not.toMatch(/access[_-]?token|refresh[_-]?token/i);
    expect(loginBody).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
    const clientState = await page.evaluate(() => ({
      cookie: document.cookie,
      local: Object.entries(window.localStorage),
      session: Object.entries(window.sessionStorage),
    }));
    expect(clientState.cookie).not.toContain(SESSION_COOKIE);
    const readable = JSON.stringify(clientState);
    expect(readable).not.toMatch(/access[_-]?token|refresh[_-]?token/i);
    expect(readable).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  },
);

When(
  "that doctor submits a wrong password through the Academy password form",
  async ({ page, world }) => {
    expect(world.host.id).toBe("academy");
    const doctor = resolveGoldenDoctor(SEED);
    await page.goto(`${world.hostBaseUrl}${world.host.loginPath}`, {
      waitUntil: "load",
    });
    await page.waitForLoadState("networkidle");
    await page.locator('input[autocomplete="username"]').fill(doctor.email);
    await page
      .locator('input[autocomplete="current-password"]')
      .fill("wrong-password-for-staging-2431");
    const loginResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/login" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Войти|Продолжить/i }).click();
    refusedLoginResponses.set(page, await loginResponse);
  },
);

Then(
  "the Academy shows the generic password sign-in error",
  async ({ page, world }) => {
    const response = refusedLoginResponses.get(page);
    expect(
      response,
      "wrong-password login response was captured",
    ).toBeDefined();
    expect(response!.status()).toBe(401);
    await expect(page).toHaveURL(
      new RegExp(`${world.host.loginPath}(?:\\?|$)`),
    );
    await expect(
      page.getByRole("alert").filter({ hasText: GENERIC_PASSWORD_ERROR }),
    ).toBeVisible();
  },
);

Then("the refused login sets no BFF session cookie", async ({ page }) => {
  const response = refusedLoginResponses.get(page);
  expect(response, "wrong-password login response was captured").toBeDefined();
  expect((await response!.headerValue("set-cookie")) ?? "").not.toContain(
    `${SESSION_COOKIE}=`,
  );
  expect(await page.context().cookies()).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: SESSION_COOKIE })]),
  );
});

Then(
  "the doctor's private profile is not readable through the BFF",
  async ({ page }) => {
    // Use the browser's own origin and fingerprint, as the positive read does.
    const status = await page.evaluate(async () => {
      const response = await fetch("/v1/me/profile", {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      return response.status;
    });
    expect(status).toBe(401);
  },
);

Given(
  "the doctor has an active Academy profile and session cookie",
  async ({ page, world }) => {
    expect(world.host.id).toBe("academy");
    await page.goto(`${world.hostBaseUrl}/account`);
    await expect(page.getByTestId("profile-email")).toHaveText(
      resolveGoldenDoctor(world.signedInAs ?? "").email,
    );
    const session = (await page.context().cookies()).find(
      (cookie) => cookie.name === SESSION_COOKIE,
    );
    expect(session, "active BFF session cookie before logout").toBeDefined();
    preLogoutCookies.set(page, session!);
  },
);

When("the doctor logs out from the Academy account", async ({ page }) => {
  const logoutResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/auth/logout" &&
      response.request().method() === "POST",
  );
  await page.getByTestId("logout").click();
  logoutResponses.set(page, await logoutResponse);
});

Then("the Academy returns to the sign-in page", async ({ page, world }) => {
  expect(logoutResponses.get(page)?.status(), "logout succeeded").toBe(200);
  await expect(page).toHaveURL(new RegExp(`${world.host.loginPath}(?:\\?|$)`));
});

Then(
  "the logout response clears the __Host-ds_session cookie",
  async ({ page }) => {
    const response = logoutResponses.get(page);
    expect(response, "logout response was captured").toBeDefined();
    const setCookie = await response!.headerValue("set-cookie");
    expect(setCookie, "BFF sends an expired session cookie").toContain(
      `${SESSION_COOKIE}=`,
    );
    expect(setCookie).toMatch(/(?:^|;)\s*Max-Age=0(?:;|$)/i);
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === SESSION_COOKIE,
      ),
    ).toBe(false);
  },
);

Then(
  "the old session cookie cannot read the doctor's private profile",
  async ({ page }) => {
    const oldCookie = preLogoutCookies.get(page);
    expect(oldCookie, "pre-logout cookie was captured").toBeDefined();
    // Reinsert the original cookie into the same browser context, retaining its
    // user agent and fingerprint. A mere browser cookie clear would still leave
    // the profile readable; 401 also proves the server revoked this session.
    await page.context().addCookies([oldCookie!]);
    try {
      const status = await page.evaluate(async () => {
        const response = await fetch("/v1/me/profile", {
          headers: { accept: "application/json" },
          credentials: "include",
        });
        return response.status;
      });
      expect(status, "the original session must be revoked server-side").toBe(
        401,
      );
    } finally {
      await page.context().clearCookies();
    }
  },
);
