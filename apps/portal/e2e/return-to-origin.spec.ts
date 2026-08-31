import { test, expect, type Page } from "@playwright/test";

import { fetchOtpCode } from "./support/mailpit";
import { NOTIFICATION_SUBJECTS } from "./support/notification-subjects";

/**
 * 014 EARS-6 — the platform-wide return-to-origin journey, driven in a real
 * browser (014 design §6; scenarios `@EARS-6`).
 *
 * The owner's rule (2026-08-17): whenever content sits behind a login, the
 * visitor who authenticates from that gate is landed back on the page they were
 * trying to consume. Unit coverage pins the guard (`apps/api/test/auth/
 * return-target.e2e-spec.ts`) and the once-only consumption
 * (`apps/portal/lib/return-to-origin.test.ts`); what only a browser can prove is
 * the part the design calls out as the hard one — that the target SURVIVES the
 * registration branch leaving the browser for the verification mail and coming
 * back on a cold `/verify` with no query at all.
 *
 * Gating mirrors `auth-journeys.e2e.spec.ts`: the whole suite `test.skip()`s
 * unless the real-Zitadel dev-stand env and a portal base URL are present. It is
 * NOT wired into CI or `pnpm test`.
 *
 * Run against a provisioned dev-stand with, e.g.:
 *   IDP_ISSUER=… IDP_CLIENT_ID=… IDP_SERVICE_TOKEN=… IDP_REDIRECT_URI=… \
 *   MAILPIT_URL=http://<stand-host>:8025 E2E_PORTAL_URL=http://localhost:<portal> \
 *   E2E_WEBINAR_SLUG=seed-005-upcoming \
 *   pnpm --filter @ds/portal test:e2e --project=e2e return-to-origin
 */

const LIVE_OIDC =
  !!process.env.IDP_ISSUER &&
  !!process.env.IDP_CLIENT_ID &&
  !!process.env.IDP_SERVICE_TOKEN &&
  !!process.env.IDP_REDIRECT_URI &&
  !!process.env.E2E_PORTAL_URL;

/** The gated origin page the journeys return to. */
const ORIGIN_SLUG = process.env.E2E_WEBINAR_SLUG ?? "seed-005-upcoming";
const ORIGIN_PATH = `/webinars/${ORIGIN_SLUG}`;

/** The post-login default landing when no valid target exists (013 EARS-15). */
const DEFAULT_LANDING = "/webinars";

const livePassword = (): string => `Rto-${Date.now()}-aA1!`;
const newEmail = (): string =>
  `e2e-1342-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;

/**
 * Register a fresh account from `entry` (an auth entry URL that may carry a
 * `returnTo`) and complete the email verification. The verification code is read
 * from REAL Mailpit and typed on a COLD `/verify` — a fresh navigation carrying no
 * `returnTo` query — which is exactly the shape of the mail-button open the design
 * requires the mechanism to survive. Resolves once the post-verify auto-login has
 * routed somewhere.
 */
async function registerThroughMail(
  page: Page,
  entry: string,
): Promise<{ email: string; password: string }> {
  const email = newEmail();
  const password = livePassword();
  const sentAt = new Date().toISOString();

  await page.goto(entry);
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  await page.getByTestId("register-submit").click();
  await page.waitForURL(/\/verify/);

  const code = await fetchOtpCode(
    email,
    sentAt,
    NOTIFICATION_SUBJECTS.verifyEmail,
  );
  expect(code, "registration code should reach Mailpit").toBeTruthy();

  // THE interruption the design names: leave the flow and come back through the
  // mail's own link shape — a cold `/verify#email=…` with no `returnTo` query.
  await page.goto(`/verify#email=${encodeURIComponent(email)}`);
  await page.locator('input[autocomplete="one-time-code"]').fill(code!);
  // Auto-submit on completion carries the flow (#175).
  await page.waitForURL((url) => !url.pathname.startsWith("/verify"), {
    timeout: 60_000,
  });
  return { email, password };
}

/** Sign in with an existing account from `entry`, then wait for the landing. */
async function loginFrom(
  page: Page,
  entry: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(entry);
  await page.locator('input[autocomplete="username"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByTestId("password-login-submit").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
}

test.describe("014 EARS-6 platform-wide return-to-origin", () => {
  test.skip(
    !LIVE_OIDC,
    "requires the real-Zitadel dev-stand env + E2E_PORTAL_URL",
  );

  test("EARS-6: the gated surface builds a same-origin returnTo into the auth entry", async ({
    page,
  }) => {
    // The origin of the whole mechanism: the gated page itself hands the auth
    // entry a same-origin RELATIVE target — never a hardcoded origin.
    await page.goto(ORIGIN_PATH);
    const entry = page.locator('a[href^="/register?returnTo="]').first();
    await expect(entry).toBeVisible();
    const href = await entry.getAttribute("href");
    expect(href).toContain(encodeURIComponent(ORIGIN_PATH));
    expect(href).not.toMatch(/https?:/i);
  });

  test("EARS-6: registration + verification returns the visitor to the page they were consuming", async ({
    page,
  }) => {
    await registerThroughMail(
      page,
      `/register?returnTo=${encodeURIComponent(ORIGIN_PATH)}`,
    );
    // The first authenticated navigation lands back on the ORIGIN page — even
    // though the verification step was re-entered cold, with no query to carry.
    await expect(page).toHaveURL(new RegExp(`${ORIGIN_PATH}$`));
  });

  test("EARS-6: signing in from the gate returns the visitor to the same page, and the target is consumed exactly once", async ({
    page,
  }) => {
    const { email, password } = await registerThroughMail(page, "/register");
    await page.goto("/logout").catch(() => undefined);
    await page.context().clearCookies();

    await loginFrom(
      page,
      `/login?returnTo=${encodeURIComponent(ORIGIN_PATH)}`,
      email,
      password,
    );
    await expect(page).toHaveURL(new RegExp(`${ORIGIN_PATH}$`));

    // Consumed exactly once: a later, unrelated sign-in must not be teleported
    // back into that page — it lands on the default.
    await page.context().clearCookies();
    await loginFrom(page, "/login", email, password);
    await expect(page).toHaveURL(new RegExp(`${DEFAULT_LANDING}$`));
  });

  test("EARS-6: a hostile return target is dropped rather than followed", async ({
    page,
  }) => {
    const { email, password } = await registerThroughMail(page, "/register");

    // The three `014-scenarios.feature` Examples, driven for real: an absolute
    // URL, a protocol-relative host and a backslash-escaped host.
    for (const hostile of [
      "https://example.invalid/",
      "//example.invalid/",
      "\\\\example.invalid\\",
    ]) {
      await page.context().clearCookies();
      await loginFrom(
        page,
        `/login?returnTo=${encodeURIComponent(hostile)}`,
        email,
        password,
      );
      // Lands on the surface's default landing, and never left the origin.
      await expect(page).toHaveURL(new RegExp(`${DEFAULT_LANDING}$`));
      expect(new URL(page.url()).hostname).not.toContain("example.invalid");
    }
  });
});
