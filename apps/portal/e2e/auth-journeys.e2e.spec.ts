import { test, expect, type Page } from "@playwright/test";
import { fetchMessage, fetchOtpCode } from "./support/mailpit";
import { NOTIFICATION_SUBJECTS } from "./support/notification-subjects";
import { fetchSmsOtpCode } from "./support/sms-sink";
import {
  provisionLoggedInDoctor,
  waitForAuthenticatedLanding,
} from "./support/doctor-session";
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

  test("003 EARS-1/41/10: password register → the code auto-submits and signs in → session → logout", async ({
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
    // #175: entering the final character AUTO-SUBMITS (InputOTP `onComplete`).
    // We fill the 6-character code and do NOT click the button — the journey
    // must advance on its own. 003 EARS-41: the accepted code's answer IS the
    // session (no password replay, no manual /login round-trip).
    const verifyCode = await fetchOtpCode(
      email,
      sentAt,
      NOTIFICATION_SUBJECTS.verifyEmail,
    );
    expect(verifyCode, "registration code should reach Mailpit").toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(verifyCode!);
    // No `getByTestId("verify-submit").click()` — auto-submit carries the flow.

    // ── Session visible (EARS-8 read side) — set by the code itself (EARS-41) ──
    await waitForAuthenticatedLanding(page);
    // `profile-email` / `logout` live on the /account profile card, so step onto
    // it deliberately — the default post-auth landing is `/webinars` (013 EARS-15).
    await page.goto("/account");
    await expect(page.getByTestId("profile-email")).not.toBeEmpty();
    await assertNoTokenInClient(page);

    // ── Logout (EARS-10) ─────────────────────────────────────────────────
    await page.getByTestId("logout").click();
    // #2488: sign-out lands on the storefront home, the same on both storefronts.
    await page.waitForURL((url) => url.pathname === "/");
    const after = await page.context().cookies();
    expect(after.find((c) => c.name === SESSION_COOKIE)?.value || "").toBe("");
  });

  // #675 — an ALREADY-authenticated session must not be able to re-walk the auth
  // flow. After minting a real logged-in doctor (lands on the accepted post-auth
  // landing — `/webinars` by default since 013 EARS-15), visiting each
  // of the four portal auth surfaces redirects straight back to /account with NO
  // auth form rendered. Selectors stay locale-agnostic (`data-testid`), never RU
  // text. The <AuthShell> guard (client `GET /v1/auth/session`) is the mechanism.
  test("authenticated session is redirected off every auth surface to /account (no form)", async ({
    page,
  }) => {
    // Mint a real logged-in doctor via the shipped 003 flow (ends on /account).
    await provisionLoggedInDoctor(page);
    await waitForAuthenticatedLanding(page);

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

  test("003 EARS-6/42: email-OTP — register+verify → request code → a 6-character code signs in → session", async ({
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
    // Auto-submit + auto-login (#175) — no button click; the session lands on
    // the accepted post-auth landing (013 EARS-15: `/webinars` by default).
    await waitForAuthenticatedLanding(page);
    // `profile-email` / `logout` live on the /account profile card, so step onto
    // it deliberately — the default post-auth landing is `/webinars` (013 EARS-15).
    await page.goto("/account");

    // Sign out so the OTP-login challenge below starts from a clean session.
    await page.getByTestId("logout").click();
    // #2488: sign-out lands on the storefront home; the OTP journey opens the door itself.
    await page.waitForURL((url) => url.pathname === "/");
    await page.goto("/login");

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
    // #175: the login-OTP input AUTO-SUBMITS once the final (6th) character
    // lands — the same six cells as registration (003 EARS-42, #2555) — we fill
    // the code and do NOT click `otp-verify`; the flow must advance on its own
    // (the explicit button stays for a11y but is not exercised here).
    expect(otpCode).toMatch(/^[A-Z0-9]{6}$/);
    await page.locator('input[autocomplete="one-time-code"]').fill(otpCode!);

    await waitForAuthenticatedLanding(page);
    // `profile-email` / `logout` live on the /account profile card, so step onto
    // it deliberately — the default post-auth landing is `/webinars` (013 EARS-15).
    await page.goto("/account");
    await expect(page.getByTestId("profile-email")).not.toBeEmpty();
    await assertNoTokenInClient(page);
  });

  // 003 EARS-43 — the congress-site entry link `/login?method=code` opens the
  // card ALREADY on «По коду» (no tab click), and the carried returnTo is where
  // the code sign-in lands, exactly as without the param.
  test("003 EARS-43: /login?method=code&returnTo=/account opens on «По коду» and the code sign-in lands on /account", async ({
    page,
  }) => {
    const email = newEmail();

    // Provision a verified account (the email-OTP journey's front half).
    await page.goto("/register");
    const regAt = new Date().toISOString();
    await page.locator('input[autocomplete="email"]').fill(email);
    await page
      .locator('input[autocomplete="new-password"]')
      .fill(livePassword());
    await page.getByTestId("register-submit").click();
    await page.waitForURL(/\/verify/);
    const verifyCode = await fetchOtpCode(
      email,
      regAt,
      NOTIFICATION_SUBJECTS.verifyEmail,
    );
    expect(verifyCode).toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(verifyCode!);
    await waitForAuthenticatedLanding(page);
    await page.goto("/account");
    await page.getByTestId("logout").click();
    await page.waitForURL((url) => url.pathname === "/");

    await page.goto("/login?method=code&returnTo=%2Faccount");
    await expect(page.getByTestId("login-method-otp")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // A preselection, not a lock: the password tab is still offered.
    await expect(page.getByTestId("login-method-password")).toBeVisible();

    await page.getByTestId("otp-channel-email").click();
    await page.getByTestId("otp-identifier").fill(email);
    const otpSentAt = new Date().toISOString();
    await page.getByTestId("otp-send").click();
    const otpCode = await fetchOtpCode(
      email,
      otpSentAt,
      NOTIFICATION_SUBJECTS.verifyEmailOtp,
    );
    expect(otpCode, "login OTP should reach Mailpit").toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(otpCode!);

    await page.waitForURL((url) => url.pathname === "/account");
    await expect(page.getByTestId("profile-email")).not.toBeEmpty();
  });

  // 003 EARS-44 · 044 EARS-39 — the Congress hand-off on the Academy: a REAL
  // Congress sign-up (the only minter of a reference) through this host's /v1
  // proxy, then `/login?method=code&handoff=<ref>` opens straight on the code
  // step with the code already sent, strips the reference, and the mailed code
  // lands on the carried returnTo. Stand prerequisite: the api runs with the
  // `CONGRESS_SIGNUP_*` keys and its event id names an existing event.
  test("003 EARS-44: the Congress hand-off opens the code step with the code already sent and lands on /account", async ({
    page,
  }) => {
    const email = newEmail();
    const book = await page.request.get("/v1/public/specialties");
    expect(book.ok(), `specialties — ${book.status()}`).toBe(true);
    const { entries } = (await book.json()) as {
      entries: Array<{ id: string }>;
    };
    const signUp = await page.request.post("/v1/congress/sign-up", {
      data: {
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
        email,
        specialtyId: entries[0]!.id,
        workplace: "ГКБ № 1",
        city: "Москва",
        region: "Москва",
        contactPhone: "+7 (900) 123-45-67",
        personalDataConsent: true,
      },
    });
    const accepted = (await signUp.json()) as {
      status?: string;
      handoff?: string;
    };
    expect(
      accepted.status,
      `congress sign-up — ${signUp.status()}: ${JSON.stringify(accepted)}`,
    ).toBe("accepted");

    const sentAt = new Date().toISOString();
    const response = await page.goto(
      `/login?method=code&handoff=${accepted.handoff}&returnTo=%2Faccount`,
    );
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByTestId("otp-verify")).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page).toHaveURL(/\/login\?method=code&returnTo=%2Faccount$/);

    const code = await fetchOtpCode(email, sentAt);
    expect(code, "the hand-off code should reach Mailpit").toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(code!);

    await page.waitForURL((url) => url.pathname === "/account");
    await expect(page.getByTestId("profile-email")).not.toBeEmpty();
  });

  test("003 EARS-44: an unknown hand-off reference falls back to «По коду» with an empty field", async ({
    page,
  }) => {
    await page.goto(
      "/login?method=code&handoff=Ab-_0123456789abcdefghijklmnopqrstuvwxyzABC",
    );

    await expect(page).toHaveURL(/\/login\?method=code$/);
    await expect(page.getByTestId("login-method-otp")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("otp-identifier")).toHaveValue("");
    await expect(page.getByTestId("otp-verify")).toHaveCount(0);
  });

  // EARS-7 SMS-OTP — the live browser round-trip, the SAME bar the email-OTP
  // journey above sets (#170). The dev-stand Zitadel now has a generic HTTP SMS
  // provider pointing at the local `sms-sink` (the SMS analogue of Mailpit;
  // compose.core.yml + provision.sh), so the code Zitadel renders is delivered to
  // the sink and read back here — never surfaced through any api/BFF response
  // (that would make the EARS-8/16 ack a code oracle, or need a banned backdoor).
  // SMS-Aero is the PRODUCTION sender (recorded in the specs); the dev-stand never
  // reaches it. NOT faked green — proven against REAL Zitadel.
  test("003 EARS-7/42: sms-OTP — provisioned phone → request code → a 6-character code signs in → session", async ({
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
      // email-OTP journey above; the SMS code is the same six upper-alphanumeric
      // characters (003 EARS-7 amended, #2555).
      expect(otpCode).toMatch(/^[A-Z0-9]{6}$/);
      await page.locator('input[autocomplete="one-time-code"]').fill(otpCode!);

      // ── Session visible + EARS-8 no-token invariant ──────────────────────
      await waitForAuthenticatedLanding(page);
      // The default post-auth landing is `/webinars` (013 EARS-15); the profile
      // card assertions below live on /account, so step onto it deliberately.
      await page.goto("/account");
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
  // field that renders the rejection copy does not exist until the api round-trips —
  // it belongs in this live-gated suite, not the portal-only tier. The assertion is
  // the same shape: a rejected new password must render the RU catalog copy, with NO
  // English leak from the `@ds/schemas` `NewPasswordSchema` message. Since 003
  // EARS-36 the only creation rule is the length floor, so the rejected input is a
  // <8-char password and a class-free 8+ password is accepted.
  test("003 EARS-36 / reset complete: a too-short new password renders the RU length copy (never English), a class-free 8+ one is accepted", async ({
    page,
  }) => {
    // The RU copy (apps/portal/messages/ru.json → errors.validation.passwordTooShort);
    // the English `NewPasswordSchema` message ("password must be at least …") must
    // never reach the rendered field (#200 defect 1).
    const ruPasswordTooShort = "Не менее 8 символов.";
    // A new password failing the only remaining rule — the 8-character floor.
    const shortNewPassword = "short7!";
    // Long enough but class-free: accepted under the length-only policy.
    const classFreeNewPassword = "weakpassword";

    // ── Advance to the complete step via the live BFF reset ack ──────────────
    // The request only needs a well-formed identifier; EARS-16 makes the ack
    // identical regardless of existence, so the stage flips and the new-password
    // field mounts. Selectors stay locale-agnostic (`autocomplete` / `data-testid`).
    await page.goto("/reset");
    await page.locator('input[autocomplete="username"]').fill(newEmail());
    await page.getByTestId("reset-request-submit").click();

    const pw = page.locator('input[autocomplete="new-password"]');
    await expect(pw).toBeVisible();
    await pw.fill(shortNewPassword);
    // Blur to trigger on-touched validation without needing the code field.
    await pw.blur();

    // The policy HINT now carries the same sentence as the too-short error and
    // `<PasswordField>` swaps one into the other in place, so assert the erroring
    // message element itself: it owns `formMessageId` (the last `aria-describedby`
    // token) and `role="alert"` only while the field is invalid.
    await expect(pw).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await pw.getAttribute("aria-describedby")) ?? "";
    const message = page.locator(`#${describedBy.trim().split(/\s+/).pop()}`);
    await expect(message).toHaveAttribute("role", "alert");
    await expect(message).toContainText(ruPasswordTooShort);
    await expect(page.getByText(/password must be at least/i)).toHaveCount(0);

    // Length-only policy (EARS-36): lowercase-only, no digit/symbol — accepted.
    await pw.fill(classFreeNewPassword);
    await pw.blur();
    await expect(pw).not.toHaveAttribute("aria-invalid", "true");
  });

  // 003 EARS-23/24/41/42 (#2556) — re-registration onto an existing account:
  //   EARS-24/42 (screen): new and already-registered addresses alike land on
  //     the one code step — six cells, resend, «← Изменить почту» — never
  //     branching on existence.
  //   EARS-23 (backend): re-registering the SAME (already-verified) email
  //     returns the IDENTICAL pending_verification AND privately sends a CODE
  //     mail: «already registered», «Ваш пароль не изменился», no link.
  //   EARS-41: the code from that mail, typed on the same step, signs in.
  // Live-gated (manual): asserts against REAL Mailpit on the dev-stand. Requires
  // MAILER_SMTP_* configured at the api so the mail actually sends.
  test("003 EARS-23/41/42: duplicate register → the same code step + a code mail (no link) → the code signs the owner in", async ({
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

    // EARS-24 / EARS-42: the one code step — the code field and «← Изменить
    // почту», the same for every visitor.
    await expect(
      page.locator('input[autocomplete="one-time-code"]'),
    ).toBeVisible();
    await expect(page.getByTestId("verify-back")).toBeVisible();

    // Complete verification so the email is now an ALREADY-REGISTERED account.
    const verifyCode = await fetchOtpCode(
      email,
      firstAt,
      NOTIFICATION_SUBJECTS.verifyEmail,
    );
    expect(verifyCode).toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(verifyCode!);
    await waitForAuthenticatedLanding(page);
    // `profile-email` / `logout` live on the /account profile card, so step onto
    // it deliberately — the default post-auth landing is `/webinars` (013 EARS-15).
    await page.goto("/account");
    await page.getByTestId("logout").click();
    // #2488: sign-out lands on the storefront home, the same on both storefronts.
    await page.waitForURL((url) => url.pathname === "/");

    // ── Register #2 (same, already-registered email) ──────────────────────
    await page.goto("/register");
    const dupAt = new Date().toISOString();
    await page.locator('input[autocomplete="email"]').fill(email);
    // A SECOND password: on a verified account that holds one it is ignored.
    await page
      .locator('input[autocomplete="new-password"]')
      .fill(`${livePassword()}-2`);
    await page.getByTestId("register-submit").click();

    // EARS-16: the response is identical — the form still routes to /verify and
    // discloses nothing about existence: the same code step (EARS-42).
    await page.waitForURL(/\/verify/);
    await expect(page.getByTestId("verify-back")).toBeVisible();
    await expect(page.getByText(/уже занят|уже зарегистрирован/i)).toHaveCount(
      0,
    );

    // EARS-23: a CODE mail lands privately in the inbox — «already registered»
    // and the kept password are said only there — under the sign-in subject,
    // with no link of any kind.
    const reRegistration = await fetchMessage(
      email,
      dupAt,
      NOTIFICATION_SUBJECTS.verifyEmailOtp,
    );
    expect(
      reRegistration,
      "the re-registration code mail should reach Mailpit",
    ).toBeTruthy();
    const body = `${reRegistration!.Text}\n${reRegistration!.HTML}`;
    expect(body).toMatch(/уже зарегистрирован/);
    expect(body).toMatch(/Ваш пароль не изменился/);
    expect(body).not.toMatch(/\/login|\/reset|\/verify/);
    const code = reRegistration!.Subject.match(/^([A-Z0-9]{6})\s+—/)?.[1];
    expect(code, "the code leads the subject").toBeTruthy();

    // EARS-41: that code, typed on the same step, signs the owner in.
    await page.locator('input[autocomplete="one-time-code"]').fill(code!);
    await waitForAuthenticatedLanding(page);
    await page.goto("/account");
    await expect(page.getByTestId("profile-email")).not.toBeEmpty();
    await assertNoTokenInClient(page);
  });
});
