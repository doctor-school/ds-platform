import { test, expect, type Page } from "@playwright/test";
import { fetchMessage, fetchOtpCode } from "./support/mailpit";
import { NOTIFICATION_SUBJECTS } from "./support/notification-subjects";
import { fetchSmsOtpCode } from "./support/sms-sink";
import { provisionLoggedInDoctor } from "./support/doctor-session";
import {
  createUserWithPhone,
  deleteUser,
  grantDoctorGuest,
  requestPhoneVerification,
  verifyPhone,
} from "./support/zitadel-admin";

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
 * A unique E.164-ish phone for the SMS-OTP journey. The dev-stand SMS provider is
 * the local sink (no real delivery), so any well-formed number Zitadel accepts
 * works; uniqueness avoids collisions across reruns (Zitadel uniques the phone).
 */
const newPhone = (): string => `+1555${String(Date.now()).slice(-7)}`;

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

  test("password: register → verify auto-submits → auto-login → session → logout", async ({
    page,
  }) => {
    const email = newEmail();
    const password = livePassword();

    // ── Register (EARS-1) ────────────────────────────────────────────────
    // Selectors are LOCALE-AGNOSTIC (#177): the portal copy is Russian, so the
    // journeys key off stable `autocomplete` attributes, `data-testid`s, and
    // ARIA roles — never the visible English text the EN-first scaffold used.
    await page.goto("/register");
    const sentAt = new Date().toISOString();
    await page.locator('input[autocomplete="email"]').fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByTestId("register-submit").click();

    // The portal routes to /verify carrying the identifier on the pending ack.
    // The entered password is NOT in the URL (it rides only the in-memory store).
    await page.waitForURL(/\/verify/);
    expect(page.url()).not.toContain(password);

    // ── Verify (EARS-3) — read the real code from Mailpit ────────────────
    // #175: entering the final digit AUTO-SUBMITS (InputOTP `onComplete`). We
    // fill the 6-digit code and do NOT click the button — the journey must
    // advance on its own. On success the held password is replayed into the real
    // EARS-5 password login and the user lands DIRECTLY on /account (no manual
    // /login round-trip).
    const verifyCode = await fetchOtpCode(
      email,
      sentAt,
      NOTIFICATION_SUBJECTS.verifyEmail,
    );
    expect(verifyCode, "registration code should reach Mailpit").toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(verifyCode!);
    // No `getByTestId("verify-submit").click()` — auto-submit carries the flow.

    // ── Session visible (EARS-8 read side) — set by the EARS-5 login replay ──
    await page.waitForURL(/\/account/);
    await expect(page.getByTestId("profile-email")).not.toBeEmpty();
    await assertNoTokenInClient(page);

    // ── Logout (EARS-10) ─────────────────────────────────────────────────
    await page.getByTestId("logout").click();
    await page.waitForURL(/\/login/);
    const after = await page.context().cookies();
    expect(after.find((c) => c.name === SESSION_COOKIE)?.value || "").toBe("");
  });

  // #675 — an ALREADY-authenticated session must not be able to re-walk the auth
  // flow. After minting a real logged-in doctor (lands on /account), visiting each
  // of the four portal auth surfaces redirects straight back to /account with NO
  // auth form rendered. Selectors stay locale-agnostic (`data-testid`), never RU
  // text. The <AuthShell> guard (client `GET /v1/auth/session`) is the mechanism.
  test("authenticated session is redirected off every auth surface to /account (no form)", async ({
    page,
  }) => {
    // Mint a real logged-in doctor via the shipped 003 flow (ends on /account).
    await provisionLoggedInDoctor(page);
    await page.waitForURL(/\/account/);

    // Each guarded auth surface, with the submit control that exists ONLY on
    // the unauthenticated form — its absence proves no auth form was rendered.
    // `/reset` is NOT in this list: it is the deliberate guard exemption (003
    // EARS-28, #770) — the /account change-password action hands off there for
    // logged-in doctors, so it must stay reachable (asserted below).
    const surfaces: { route: string; submitTestId: string }[] = [
      { route: "/login", submitTestId: "password-login-submit" },
      { route: "/register", submitTestId: "register-submit" },
      { route: "/verify", submitTestId: "verify-submit" },
    ];

    for (const { route, submitTestId } of surfaces) {
      await page.goto(route);
      // The guard redirects the authenticated visitor straight to /account…
      await page.waitForURL(/\/account/);
      // …and never rendered the auth form on the way (no flash of the submit).
      await expect(page.getByTestId(submitTestId)).toHaveCount(0);
    }

    // EARS-28: the /reset flow stays REACHABLE for the authenticated doctor —
    // the request form renders instead of bouncing back to /account.
    await page.goto("/reset");
    await expect(page.getByTestId("reset-request-submit")).toBeVisible();
  });

  test("email-OTP: register+verify → request code → login → session", async ({
    page,
  }) => {
    const email = newEmail();
    const password = livePassword();

    // The account must exist+be verified before an OTP login challenge fires —
    // reuse the password journey's front half to provision it. #175: verify
    // auto-submits and auto-logs-in, so provisioning now lands on /account.
    await page.goto("/register");
    const regAt = new Date().toISOString();
    await page.locator('input[autocomplete="email"]').fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByTestId("register-submit").click();
    await page.waitForURL(/\/verify/);
    const verifyCode = await fetchOtpCode(
      email,
      regAt,
      NOTIFICATION_SUBJECTS.verifyEmail,
    );
    expect(verifyCode).toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(verifyCode!);
    // Auto-submit + auto-login (#175) — no button click, lands on /account.
    await page.waitForURL(/\/account/);

    // Sign out so the OTP-login challenge below starts from a clean session.
    await page.getByTestId("logout").click();
    await page.waitForURL(/\/login/);

    // ── Request an email OTP (EARS-6 step 1) ─────────────────────────────
    // #179: /login now starts on the Password method tab; select the
    // "One-time code" method before the channel selector / request fields
    // exist (Radix unmounts the inactive panel, so they're absent until then).
    await page.getByTestId("login-method-otp").click();
    await page.getByTestId("otp-channel-email").click();
    await page.getByTestId("otp-identifier").fill(email);
    const otpSentAt = new Date().toISOString();
    await page.getByTestId("otp-send").click();

    // ── Read the login OTP from Mailpit + submit (EARS-6 step 2 / EARS-8) ─
    // Select by the email-OTP subject, NOT timestamp: Zitadel sends the
    // registration verify-email mail and this login email-OTP mail < 1 s apart,
    // so the registration code can fall inside the OTP window and be read instead
    // (login then fails on the wrong code) — #131 live. Subjects are `ru`-locked
    // (#177) and centralized in `NOTIFICATION_SUBJECTS` (#305).
    const otpCode = await fetchOtpCode(
      email,
      otpSentAt,
      NOTIFICATION_SUBJECTS.verifyEmailOtp,
    );
    expect(otpCode, "login OTP should reach Mailpit").toBeTruthy();
    // #175: the login-OTP input AUTO-SUBMITS once the final (8th) digit lands —
    // we fill the code and do NOT click `otp-verify`; the flow must advance on
    // its own (the explicit button stays for a11y but is not exercised here).
    await page.locator('input[autocomplete="one-time-code"]').fill(otpCode!);

    await page.waitForURL(/\/account/);
    await expect(page.getByTestId("profile-email")).not.toBeEmpty();
    await assertNoTokenInClient(page);
  });

  // EARS-7 SMS-OTP — the live browser round-trip, the SAME bar the email-OTP
  // journey above sets (#170). The dev-stand Zitadel now has a generic HTTP SMS
  // provider pointing at the local `sms-sink` (the SMS analogue of Mailpit;
  // compose.core.yml + provision.sh), so the code Zitadel renders is delivered to
  // the sink and read back here — never surfaced through any api/BFF response
  // (that would make the EARS-8/16 ack a code oracle, or need a banned backdoor).
  // SMS-Aero is the PRODUCTION sender (recorded in the specs); the dev-stand never
  // reaches it. NOT faked green — proven against REAL Zitadel.
  test("sms-OTP: provisioned phone → request code → login → session", async ({
    page,
  }) => {
    const email = newEmail();
    const phone = newPhone();
    const password = livePassword();
    let userId = "";

    try {
      // ── Fixture: provision an account with a VERIFIED phone ──────────────
      // The portal register form collects only email+password (no phone field —
      // a separate product slice), so the SMS-OTP precondition (a verified phone)
      // is set up out-of-band via the Zitadel service API, exactly as the api-tier
      // e2e provisions its fixtures. This is setup, not the path under test; the
      // path under test is the live BROWSER round-trip on /login below.
      userId = await createUserWithPhone({ email, password, phone });
      const verifyAt = new Date().toISOString();
      await requestPhoneVerification(userId);
      const verifyCode = await fetchSmsOtpCode(
        phone,
        verifyAt,
        "user.human.phone.code.added",
      );
      expect(verifyCode, "phone-verify SMS should reach the sink").toBeTruthy();
      await verifyPhone(userId, verifyCode!);
      // Replicate the register-time #157 grant: the `doctor_guest` project role is
      // what the OIDC token's roles claim carries, and `/auth/session` is gated on
      // it — without the grant the SMS-OTP session would 403 on the /account read.
      await grantDoctorGuest(userId);

      // ── Request an SMS OTP (EARS-7 step 1) ───────────────────────────────
      await page.goto("/login");
      // #179: select the "One-time code" method tab first (defaults to Password).
      await page.getByTestId("login-method-otp").click();
      await page.getByTestId("otp-channel-sms").click();
      await page.getByTestId("otp-identifier").fill(phone);
      const otpSentAt = new Date().toISOString();
      await page.getByTestId("otp-send").click();

      // ── Read the login OTP from the sink + submit (EARS-7 step 2 / EARS-8) ─
      // Select by the `session.otp.sms.challenged` event, NOT timestamp alone:
      // the registration phone-verify SMS lands close enough that the time cutoff
      // cannot separate it (the SMS twin of the email `Verify OTP` subject fix).
      const otpCode = await fetchSmsOtpCode(
        phone,
        otpSentAt,
        "session.otp.sms.challenged",
      );
      expect(otpCode, "login OTP should reach the sink").toBeTruthy();
      // #175: auto-submit on completion (no `otp-verify` click) — same as the
      // email-OTP journey above; the SMS code is the same fixed 8-digit length.
      await page.locator('input[autocomplete="one-time-code"]').fill(otpCode!);

      // ── Session visible + EARS-8 no-token invariant ──────────────────────
      await page.waitForURL(/\/account/);
      await expect(page.getByTestId("profile-email")).not.toBeEmpty();
      await assertNoTokenInClient(page);
    } finally {
      if (userId) await deleteUser(userId);
    }
  });

  // #200 defect 1 on the `/reset` COMPLETE step — relocated here from the ungated
  // `identifier-validation.e2e.spec.ts` because, unlike the `/register` variant that
  // stays there, reaching the complete step is NOT backend-free: the stage flips only
  // after a live BFF reset ack (`reset-request-submit` →
  // `authClient.requestPasswordReset()` → `POST /password/reset`). So the new-password
  // field that renders the complexity copy does not exist until the api round-trips —
  // it belongs in this live-gated suite, not the portal-only tier. The assertion is
  // the same: a weak new password must render the RU `passwordComplexity` copy, with
  // NO English leak from the `@ds/schemas` `NewPasswordSchema` `.regex()` message.
  test("reset complete: a weak new password renders the RU complexity copy, never English", async ({
    page,
  }) => {
    // The RU copy (apps/portal/messages/ru.json → errors.validation.passwordComplexity);
    // the English `NewPasswordSchema` message ("password must include …") must never
    // reach the rendered field (#200 defect 1).
    const ruPasswordComplexity =
      "Пароль должен содержать заглавную и строчную буквы, цифру и спецсимвол.";
    // A new password failing the #147 complexity baseline (no upper/digit/symbol).
    const weakNewPassword = "weakpassword";

    // ── Advance to the complete step via the live BFF reset ack ──────────────
    // The request only needs a well-formed identifier; EARS-16 makes the ack
    // identical regardless of existence, so the stage flips and the new-password
    // field mounts. Selectors stay locale-agnostic (`autocomplete` / `data-testid`).
    await page.goto("/reset");
    await page.locator('input[autocomplete="username"]').fill(newEmail());
    await page.getByTestId("reset-request-submit").click();

    const pw = page.locator('input[autocomplete="new-password"]');
    await expect(pw).toBeVisible();
    await pw.fill(weakNewPassword);
    // Blur to trigger on-touched validation without needing the code field.
    await pw.blur();

    await expect(page.getByText(ruPasswordComplexity)).toBeVisible();
    await expect(page.getByText(/password must include/i)).toHaveCount(0);
  });

  // #207 EARS-23/24 — the duplicate-registration UX dead-end fix. Two halves:
  //   EARS-24 (screen): a fresh register lands on the existence-agnostic
  //     "check your email" /verify screen, which offers BOTH the code field AND
  //     prominent Войти / Сбросить пароль actions (co-equal, never branching on
  //     existence).
  //   EARS-23 (backend): re-registering the SAME (already-registered) email
  //     returns the IDENTICAL pending_verification AND privately sends an
  //     account-exists notice email — a sign-in / reset prompt carrying NO code.
  // Live-gated (manual): asserts against REAL Mailpit on the dev-stand. Requires
  // MAILER_SMTP_* configured at the api so the notice actually sends.
  test("EARS-23/24: duplicate register → existence-agnostic screen + account-exists notice (no code)", async ({
    page,
  }) => {
    const email = newEmail();
    const password = livePassword();

    // ── Register #1 (new account) → land on the "check your email" screen ──
    await page.goto("/register");
    const firstAt = new Date().toISOString();
    await page.locator('input[autocomplete="email"]').fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByTestId("register-submit").click();
    await page.waitForURL(/\/verify/);

    // EARS-24: the screen offers the code field AND the co-equal sign-in / reset
    // actions — the existence-agnostic affordances, present for every visitor.
    await expect(page.locator('input[autocomplete="one-time-code"]')).toBeVisible();
    await expect(page.getByTestId("verify-go-to-login")).toBeVisible();
    await expect(page.getByTestId("verify-go-to-reset")).toBeVisible();

    // Complete verification so the email is now an ALREADY-REGISTERED account.
    const verifyCode = await fetchOtpCode(
      email,
      firstAt,
      NOTIFICATION_SUBJECTS.verifyEmail,
    );
    expect(verifyCode).toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(verifyCode!);
    await page.waitForURL(/\/account/);
    await page.getByTestId("logout").click();
    await page.waitForURL(/\/login/);

    // ── Register #2 (same, already-registered email) ──────────────────────
    await page.goto("/register");
    const dupAt = new Date().toISOString();
    await page.locator('input[autocomplete="email"]').fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByTestId("register-submit").click();

    // EARS-16: the response is identical — the form still routes to /verify and
    // discloses nothing about existence (no dead-end; the same screen offers the
    // sign-in affordance for the existing owner).
    await page.waitForURL(/\/verify/);
    await expect(page.getByTestId("verify-go-to-login")).toBeVisible();

    // EARS-23: an account-exists notice lands privately in the inbox, and it
    // carries NO verification/login code (it is a product notice, not a credential
    // email — the existing owner is told to sign in / reset, never given a code).
    const notice = await fetchMessage(email, dupAt, "уже есть аккаунт");
    expect(notice, "account-exists notice should reach Mailpit").toBeTruthy();
    const body = `${notice!.Text}\n${notice!.HTML}`;
    expect(body).toMatch(/\/login/);
    expect(body).toMatch(/\/reset/);
    // No 6-8 digit / alphanumeric code anywhere in the notice.
    expect(body).not.toMatch(/\bCode\s+[A-Z0-9]{4,12}\b/);
    expect(body).not.toMatch(/\b[0-9]{6,8}\b/);
  });
});
