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
 * Run `submit` and wait for the navigation `settled` describes.
 *
 * The dev-stand IdP is SHARED and throttles rapid serial signups and sign-ins
 * with a "повторите через несколько минут" alert instead of a navigation. That is
 * an environment limit, not a product behaviour, so the journey waits the
 * throttle out and retries rather than reporting a false failure.
 */
async function submitPastThrottle(
  page: Page,
  submit: () => Promise<void>,
  settled: (url: URL) => boolean,
): Promise<void> {
  const ATTEMPTS = 4;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    await submit();
    const throttled = page.getByRole("alert").filter({ hasText: /повторите/i });
    const landed = await Promise.race([
      page
        .waitForURL(settled, { timeout: 45_000 })
        .then(() => true)
        .catch(() => false),
      throttled
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => false)
        .catch(() => false),
    ]);
    if (landed) return;
    expect(
      attempt,
      "the shared dev-stand IdP kept throttling across every retry",
    ).toBeLessThan(ATTEMPTS);
    await page.waitForTimeout(60_000);
  }
}

/**
 * Register a fresh account from `entry` (an auth entry URL that may carry a
 * `returnTo`) and complete the email verification. The verification code is read
 * from REAL Mailpit and typed on a COLD `/verify` — a fresh navigation carrying no
 * `returnTo` query — which is exactly the shape of the mail-button open the design
 * requires the mechanism to survive. Resolves once the verify step has routed
 * onward — for a cold open that is the `/login` fallback, since no credential is
 * held in memory to auto-login with.
 */
async function registerThroughMail(
  page: Page,
  entry: string,
): Promise<{ email: string; password: string }> {
  const email = newEmail();
  const password = livePassword();
  const sentAt = new Date().toISOString();

  await page.goto(entry);
  await submitPastThrottle(
    page,
    async () => {
      await page.locator('input[autocomplete="email"]').fill(email);
      await page.locator('input[autocomplete="new-password"]').fill(password);
      await page.getByTestId("register-submit").click();
    },
    (url) => url.pathname.startsWith("/verify"),
  );

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

/** Submit the password-login form already on screen and wait for the landing. */
async function submitLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await submitPastThrottle(
    page,
    async () => {
      await page.locator('input[autocomplete="username"]').fill(email);
      await page
        .locator('input[autocomplete="current-password"]')
        .fill(password);
      await page.getByTestId("password-login-submit").click();
    },
    (url) => !url.pathname.startsWith("/login"),
  );
}

/** Open `entry`, then sign in with an existing account and await the landing. */
async function loginFrom(
  page: Page,
  entry: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(entry);
  await submitLogin(page, email, password);
}

/**
 * The account the whole journey shares. The dev-stand Zitadel is a SHARED
 * resource that rate-limits rapid serial self-signups and sign-ins, so this suite
 * spends exactly ONE signup: the registration journey below creates it (that
 * branch is the thing under test), and the sign-in journeys reuse it. Hence
 * `mode: "serial"` — the reuse is a deliberate ordering dependency, not an
 * accident.
 */
let sharedAccount: { email: string; password: string } | null = null;

test.describe("014 EARS-6 platform-wide return-to-origin", () => {
  test.describe.configure({ mode: "serial" });

  test.skip(
    !LIVE_OIDC,
    "requires the real-Zitadel dev-stand env + E2E_PORTAL_URL",
  );

  // A real signup, a real verification mail and up to a throttle wait per sign-in
  // do not fit the repo-wide 120 s budget.
  test.beforeEach(() => {
    test.setTimeout(900_000);
  });

  /** The account created by the registration journey; fails loudly if absent. */
  const account = (): { email: string; password: string } => {
    expect(
      sharedAccount,
      "the registration journey must run first (serial mode)",
    ).not.toBeNull();
    return sharedAccount!;
  };

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
    const { email, password } = await registerThroughMail(
      page,
      `/register?returnTo=${encodeURIComponent(ORIGIN_PATH)}`,
    );
    // The one signup this suite spends — the sign-in journeys below reuse it.
    sharedAccount = { email, password };

    // Re-entering `/verify` COLD through the mail's own link shape leaves the
    // page with no held credential to auto-login with, so the shipped 005 EARS-2
    // fallback routes to `/login` for a manual sign-in — and, crucially, it does
    // so with NO `returnTo` query, because the cold open carried none.
    await expect(page).toHaveURL(/\/login$/);

    // THE assertion this journey exists for: the target still survived. Nothing
    // in the URL carries it — only the parked `ds_return_to` cookie does — so the
    // first authenticated navigation out of that bare `/login` lands the visitor
    // back on the page they were trying to consume.
    await submitLogin(page, email, password);
    await expect(page).toHaveURL(new RegExp(`${ORIGIN_PATH}$`));
  });

  test("EARS-6: signing in from the gate returns the visitor to the same page, and the target is consumed exactly once", async ({
    page,
  }) => {
    const { email, password } = account();
    // The portal has no `/logout` ROUTE — sign-out is the `POST /v1/auth/logout`
    // call behind the account affordance, and the session it ends is carried by
    // cookies. Dropping the context cookies is therefore the honest browser-side
    // sign-out for this journey.
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
    const { email, password } = account();

    // The three `014-scenarios.feature` Examples, driven for real: an absolute
    // URL, a protocol-relative host and a backslash-escaped host. The drop happens
    // at the auth entry itself — a hostile value is never parked — so each shape is
    // proven by the ABSENCE of the `ds_return_to` cookie after a real navigation.
    // (The shared dev-stand IdP rate-limits rapid serial sign-ins, so the journey
    // spends its one login budget on the landing assertion below rather than
    // re-authenticating once per shape.)
    for (const hostile of [
      "https://example.invalid/",
      "//example.invalid/",
      "\\\\example.invalid\\",
    ]) {
      await page.context().clearCookies();
      await page.goto(`/login?returnTo=${encodeURIComponent(hostile)}`);
      const parked = (await page.context().cookies()).find(
        (c) => c.name === "ds_return_to",
      );
      expect(
        parked,
        `hostile target must not be parked: ${hostile}`,
      ).toBeUndefined();
    }

    // …and with nothing parked, the sign-in lands on the surface's default
    // landing — never on the attacker's host.
    await page.context().clearCookies();
    await loginFrom(
      page,
      `/login?returnTo=${encodeURIComponent("https://example.invalid/")}`,
      email,
      password,
    );
    await expect(page).toHaveURL(new RegExp(`${DEFAULT_LANDING}$`));
    expect(new URL(page.url()).hostname).not.toContain("example.invalid");
  });
});
