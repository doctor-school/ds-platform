import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession, totpCode } from "@ds/e2e/admin-events";
import { evidenceShot } from "./support/evidence-shot";

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
  { navigate = true }: { navigate?: boolean } = {},
): Promise<void> {
  // `navigate: false` signs in on the login screen the app itself routed to,
  // keeping the return target it carried (#2782).
  if (navigate) await page.goto("/login");
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

  test("EARS-6: a session dropped by a network change is recovered through the TOTP challenge", async ({
    page,
  }) => {
    // Prod 2026-10-12 (#2822): a VPN toggle moved an admin's IP/24, the session
    // was rejected (`fingerprint_mismatch`), and the way back in is password +
    // challenge. The session is bound to User-Agent + IP/24 + Accept-Language
    // (`computeFingerprint`, apps/api/src/auth/session/session.cookie.ts); a
    // browser cannot move its own IP, so the User-Agent stands in for the same
    // fingerprint input.
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    const secret = await enrolOnce(page, { email, password });

    const userAgent = await page.evaluate(() => navigator.userAgent);
    await page
      .context()
      .setExtraHTTPHeaders({ "user-agent": `${userAgent} network-changed` });

    // The old session no longer opens admin…
    const dropped = await page.evaluate(async () => {
      const res = await fetch("/v1/admin/events", { credentials: "include" });
      return res.status;
    });
    expect(dropped).toBe(401);

    // …the password leads to the CHALLENGE (the factor survives the drop, so no
    // re-enrollment and no new secret)…
    await signIn(page, { email, password });
    await page.waitForURL(/\/mfa\/challenge/, { timeout: 20_000 });
    await expect(page.getByTestId("mfa-qr")).toHaveCount(0);

    // …and the code from the authenticator enrolled before the drop admits, in
    // the NEXT window (the enrollment burned the current one; EARS-6 replay).
    await page
      .getByTestId("mfa-challenge-form")
      .getByRole("textbox")
      .fill(totpCode(secret, Date.now() + STEP_MS));
    await page.waitForURL(/\/events/, { timeout: 20_000 });
    const admitted = await page.evaluate(async () => {
      const res = await fetch("/v1/admin/events", { credentials: "include" });
      return res.status;
    });
    expect(admitted).toBe(200);
  });

  test("#2781/#2782: a deep admin URL opened signed out lands back on itself (with its query) after password + TOTP, and the code field takes the caret", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    const secret = await enrolOnce(page, { email, password });
    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });

    // Signed out, the operator opens a page that is NOT the default landing.
    const deep = "/projects?page=2&q=2782";
    await page.goto(deep);
    await page.waitForURL(/\/login\?/, { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get("to")).toBe(deep);

    await signIn(page, { email, password }, { navigate: false });
    await page.waitForURL(/\/mfa\/challenge\?/, { timeout: 20_000 });

    // #2781: the caret is already in the code field — no click before typing.
    const field = page.getByTestId("mfa-challenge-form").getByRole("textbox");
    await expect(field).toBeFocused();
    await evidenceShot(page, "mfa-challenge-focused");
    await expect(field).toBeFocused();
    await page.keyboard.type(totpCode(secret, Date.now() + STEP_MS));

    // #2782: the landing is the page they came from, query intact — not /events.
    await page.waitForURL((url) => `${url.pathname}${url.search}` === deep, {
      timeout: 20_000,
    });
  });

  test("#2998: a Cyrillic deep URL rides to the code screen encoded once and lands back on itself", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    const secret = await enrolOnce(page, { email, password });
    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });

    // The browser reports this path and query percent-encoded (`%D1%82…`).
    const deep = new URL("/events/тест?q=кардио", ORIGIN);
    const landing = `${deep.pathname}${deep.search}`;
    await page.goto(landing);
    await page.waitForURL(/\/login\?/, { timeout: 20_000 });

    await signIn(page, { email, password }, { navigate: false });
    await page.waitForURL(/\/mfa\/challenge\?/, { timeout: 20_000 });
    // Encoded once: the readable target, so no `%25` (an encoded `%`) in it.
    const carried = new URL(page.url()).search;
    expect(carried).not.toContain("%25");
    expect(new URL(page.url()).searchParams.get("to")).toBe(
      "/events/тест?q=кардио",
    );

    await page
      .getByTestId("mfa-challenge-form")
      .getByRole("textbox")
      .fill(totpCode(secret, Date.now() + STEP_MS));
    await page.waitForURL(
      (url) => `${url.pathname}${url.search}` === landing,
      { timeout: 20_000 },
    );
  });

  test("#2782 security: a hostile ?to= never leaves the admin or skips the second factor", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    const secret = await enrolOnce(page, { email, password });
    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });

    await page.goto(`/login?to=${encodeURIComponent("//evil.example/x")}`);
    await signIn(page, { email, password }, { navigate: false });
    // The password step routes to the challenge it owes — not to `to`, and with
    // the refused target dropped rather than carried.
    await page.waitForURL(/\/mfa\/challenge/, { timeout: 20_000 });
    expect(new URL(page.url()).origin).toBe(new URL(ORIGIN).origin);
    expect(new URL(page.url()).searchParams.get("to")).toBeNull();

    await page
      .getByTestId("mfa-challenge-form")
      .getByRole("textbox")
      .fill(totpCode(secret, Date.now() + STEP_MS));
    await page.waitForURL(
      (url) =>
        url.origin === new URL(ORIGIN).origin && url.pathname === "/events",
      { timeout: 20_000 },
    );
  });

  test("#2782: a session dropped mid-work returns the operator to the page they were on", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    const secret = await enrolOnce(page, { email, password });

    const deep = "/projects?page=2&q=2782";
    await page.goto(deep);
    await expect(page).toHaveURL(/\/projects\?/);

    // The same fingerprint drop as the prod 2026-10-12 case (#2822) above.
    const userAgent = await page.evaluate(() => navigator.userAgent);
    await page
      .context()
      .setExtraHTTPHeaders({ "user-agent": `${userAgent} network-changed` });
    await page.reload();
    await page.waitForURL(/\/login\?/, { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get("to")).toBe(deep);

    await signIn(page, { email, password }, { navigate: false });
    await page.waitForURL(/\/mfa\/challenge\?/, { timeout: 20_000 });
    await page
      .getByTestId("mfa-challenge-form")
      .getByRole("textbox")
      .fill(totpCode(secret, Date.now() + STEP_MS));
    await page.waitForURL((url) => `${url.pathname}${url.search}` === deep, {
      timeout: 20_000,
    });
  });

  test("#2782: a 401 on a data fetch mid-page (no reload) returns the operator to the same page", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    const secret = await enrolOnce(page, { email, password });

    const deep = "/projects?page=2&q=2782";
    await page.goto(deep);
    await expect(page).toHaveURL(/\/projects\?/);
    await expect(page.getByRole("searchbox")).toBeVisible();

    // The session drops while the page stays open; the next list fetch gets
    // the 401, so the target comes from the provider's `onError`, not from a
    // reload through `<Authenticated>`.
    const userAgent = await page.evaluate(() => navigator.userAgent);
    await page
      .context()
      .setExtraHTTPHeaders({ "user-agent": `${userAgent} network-changed` });
    const documentLoads: string[] = [];
    page.on("request", (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame())
        documentLoads.push(req.url());
    });
    // #2998: the refused read is sent once — a 401 is neither retried nor
    // re-sent by a remount of the page while the sign-out runs, so the sign-in
    // screen follows the first refusal.
    const refusedReads: string[] = [];
    page.on("response", (res) => {
      if (/\/v1\/admin\/projects/.test(res.url()) && res.status() === 401)
        refusedReads.push(res.url());
    });
    const refused = page.waitForResponse(
      (res) => /\/v1\/admin\/projects/.test(res.url()) && res.status() === 401,
    );
    await page.getByRole("searchbox").fill("onerror");
    await page.getByRole("searchbox").press("Enter");
    await refused;
    await page.waitForURL(/\/login\?/, { timeout: 20_000 });
    await expect(page.getByTestId("login-submit")).toBeVisible();
    expect(refusedReads).toHaveLength(1);
    expect(documentLoads).toEqual([]);
    expect(new URL(page.url()).searchParams.get("to")).toBe(deep);

    await signIn(page, { email, password }, { navigate: false });
    await page.waitForURL(/\/mfa\/challenge\?/, { timeout: 20_000 });
    await page
      .getByTestId("mfa-challenge-form")
      .getByRole("textbox")
      .fill(totpCode(secret, Date.now() + STEP_MS));
    await page.waitForURL((url) => `${url.pathname}${url.search}` === deep, {
      timeout: 20_000,
    });
  });
});
