import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 011 Verification rows 4 + 5, browser half — the forced-enrollment screen.
 *
 * The API half (`apps/api/test/auth/mfa-enrollment-gate.e2e-spec.ts` +
 * `mfa-enroll.e2e-spec.ts`) proves the gate and the in-place upgrade against the
 * API directly. This proves the operator-facing arc the owner approved at Stage A:
 * a factor-less `platform_admin` completes primary auth, is put in front of the
 * enrollment card, cannot reach an admin resource by typing its URL, transcribes
 * the secret, and — on a correct code — has `__Host-ds_admin_session` issued
 * **without a second login** (LD-1). Plus the wrong-code branch, which must leave
 * them exactly where they were with one uniform RU message.
 *
 * The EARS-5 landing is now the REAL one: #1192 moved `authProvider.check` onto
 * the 011 admin tier (`GET /v1/admin/auth/state`), so a correct first code lands
 * the operator in `/events` with no second sign-in. This spec previously asserted
 * the interim `/login?to=%2Fevents` bounce — an honest record of a client that
 * could not see the session it had just been issued — and that assertion is
 * inverted here rather than deleted, because the bounce reappearing IS the
 * regression this test now guards.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` (a MANUAL gate, not CI): the
 * bootstrap provisions a real `platform_admin` against the stand's Zitadel and
 * throws if the `IDP_*` env is absent, so a stray invocation fails fast rather
 * than pretending to pass. Run it against a booted admin app + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test e2e/mfa-enrollment.spec.ts
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

/**
 * Complete primary auth at the ADMIN origin inside the browser context, so the
 * short-lived `__Host-ds_admin_pending` cookie is set on the origin the screen
 * runs at — the same call the login form itself makes since #1192, issued
 * directly so the enrollment assertions do not depend on the form's own
 * behaviour (`mfa-login.spec.ts` owns that). The pending reference itself is
 * `HttpOnly`; nothing here can read it, which is the point.
 */
async function primaryAuth(
  page: Page,
  credentials: { email: string; password: string },
): Promise<string> {
  await page.goto("/login");
  return page.evaluate(async (creds) => {
    const res = await fetch("/v1/admin/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: creds.email,
        password: creds.password,
      }),
    });
    if (!res.ok) throw new Error(`admin primary auth failed: ${res.status}`);
    return ((await res.json()) as { state: string }).state;
  }, credentials);
}

test.describe.configure({ mode: "serial" });

test.describe("011 EARS-4/5 — forced TOTP enrollment (admin)", () => {
  test("EARS-4: a factor-less platform_admin is held at the enrollment screen and cannot reach an admin resource", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    expect(await primaryAuth(page, { email, password })).toBe(
      "mfa_pending_enrollment",
    );

    await page.goto("/mfa/enroll");
    await expect(page.getByTestId("mfa-qr")).toBeVisible();

    // Direct URL entry to an admin resource: the API refuses the pending
    // reference, so no admin data reaches the DOM and no admin row renders.
    const events = await page.evaluate(async () => {
      const res = await fetch("/v1/admin/events", { credentials: "include" });
      return { status: res.status, body: await res.text() };
    });
    expect(events.status).toBe(401);
    expect(events.body).not.toContain("\"items\"");
    // …and the app-level route is not a way around it either: with no admin
    // session the events surface bounces BACK to the enrollment step rather than
    // painting a shell an operator could mistake for admitted access. It bounces
    // to `/mfa/enroll` (not `/login`) since #1192 — throwing away a live pending
    // authentication would make the operator re-enter their password to reach a
    // gate they are already standing in front of.
    await page.goto("/events");
    await expect(page).toHaveURL(/\/mfa\/enroll/);
  });

  test("EARS-5: the offer is scannable AND transcribable, a wrong code is refused in RU, and a correct code lands the operator in admin with no second login", async ({
    page,
  }) => {
    const { email, password } = await bootstrapAdminSession(ORIGIN);
    await primaryAuth(page, { email, password });

    await page.goto("/mfa/enroll");
    // Scannable: a real QR with a text alternative (EARS-12 — never image-only).
    const qr = page.getByTestId("mfa-qr");
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute("role", "img");
    expect(await qr.getAttribute("aria-label")).toBeTruthy();

    // Transcribable: the same secret as selectable text an operator can type.
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

    // Wrong code → one uniform RU message, still on the enrollment screen, factor
    // unconfirmed.
    await page.getByTestId("mfa-enroll-form").getByRole("textbox").fill("000000");
    await expect(page.getByTestId("mfa-error")).toBeVisible();
    await expect(page.getByTestId("mfa-error")).toContainText(/[А-Яа-я]/);
    await expect(page).toHaveURL(/\/mfa\/enroll/);

    // Every primary-auth POST from here on, so "no second login" is an observed
    // fact rather than an inference from what the DOM happens to show.
    const loginPosts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/auth\/login$/.test(req.url()))
        loginPosts.push(req.url());
    });

    // A correct code — derived from the rendered secret exactly as the operator's
    // authenticator app would — completes the login IN PLACE (LD-1).
    await page
      .getByTestId("mfa-enroll-form")
      .getByRole("textbox")
      .fill(totpCode(secret));

    // LD-1 delivered end to end: the operator lands IN admin. The bounce this
    // line replaces (`/login?to=%2Fevents`) is the #1192 regression signal — it
    // meant the client could not see the session it had just been issued.
    await page.waitForURL(/\/events/, { timeout: 20_000 });

    // The durable truth underneath that landing: the enrollment verify DID issue
    // `__Host-ds_admin_session`, and it authenticates the admin API right now —
    // read from the landed-on page, so the cookie is proven live after the
    // redirect, not merely at the moment of the response.
    const admitted = await page.evaluate(async () => {
      const res = await fetch("/v1/admin/events", { credentials: "include" });
      return res.status;
    });
    expect(
      admitted,
      "the enrollment verify must issue a live __Host-ds_admin_session",
    ).toBe(200);

    // LD-1: nothing in this flow asked for credentials a second time.
    expect(
      loginPosts,
      "a successful enrollment verify completes the login in place — no second primary auth",
    ).toEqual([]);
  });
});
