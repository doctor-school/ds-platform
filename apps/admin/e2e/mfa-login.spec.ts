import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 011 Verification rows 6 + 7, browser half — the TOTP challenge on login, and
 * the login screen driving the whole arc through the admin tier.
 *
 * The API half (`apps/api/test/auth/mfa-challenge.e2e-spec.ts`) proves the
 * security properties directly against the API: the replay refusal, the
 * nothing-reachable-in-between gate, the byte-identical failure branches, and
 * the lock beating a correct code. This proves the *operator-facing arc* those
 * properties exist to make usable — which is the half a Vitest e2e cannot see:
 * that the password form leads to a challenge card, that a wrong code produces
 * one RU message and leaves the operator exactly where they were, and that a
 * correct one lands them in admin with no second sign-in.
 *
 * It is deliberately a SECOND login: the first one enrols (that arc is
 * `mfa-enrollment.spec.ts`), and only the login after it is a challenge. Testing
 * the challenge without walking through enrollment first would need a
 * hand-seeded factor, and then the secret the operator's authenticator holds
 * would be a fixture rather than the one the product actually issued.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (a MANUAL gate, not CI):
 * `bootstrapAdminSession` provisions a real `platform_admin` against the stand's
 * Zitadel and throws if the `IDP_*` env is absent, so a stray invocation fails
 * fast rather than pretending to pass. Run it against a booted admin app + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test e2e/mfa-login.spec.ts
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/** A TOTP code is single-use within its 30-second step (EARS-6) — ask for the next one. */
const STEP_MS = 30_000;

/** Drive the real login FORM (not a fetch): the screen under test is the product. */
async function signIn(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.getByTestId("login-submit").click();
}

/**
 * Complete the one-time enrollment through the UI and return the shared secret
 * the operator transcribed — the same string their authenticator app holds, so
 * every code this spec submits is derived exactly as a phone would derive it.
 */
async function enrolOnce(
  page: Page,
  credentials: { email: string; password: string },
): Promise<string> {
  await signIn(page, credentials);
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await page
    .getByTestId("mfa-enroll-form")
    .getByRole("textbox")
    .fill(totpCode(secret));
  await page.waitForURL(/\/events/, { timeout: 20_000 });
  return secret;
}

test.describe.configure({ mode: "serial" });

test.describe("011 EARS-6/7 — TOTP challenge on admin login (browser)", () => {
  test("EARS-6: a second login is challenged, a wrong code is refused in RU, and a correct code lands in admin", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    const secret = await enrolOnce(page, { email, password });

    // Log out, then log back in — the arc the spec's closing paragraph describes
    // ("logs out; logs back in; is challenged"). Signing out through the app is
    // the point: it proves the admin-tier logout leaves the operator able to
    // return, rather than stranded.
    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });

    await signIn(page, { email, password });
    // The challenge card, NOT the enrollment card: the factor already exists, so
    // re-offering enrollment would silently replace a live second factor.
    await page.waitForURL(/\/mfa\/challenge/, { timeout: 20_000 });
    await expect(page.getByTestId("mfa-challenge-form")).toBeVisible();
    await expect(page.getByTestId("mfa-qr")).toHaveCount(0);

    // The submit CTA is not a dead control over an empty field (#1191 Stage-B
    // finding): it is disabled until six digits are present.
    await expect(page.getByTestId("mfa-submit")).toBeDisabled();

    // Wrong code → ONE uniform RU message, still on the challenge screen, and the
    // field cleared so the next code goes straight in.
    const field = page.getByTestId("mfa-challenge-form").getByRole("textbox");
    await field.fill("000000");
    await expect(page.getByTestId("mfa-error")).toBeVisible();
    await expect(page.getByTestId("mfa-error")).toContainText(/[А-Яа-я]/);
    await expect(page).toHaveURL(/\/mfa\/challenge/);
    await expect(page.getByTestId("mfa-submit")).toBeDisabled();

    // Every primary-auth POST from here on, so "no second login" is an observed
    // fact rather than an inference from what the DOM happens to show.
    const loginPosts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/admin\/auth\/login$/.test(req.url()))
        loginPosts.push(req.url());
    });

    // A correct code — derived from the secret the operator transcribed, in the
    // NEXT window (the enrollment burned the current one, and a replay must be
    // refused; EARS-6).
    await field.fill(totpCode(secret, Date.now() + STEP_MS));
    await page.waitForURL(/\/events/, { timeout: 20_000 });
    expect(
      loginPosts,
      "a satisfied challenge completes the login in place — no second primary auth",
    ).toEqual([]);

    // And the landing is real admin, not a shell: the admin API answers this
    // browser now.
    const admitted = await page.evaluate(async () => {
      const res = await fetch("/v1/admin/events", { credentials: "include" });
      return res.status;
    });
    expect(admitted).toBe(200);
  });

  test("EARS-6: an admin URL typed during the challenge returns the operator to the challenge, never into admin", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    await enrolOnce(page, { email, password });
    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await signIn(page, { email, password });
    await page.waitForURL(/\/mfa\/challenge/, { timeout: 20_000 });

    // The API refuses the pending reference outright — no admin data reaches the
    // DOM at all…
    const events = await page.evaluate(async () => {
      const res = await fetch("/v1/admin/events", { credentials: "include" });
      return res.status;
    });
    expect(events).toBe(401);

    // …and the app-level route sends the operator BACK to the step they owe,
    // rather than to the login form (which would throw away a live pending
    // authentication and demand the password again).
    await page.goto("/events");
    await expect(page).toHaveURL(/\/mfa\/challenge/);
  });
});
