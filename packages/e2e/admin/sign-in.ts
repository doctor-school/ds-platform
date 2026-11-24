import { errors, type Page } from "@playwright/test";
import { inputSecret } from "../lib/owned-registration";
import { bootstrapAdminSession, type BootstrapResult } from "./admin-session";
import { totpCode } from "./totp";

export const ADMIN_ORIGIN =
  process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** Allow for the IdP role-projection lag (#1676). */
const ATTEMPTS = 4;
const CONTROL_TIMEOUT = 8_000;
const NAVIGATION_TIMEOUT = 20_000;
/** A TOTP step; a burnt code cannot be replayed before the next one begins. */
const STEP_MS = 30_000;

/**
 * The last code each factor submitted in this worker, across sign-ins. The
 * server refuses a code already used (011 EARS-6) no matter which session used
 * it, so consecutive tests signing the same stage staff account in within one
 * step must not reuse it (#4197).
 */
const burntCodes = new Map<string, string>();

/** `/login` redirects pending and active sessions without mounting the form (#4125). */
async function waitForLoginScreen(page: Page) {
  const screen = await page.waitForFunction(
    () => {
      switch (location.pathname) {
        case "/events":
          return "events";
        case "/mfa/challenge":
          return "challenge";
        case "/mfa/enroll":
          return "enroll";
        case "/login":
          return (
            Boolean(
              document.querySelector("#email")?.getClientRects().length,
            ) && "login"
          );
        default:
          return false;
      }
    },
    undefined,
    { timeout: CONTROL_TIMEOUT },
  );
  try {
    return await screen.jsonValue();
  } finally {
    await screen.dispose();
  }
}

/**
 * Sign in as a `platform_admin` and land on `/events`, completing the one-time
 * TOTP enrollment (or the challenge, on a retry that already enrolled).
 *
 * @param credentials Reuse an already-bootstrapped account instead of
 *   provisioning a fresh one — the specs that assert against a specific admin
 *   pass the same `BootstrapResult` they seeded their fixtures with. A supplied
 *   TOTP secret requires an already-enrolled account, so a stage run can complete
 *   a challenge without touching the account's enrollment.
 */
export async function signInAsAdmin(
  page: Page,
  credentials?: BootstrapResult & { totpSecret?: string },
): Promise<string> {
  const { email, password } =
    credentials ?? (await bootstrapAdminSession(ADMIN_ORIGIN));

  /** The enrollment secret, once a `/mfa/enroll` card has surfaced it. */
  let secret = credentials?.totpSecret;
  let submittedPassword = false;
  let submittedMfa = false;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2500);
    let phase = "opening the login page";
    try {
      await page.goto("/login", {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT,
      });
      phase = "waiting for the login form or its redirect";
      const screen = await waitForLoginScreen(page);
      if (screen === "events") {
        if (submittedMfa && secret) return secret;
        throw new Error(
          "Admin session was already active before this sign-in completed MFA",
        );
      }

      let enrolling = screen === "enroll";
      if (screen === "login") {
        submittedMfa = false;
        phase = "submitting the password form";
        await page.locator("#email").fill(email, { timeout: CONTROL_TIMEOUT });
        const passwordInput = page.locator("#password");
        if (credentials?.totpSecret) {
          await inputSecret(passwordInput, password, {
            timeout: CONTROL_TIMEOUT,
          });
        } else {
          await passwordInput.fill(password, { timeout: CONTROL_TIMEOUT });
        }
        await page
          .getByTestId("login-submit")
          .click({ timeout: CONTROL_TIMEOUT });
        submittedPassword = true;
        phase = "waiting for the MFA screen";
        await page.waitForURL(
          ({ pathname }) =>
            pathname === "/mfa/challenge" || pathname === "/mfa/enroll",
          { waitUntil: "domcontentloaded", timeout: CONTROL_TIMEOUT },
        );
        enrolling = new URL(page.url()).pathname === "/mfa/enroll";
      }
      if (enrolling) {
        if (credentials?.totpSecret || !submittedPassword) {
          throw new Error("Admin sign-in reached unexpected MFA enrollment");
        }
        phase = "reading the newly enrolled factor";
        secret = (
          await page
            .getByTestId("mfa-secret")
            .innerText({ timeout: CONTROL_TIMEOUT })
        ).trim();
      } else if (!secret) {
        throw new Error(
          "Admin account is already enrolled in TOTP outside this helper — no secret to answer the challenge with",
        );
      }

      phase = "answering the MFA prompt";
      const code = await freshCode(page, secret, burntCodes.get(secret));
      burntCodes.set(secret, code);
      const codeInput = page
        .getByTestId(enrolling ? "mfa-enroll-form" : "mfa-challenge-form")
        .getByRole("textbox");
      if (credentials?.totpSecret) {
        await inputSecret(codeInput, code, { timeout: CONTROL_TIMEOUT });
      } else {
        await codeInput.fill(code, { timeout: CONTROL_TIMEOUT });
      }
      submittedMfa = true;

      phase = "waiting for the events page after MFA";
      await page.waitForURL(({ pathname }) => pathname === "/events", {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT,
      });
      return secret;
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
      if (attempt === ATTEMPTS - 1) {
        throw new Error(
          `Admin sign-in timed out while ${phase} (attempt ${ATTEMPTS})`,
          { cause: error },
        );
      }
    }
  }

  throw new Error("admin login did not reach /events");
}

/**
 * A code that has not been submitted yet. Within a single 30-second step the
 * generator returns the same six digits, and the server refuses a replay, so wait
 * out the boundary rather than hand the challenge a code it already rejected.
 */
async function freshCode(
  page: Page,
  secret: string,
  burntCode: string | undefined,
): Promise<string> {
  let code = totpCode(secret);
  const deadline = Date.now() + STEP_MS + 2_000;
  while (code === burntCode && Date.now() < deadline) {
    await page.waitForTimeout(1_000);
    code = totpCode(secret);
  }
  return code;
}
