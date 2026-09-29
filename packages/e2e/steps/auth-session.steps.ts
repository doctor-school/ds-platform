import { expect, type Page, type Response } from "@playwright/test";

import { goldenDoctorPassword, resolveGoldenDoctor } from "../lib/golden.js";
import { signInGoldenDoctor } from "../lib/sign-in.js";
import { Given, Then, When } from "./support/fixtures.js";

const SEED = "verified-cardiologist";
const SESSION_COOKIE = "__Host-ds_session";
const loginResponses = new WeakMap<Page, Response>();

Given(
  'the golden doctor "verified-cardiologist" is available for password sign-in',
  async () => {
    // Resolve the named seeded identity and require its provisioned IdP password.
    goldenDoctorPassword(resolveGoldenDoctor(SEED));
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
    const response = loginResponses.get(page);
    expect(response, "password login response was captured").toBeDefined();
    expect(response!.ok(), "password login succeeded").toBe(true);
    const setCookie = await response!.headerValue("set-cookie");
    expect(setCookie, "password login sets the BFF session cookie").toContain(
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
    const response = loginResponses.get(page);
    expect(response, "password login response was captured").toBeDefined();
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
