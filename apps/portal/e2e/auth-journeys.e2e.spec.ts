import { test, expect, type Page } from "@playwright/test";
import { fetchOtpCode } from "./support/mailpit";

/**
 * Portal auth browser-E2E (#131 DoD) — the REAL-Zitadel tier (NOT FakeIdpClient).
 * Drives a real browser through the portal's auth journeys end to end against a
 * running portal that proxies same-origin to a running api + Postgres + Zitadel +
 * Mailpit dev-stand. This is the milestone-completing proof that feature 003's
 * BFF is reachable as a working browser journey.
 *
 * Gating — mirrors `apps/api/test/auth/zitadel-otp-login.e2e-spec.ts` exactly:
 * the whole suite `test.skip()`s unless the dev-stand OIDC env is present
 * (`IDP_ISSUER` + `IDP_CLIENT_ID` + `IDP_SERVICE_TOKEN` + `IDP_REDIRECT_URI`) AND
 * a portal base URL (`E2E_PORTAL_URL`) is set. Those env vars are NOT in turbo
 * `passThroughEnv` and this suite is NOT wired into CI or `pnpm test`, so in CI it
 * simply does not run. Codes are read from REAL Mailpit — never hardcoded.
 *
 * No-token invariant (EARS-8): after a successful login the ONLY auth cookie is
 * `__Host-ds_session` and no access/refresh token is reachable from
 * `document.cookie` / `localStorage` / `sessionStorage`. Asserted in both journeys.
 */

const LIVE_OIDC =
  !!process.env.IDP_ISSUER &&
  !!process.env.IDP_CLIENT_ID &&
  !!process.env.IDP_SERVICE_TOKEN &&
  !!process.env.IDP_REDIRECT_URI &&
  !!process.env.E2E_PORTAL_URL;

const SESSION_COOKIE = "__Host-ds_session";

/** A password satisfying the `@ds/schemas` creation baseline (#147). */
const livePassword = (): string => `Prt-${Date.now()}-aA1!`;

const newEmail = (): string =>
  `e2e-131-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;

/**
 * Assert the EARS-8 no-token invariant from the live browser: the auth identity
 * is carried ONLY by the `__Host-ds_session` cookie (HttpOnly — invisible to JS),
 * and nothing token-shaped is reachable from any client-readable store.
 */
async function assertNoTokenInClient(page: Page): Promise<void> {
  // HttpOnly cookies are absent from document.cookie; the session must not appear.
  const clientCookie = await page.evaluate(() => document.cookie);
  expect(clientCookie).not.toContain(SESSION_COOKIE);

  // No access/refresh material anywhere a script could read it.
  const storage = await page.evaluate(() => ({
    local: JSON.stringify(window.localStorage),
    session: JSON.stringify(window.sessionStorage),
    cookie: document.cookie,
  }));
  const blob = `${storage.local}\n${storage.session}\n${storage.cookie}`;
  expect(blob).not.toMatch(/access[_-]?token/i);
  expect(blob).not.toMatch(/refresh[_-]?token/i);
  // A JWT is three base64url segments dot-separated — none should be present.
  expect(blob).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);

  // The session cookie DOES exist server-side (HttpOnly) — confirm via the
  // browser context, where HttpOnly cookies are visible to the test harness.
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === SESSION_COOKIE);
  expect(session, "session cookie must be set").toBeTruthy();
  expect(session!.httpOnly, "session cookie must be HttpOnly").toBe(true);
}

test.describe("portal auth journeys (real Zitadel)", () => {
  test.skip(
    !LIVE_OIDC,
    "dev-stand env absent (IDP_* + E2E_PORTAL_URL) — manual gate, skipped in CI",
  );

  test("password: register → verify → login → session → logout", async ({
    page,
  }) => {
    const email = newEmail();
    const password = livePassword();

    // ── Register (EARS-1) ────────────────────────────────────────────────
    await page.goto("/register");
    const sentAt = new Date().toISOString();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    // The portal routes to /verify carrying the identifier on the pending ack.
    await page.waitForURL(/\/verify/);

    // ── Verify (EARS-3) — read the real code from Mailpit ────────────────
    const verifyCode = await fetchOtpCode(email, sentAt);
    expect(verifyCode, "registration code should reach Mailpit").toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(verifyCode!);
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.waitForURL(/\/login/);

    // ── Login with password (EARS-5/8) ───────────────────────────────────
    await page
      .getByRole("form", { name: "Password sign-in" })
      .getByLabel("Email or phone")
      .fill(email);
    await page
      .getByRole("form", { name: "Password sign-in" })
      .getByLabel("Password")
      .fill(password);
    await page
      .getByRole("form", { name: "Password sign-in" })
      .getByRole("button", { name: "Sign in" })
      .click();

    // ── Session visible (EARS-8 read side) ───────────────────────────────
    await page.waitForURL(/\/account/);
    await expect(page.getByTestId("session-sub")).not.toBeEmpty();
    await assertNoTokenInClient(page);

    // ── Logout (EARS-10) ─────────────────────────────────────────────────
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    const after = await page.context().cookies();
    expect(after.find((c) => c.name === SESSION_COOKIE)?.value || "").toBe("");
  });

  test("email-OTP: register+verify → request code → login → session", async ({
    page,
  }) => {
    const email = newEmail();
    const password = livePassword();

    // The account must exist+be verified before an OTP login challenge fires —
    // reuse the password journey's front half to provision it.
    await page.goto("/register");
    const regAt = new Date().toISOString();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/verify/);
    const verifyCode = await fetchOtpCode(email, regAt);
    expect(verifyCode).toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(verifyCode!);
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.waitForURL(/\/login/);

    // ── Request an email OTP (EARS-6 step 1) ─────────────────────────────
    const otpForm = page.getByRole("group", { name: "OTP channel" });
    await otpForm.getByRole("radio", { name: "Email code" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    const otpSentAt = new Date().toISOString();
    await page.getByRole("button", { name: "Send code" }).click();

    // ── Read the login OTP from Mailpit + submit (EARS-6 step 2 / EARS-8) ─
    const otpCode = await fetchOtpCode(email, otpSentAt);
    expect(otpCode, "login OTP should reach Mailpit").toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(otpCode!);
    await page.getByRole("button", { name: "Verify & sign in" }).click();

    await page.waitForURL(/\/account/);
    await expect(page.getByTestId("session-sub")).not.toBeEmpty();
    await assertNoTokenInClient(page);
  });

  // EARS-7 SMS-OTP: the dev-stand has NO SMS provider, so the SMS code cannot be
  // delivered or read (no Mailpit equivalent for SMS). The SMS-OTP UI IS built
  // (the channel selector + request/verify forms on /login), but a live round-trip
  // is impossible here — declared as a parity-only skip exactly like the api spec.
  // NOT faked green; live-verifiable only once a real SMS provider is configured.
  test.skip("sms-OTP: parity-only — no SMS provider on the dev-stand", () => {
    // Intentionally skipped — see the comment block above and the api EARS-7 skip.
  });
});
