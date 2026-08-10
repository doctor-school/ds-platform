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
 * the secret, and — on a correct code — lands in admin **without a second login**
 * (LD-1). Plus the wrong-code branch, which must leave them exactly where they
 * were with one uniform RU message.
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
 * runs at — exactly what the login form will do once the admin app's login is
 * moved onto the admin tier (the wiring that lands with the challenge screen,
 * #1192). The pending reference itself is `HttpOnly`; nothing here can read it,
 * which is the point.
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
    // session the events surface bounces to the login form rather than painting a
    // shell an operator could mistake for admitted access.
    await page.goto("/events");
    await expect(page).toHaveURL(/\/login/);
  });

  test("EARS-5: the offer is scannable AND transcribable, a wrong code is refused in RU, and a correct code lands in admin with no second login", async ({
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

    // A correct code — derived from the rendered secret exactly as the operator's
    // authenticator app would — completes the login IN PLACE (LD-1).
    await page
      .getByTestId("mfa-enroll-form")
      .getByRole("textbox")
      .fill(totpCode(secret));
    await page.waitForURL(/\/events/, { timeout: 20_000 });
    await expect(page.getByTestId("mfa-enroll-form")).toBeHidden();
  });
});
