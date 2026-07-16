import { expect, type Page } from "@playwright/test";
import { fetchOtpCode } from "./mailpit";
import { NOTIFICATION_SUBJECTS } from "./notification-subjects";

/**
 * 005 journey (#574) — browser-native 003 account provisioning. The guest-through-
 * auth deliverable (EARS-2) IS the shipped 003 register → verify → auto-login flow
 * driven in the real browser: register sends a real verify-email OTP to Mailpit
 * (the dev-stand Zitadel SMTP sink), the code is read back over the Mailpit REST
 * API (never the FakeIdpClient `424242` — this is the REAL-Zitadel tier, mirroring
 * `auth-journeys.e2e.spec.ts`), and entering it AUTO-SUBMITS (#175), auto-logging
 * the doctor in. No auth primitive is added here (005 Constraints) — the session
 * is minted the exact way 003 mints it.
 *
 * The whole journey is dev-stand-gated: `LIVE_STAND` is false unless a running
 * portal (`E2E_PORTAL_URL`), a real Zitadel (`IDP_ISSUER`), and Mailpit
 * (`MAILPIT_URL`) are all present, so a stray CI invocation skips cleanly.
 */

/** True only when the full live stand (portal + real Zitadel + Mailpit) is present. */
export const LIVE_STAND =
  !!process.env.E2E_PORTAL_URL &&
  !!process.env.IDP_ISSUER &&
  !!process.env.MAILPIT_URL;

/** A password satisfying the `@ds/schemas` creation baseline (#147). */
const livePassword = (): string => `Prt-${Date.now()}-aA1!`;

const newEmail = (): string =>
  `e2e-574-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;

/**
 * Fill + submit the register form the browser is CURRENTLY on (so any `returnTo`
 * already carried in the URL rides through to `/verify` and the post-auth resume),
 * read the real verify OTP from Mailpit, and enter it. Entering the final digit
 * auto-submits and auto-logs-in (#175). Returns the provisioned email.
 *
 * Selectors are LOCALE-AGNOSTIC (#177): the portal copy is Russian, so the flow
 * keys off stable `autocomplete` attributes + `data-testid`s, never visible text.
 */
export async function submitRegisterAndVerify(page: Page): Promise<string> {
  const email = newEmail();
  const sentAt = new Date().toISOString();
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(livePassword());
  await page.getByTestId("register-submit").click();
  await page.waitForURL(/\/verify/);
  const code = await fetchOtpCode(
    email,
    sentAt,
    NOTIFICATION_SUBJECTS.verifyEmail,
  );
  expect(code, "registration OTP should reach Mailpit").toBeTruthy();
  // No button click — the InputOTP `onComplete` auto-submits + auto-logs-in.
  await page.locator('input[autocomplete="one-time-code"]').fill(code!);
  return email;
}

/**
 * Provision a logged-in doctor from a CLEAN context: navigate to `/register` with
 * no event context, complete the 003 flow, and wait until the auto-login lands on
 * `/account`. Used by the one-tap scenario (EARS-1), which then drives the one-tap
 * command on a separate, not-yet-registered event.
 */
export async function provisionLoggedInDoctor(page: Page): Promise<string> {
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  const email = await submitRegisterAndVerify(page);
  await waitForAuthenticatedLanding(page);
  return email;
}

/**
 * Wait for the post-auth resume to leave the auth surfaces and land on an
 * authenticated home. Since 008 EARS-7 the default post-auth landing (no event
 * `returnTo`) is the discovery front-door `/`, but the profile `/account` is still
 * a valid landing for flows that target it — so accept either, keyed off the URL
 * having left `/register`/`/verify`. The session cookie is set before this
 * redirect, so the doctor is logged in once this resolves.
 */
export async function waitForAuthenticatedLanding(page: Page): Promise<void> {
  await page.waitForURL((url) => {
    const path = new URL(url).pathname;
    return path === "/" || path.startsWith("/account");
  });
}

/**
 * 008 EARS-7 fixture — provision a doctor and return the KNOWN credentials, so a
 * later, deliberate `/login` round-trip can drive the post-login landing (which
 * `submitRegisterAndVerify` cannot expose — it mints an internal password it never
 * returns). Register + verify the exact 003 way (real Mailpit OTP, auto-login lands
 * on `/account`), then hand back `{ email, password }` for the caller to log in
 * with after clearing the auto-login session. NOT a new auth primitive (008
 * Constraints): the account is minted the way 003 mints it.
 */
export async function provisionDoctorCreds(
  page: Page,
): Promise<{ email: string; password: string }> {
  const email = newEmail();
  const password = livePassword();
  const sentAt = new Date().toISOString();
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  await page.getByTestId("register-submit").click();
  await page.waitForURL(/\/verify/);
  const code = await fetchOtpCode(
    email,
    sentAt,
    NOTIFICATION_SUBJECTS.verifyEmail,
  );
  expect(code, "registration OTP should reach Mailpit").toBeTruthy();
  await page.locator('input[autocomplete="one-time-code"]').fill(code!);
  await waitForAuthenticatedLanding(page);
  return { email, password };
}
