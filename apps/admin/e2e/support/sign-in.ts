import { type Page } from "@playwright/test";
import { bootstrapAdminSession, type BootstrapResult } from "./admin-session";
import { totpCode } from "./totp";

/**
 * The ONE browser sign-in every `apps/admin/e2e` flow spec uses (#1676).
 *
 * Every flow spec used to carry its own `signInAsAdmin` copy, and each copy drove
 * the arc exactly once: login form → `/mfa/enroll` → TOTP → `/events`. That is a
 * race against Zitadel, not a deterministic sequence. `bootstrapAdminSession`
 * grants the `platform_admin` project role, but the IdP's role projection is
 * eventually consistent, so a login issued inside that window comes back without
 * the role — the admin bounces and the `waitForURL(/\/events/)` at the END of the
 * sequence times out. The failure is not an assertion: it is the sign-in, and
 * because the flow describes are `mode: "serial"`, one lagged login skips the rest
 * of the file. Both narrow specs already wrapped their login in a 4-attempt retry,
 * but only around the `/mfa/enroll` hop — the post-TOTP transition, which is where
 * the lag actually surfaces, was left bare.
 *
 * So the retry here brackets the FULL sequence: a timeout at either hop starts a
 * fresh attempt from `/login`, up to `ATTEMPTS` times. Two consequences of
 * retrying the whole arc are handled explicitly:
 *
 * - The second factor may already exist by the time we come back. A first attempt
 *   that enrolled the factor and then lost the `/events` transition leaves the
 *   account enrolled, so the next login is CHALLENGED (`/mfa/challenge`) instead
 *   of offered enrollment. The secret is carried across attempts and either card
 *   is completed with it.
 * - A TOTP code is single-use within its 30-second step (011 EARS-6), so a code
 *   already submitted is never submitted again — the helper waits out the step
 *   boundary for a fresh one rather than replaying a burnt code.
 *
 * Behaviour is otherwise identical to the copies it replaces: it lands on
 * `/events` with a real `platform_admin` session, or throws.
 */
export const ADMIN_ORIGIN =
  process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** Bounded by the observed projection lag — the narrow specs' proven attempt budget. */
const ATTEMPTS = 4;
/** A TOTP step; a burnt code cannot be replayed before the next one begins. */
const STEP_MS = 30_000;

/**
 * Sign in as a `platform_admin` and land on `/events`, completing the one-time
 * TOTP enrollment (or the challenge, on a retry that already enrolled).
 *
 * @param credentials Reuse an already-bootstrapped account instead of
 *   provisioning a fresh one — the specs that assert against a specific admin
 *   pass the same `BootstrapResult` they seeded their fixtures with.
 */
export async function signInAsAdmin(
  page: Page,
  credentials?: BootstrapResult,
): Promise<void> {
  const { email, password } =
    credentials ?? (await bootstrapAdminSession(ADMIN_ORIGIN));

  /** The enrollment secret, once a `/mfa/enroll` card has surfaced it. */
  let secret: string | undefined;
  /** The last code submitted — never replayed within its own step. */
  let burntCode: string | undefined;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2500);

    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByTestId("login-submit").click();

    try {
      // Either MFA card is a valid landing: enrollment on a first pass, the
      // challenge once an earlier attempt got as far as enrolling the factor.
      await page.waitForURL(/\/mfa\/(enroll|challenge)/, { timeout: 8000 });

      const enrolling = /\/mfa\/enroll/.test(page.url());
      if (enrolling) {
        secret = (await page.getByTestId("mfa-secret").innerText()).trim();
      } else if (!secret) {
        // Challenged with no secret in hand: the account carries a factor this
        // helper never enrolled, so no code can be derived. That is a stand-state
        // problem, not a lag — fail loudly rather than burn the attempt budget.
        throw new Error(
          `${email} is already enrolled in TOTP outside this helper — no secret to answer the challenge with`,
        );
      }

      const code = await freshCode(page, secret, burntCode);
      burntCode = code;
      await page
        .getByTestId(enrolling ? "mfa-enroll-form" : "mfa-challenge-form")
        .getByRole("textbox")
        .fill(code);

      // The hop the local copies left unguarded: the role projection lags the
      // grant, so a login inside that window lands back on `/login` instead.
      await page.waitForURL(/\/events/, { timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt === ATTEMPTS - 1) throw error;
      /* the platform_admin role projection lags the grant — retry */
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
