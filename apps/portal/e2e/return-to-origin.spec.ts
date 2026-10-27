import { test, expect, type Page } from "@playwright/test";

import { fetchOtpCode } from "./support/mailpit";
import { NOTIFICATION_SUBJECTS } from "./support/notification-subjects";
import { isSignInHostForm } from "@ds/e2e/sign-in-host-api";
import {
  expectEnteredThrough,
  watchStorefrontEntries,
} from "@ds/e2e/storefront-entry-watch";

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";

/**
 * 014 EARS-6 — the platform-wide return-to-origin journey, driven in a real
 * browser (014 design §6; scenarios `@EARS-6`).
 *
 * The owner's rule (2026-08-17): whenever content sits behind a login, the
 * visitor who authenticates from that gate is landed back on the page they were
 * trying to consume. Unit coverage pins the guard (`apps/api/test/auth/
 * return-target.e2e-spec.ts`) and the once-only consumption
 * (`apps/portal/lib/return-to-origin.test.ts`); what only a browser can prove is
 * the flow-bound lifetime of the target (014 EARS-6, amendment 2026-09-30 «a
 * carried return target lives only inside the flow that carried it», #2495):
 *
 *   - IN the flow, every hop carries `returnTo` on the URL — register → verify
 *     (the code is typed on that same screen; the mail is link-free, 003
 *     EARS-29) → the sign-in door — and the visitor lands back on the page they
 *     were consuming, which on a webinar page completes the registration.
 *   - OUTSIDE it, a door opened with no `returnTo` (the header «Войти», a bare
 *     `/login`) starts a NEW flow: the parked `ds_return_to` copy is dropped and
 *     the sign-in lands on the default, registering nothing.
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

/** 020 LD-9 — a hybrid event with seats left, whose tab the sign-in must keep. */
const HYBRID_SLUG = process.env.E2E_HYBRID_SLUG;

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
 * `returnTo`) and complete the email verification IN the flow: the verification
 * code is read from REAL Mailpit and typed on the `/verify` screen the register
 * door pushed to — the very URL that carries `returnTo` (the mail itself is
 * link-free, 003 EARS-29, so this is the only way a real visitor gets there).
 * Resolves once the verify step has routed onward.
 */
async function registerThroughMail(
  page: Page,
  entry: string,
): Promise<{ email: string; password: string }> {
  const email = newEmail();
  const password = livePassword();
  const sentAt = new Date().toISOString();

  watchStorefrontEntries(page, BASE);
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

  // The in-flow hop: register → verify stays on the sign-in host's form (#3172);
  // the target rode the storefront entry into the API transaction, never a form URL.
  expect(isSignInHostForm(page.url()), "verify is the sign-in host form").toBe(
    true,
  );
  expectEnteredThrough(page, BASE, {
    pathname: "/register",
    returnTo: ORIGIN_PATH,
  });
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

    // The confirmation either signs in with the credential still held in memory
    // and navigates straight to the target (021 amendment 2026-09-17), or falls
    // back to the sign-in door (005 EARS-2). That fallback is a hop INSIDE the
    // flow — the sign-in host's door on the same auth request (#3172), whose
    // transaction holds the target — so the landing below proves it.
    if (new URL(page.url()).pathname.startsWith("/login")) {
      expect(isSignInHostForm(page.url()), "the in-flow sign-in door").toBe(
        true,
      );
      await submitLogin(page, email, password);
    }
    // Landing back on the webinar page is what completes the registration.
    await expect(page).toHaveURL(new RegExp(`${ORIGIN_PATH}$`));
  });

  test("EARS-6.10: an abandoned flow's target dies at the next bare door — a later sign-in lands on the default and registers nothing", async ({
    page,
  }) => {
    const { email, password } = account();
    await page.context().clearCookies();

    // «Записаться» → the carrying door parks the target…
    await page.goto(`/login?returnTo=${encodeURIComponent(ORIGIN_PATH)}`);
    const parkedCookie = async () =>
      (await page.context().cookies()).find((c) => c.name === "ds_return_to");
    expect(await parkedCookie(), "the carrying door parks").toBeDefined();

    // …the visitor abandons it and later opens a bare `/login` (the header
    // «Войти»): a NEW flow, so the door drops the earlier flow's target.
    await page.goto("/login");
    expect(
      await parkedCookie(),
      "a bare door drops the target parked by an abandoned flow",
    ).toBeUndefined();

    // The sign-in lands on the default, never on the webinar page — so the
    // registration the abandoned flow carried is never completed.
    await submitLogin(page, email, password);
    await expect(page).toHaveURL(new RegExp(`${DEFAULT_LANDING}$`));
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

  test("020 EARS-5 (LD-9): signing in from a hybrid event's «Онлайн» tab lands back on that tab", async ({
    page,
  }) => {
    test.skip(!HYBRID_SLUG, "set E2E_HYBRID_SLUG (a hybrid event with seats)");
    // A provisioned doctor when the stand names one (no signup spent), else
    // the account the registration journey created.
    const { email, password } =
      process.env.E2E_DOCTOR_EMAIL && process.env.E2E_DOCTOR_PASSWORD
        ? {
            email: process.env.E2E_DOCTOR_EMAIL,
            password: process.env.E2E_DOCTOR_PASSWORD,
          }
        : account();
    await page.context().clearCookies();

    // The real path: the guest picks «Онлайн», takes the card's sign-in link
    // (the server-resolved CTA carries the tab), and passes the sign-in door.
    const hybridPath = `/webinars/${HYBRID_SLUG}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(hybridPath);
    await page.getByRole("tab", { name: "Онлайн" }).click();
    await expect(page).toHaveURL(/[?&]mode=online\b/u);
    const returnTo = `${hybridPath}?mode=online`;
    const handoff = page
      .getByTestId("event-signup-card")
      .locator('a[href*="returnTo"]')
      .first();
    const href = (await handoff.getAttribute("href")) ?? "";
    expect(new URL(href, page.url()).searchParams.get("returnTo")).toBe(
      returnTo,
    );
    // The sign-in door with that carried value (the register door's «Войти»
    // hands the same value on; the account already exists).
    await page.goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    await submitLogin(page, email, password);

    // The door's landing keeps the tab — never the bare page, whose default
    // is «Очно» while seats remain.
    await expect
      .poll(() => {
        const landed = new URL(page.url());
        return `${landed.pathname}${landed.search}`;
      })
      .toBe(returnTo);
    await expect(page.getByTestId("event-format-tabs")).toHaveAttribute(
      "data-mode",
      "online",
    );
    // PR evidence when the run names a capture directory.
    if (process.env.E2E_SHOT_DIR) {
      await page.screenshot({
        path: `${process.env.E2E_SHOT_DIR}/academy-hybrid-tab-signin-return-desktop-light.png`,
        fullPage: true,
      });
    }
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
