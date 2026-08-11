import { expect, test, type Page, type Route } from "@playwright/test";

// The catalog is the copy's single source: an assertion typed by hand here would
// pass while the screen showed something else. Playwright loads this spec as real
// ESM, so the JSON import carries the required attribute.
import ru from "../messages/ru.json" with { type: "json" };

/**
 * 011 EARS-5/6/7 + #1213 — what the two MFA screens tell an operator when the IdP
 * is DOWN rather than when their code is wrong.
 *
 * The API answers `IdpUnavailableError` with an honest 503 on all three MFA routes
 * (#1212) and spends no attempt budget doing it. Before this spec the admin client
 * folded that 503 into the uniform refusal, so an operator holding a CORRECT code
 * was told «Код не подошёл» and sent to re-check a phone clock that was fine. What
 * has to be proven is a DISTINCTION between two rendered states, which is exactly
 * the assertion a unit test cannot make: the outage alert present AND the wrong-code
 * alert absent, on both screens.
 *
 * **Stand-free by construction.** Every `/v1/admin/auth/*` call is fulfilled by
 * `page.route`, so this drives the real screens in a real browser with NO api, no
 * Postgres and no Zitadel — a 503 from a live IdP is not something a stand can be
 * asked to produce on demand, and faking it at the wire is the only honest way to
 * reach the branch. It therefore needs only a booted admin app:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 \
 *   pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/mfa-outage.spec.ts
 *
 * Its stand-gated siblings in this directory prove the arcs against real
 * infrastructure; this one proves the failure copy the infrastructure cannot
 * reliably emit.
 */
const CODE = "123456";

const OFFER = {
  secret: "JBSWY3DPEHPK3PXPJBSWY3DP",
  provisioningUri:
    "otpauth://totp/Doctor.School:admin@doctor.school?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Doctor.School&digits=6&period=30",
  issuer: "Doctor.School",
};

interface AuthStub {
  /** What `/v1/admin/auth/state` reports (the challenge screen's mount guard). */
  state?: "mfa_pending_challenge" | "mfa_pending_enrollment";
  /** Status for `mfa/enroll/start` — 200 serves {@link OFFER}. */
  start?: number;
  /** Status for `mfa/enroll/verify` and `mfa/verify`. */
  verify?: number;
}

/** Fulfil the admin-auth surface in the browser: no api, no IdP, no stand. */
async function stubAdminAuth(page: Page, stub: AuthStub): Promise<void> {
  await page.route("**/v1/admin/auth/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/state")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: stub.state ?? "mfa_pending_challenge" }),
      });
    }
    if (path.endsWith("/mfa/enroll/start")) {
      const status = stub.start ?? 200;
      return route.fulfill({
        status,
        contentType: "application/json",
        body: status === 200 ? JSON.stringify(OFFER) : "",
      });
    }
    const status = stub.verify ?? 200;
    return route.fulfill({
      status,
      contentType: "application/json",
      body: status === 200 ? "{}" : "",
    });
  });
}

/**
 * Type the six digits into the slotted OTP field the way an operator does. The
 * sixth digit auto-submits (`OtpField.onComplete`), so no button click follows —
 * that is the real product path, and it is why the submit button's post-failure
 * state is a meaningful assertion rather than a formality.
 */
async function enterCode(
  page: Page,
  form: "mfa-enroll-form" | "mfa-challenge-form",
): Promise<void> {
  await page.getByTestId(form).getByRole("textbox").fill(CODE);
}

test.describe("MFA challenge — IdP outage", () => {
  test("EARS-6: a 503 on verify shows the outage warning, not a wrong-code verdict", async ({
    page,
  }) => {
    await stubAdminAuth(page, { state: "mfa_pending_challenge", verify: 503 });
    await page.goto("/mfa/challenge");
    await enterCode(page, "mfa-challenge-form");

    const outage = page.getByTestId("mfa-outage");
    await expect(outage).toBeVisible();
    await expect(outage).toContainText(ru.mfaChallenge.errorOutage);
    // The distinction IS the deliverable: the wrong-code alert must be absent.
    await expect(page.getByTestId("mfa-error")).toHaveCount(0);
    // Stage-A: no cooldown, no countdown — the operator can retry immediately,
    // with the code they already typed (it was never checked).
    await expect(page.getByTestId("mfa-submit")).toBeEnabled();
  });

  test("EARS-7: a 401 on verify still shows the one uniform wrong-code message", async ({
    page,
  }) => {
    await stubAdminAuth(page, { state: "mfa_pending_challenge", verify: 401 });
    await page.goto("/mfa/challenge");
    await enterCode(page, "mfa-challenge-form");

    await expect(page.getByTestId("mfa-error")).toContainText(
      ru.mfaChallenge.errorGeneric,
    );
    await expect(page.getByTestId("mfa-outage")).toHaveCount(0);
  });

  test("EARS-7: a 429 on verify still shows the throttling message", async ({
    page,
  }) => {
    await stubAdminAuth(page, { state: "mfa_pending_challenge", verify: 429 });
    await page.goto("/mfa/challenge");
    await enterCode(page, "mfa-challenge-form");

    await expect(page.getByTestId("mfa-error")).toContainText(
      ru.mfaChallenge.errorThrottled,
    );
    await expect(page.getByTestId("mfa-outage")).toHaveCount(0);
  });
});

test.describe("MFA enrollment — IdP outage", () => {
  test("EARS-5: a 503 on the offer keeps the operator here with the outage warning", async ({
    page,
  }) => {
    await stubAdminAuth(page, { state: "mfa_pending_enrollment", start: 503 });
    await page.goto("/mfa/enroll");

    const outage = page.getByTestId("mfa-outage");
    await expect(outage).toBeVisible();
    await expect(outage).toContainText(ru.mfaEnroll.errorOutage);
    // Not bounced to /login: nothing about the credentials is wrong, and a second
    // login would hit the same downed IdP at the password step.
    await expect(page).toHaveURL(/\/mfa\/enroll/);
  });

  test("EARS-5: a 503 on the enrollment verify shows the outage warning, not a wrong-code verdict", async ({
    page,
  }) => {
    await stubAdminAuth(page, { state: "mfa_pending_enrollment", verify: 503 });
    await page.goto("/mfa/enroll");
    await expect(page.getByTestId("mfa-secret")).toBeVisible();
    await enterCode(page, "mfa-enroll-form");

    const outage = page.getByTestId("mfa-outage");
    await expect(outage).toBeVisible();
    await expect(outage).toContainText(ru.mfaEnroll.errorOutage);
    await expect(page.getByTestId("mfa-error")).toHaveCount(0);
    await expect(page.getByTestId("mfa-submit")).toBeEnabled();
  });

  test("EARS-7: a 401 on the enrollment verify still shows the uniform wrong-code message", async ({
    page,
  }) => {
    await stubAdminAuth(page, { state: "mfa_pending_enrollment", verify: 401 });
    await page.goto("/mfa/enroll");
    await expect(page.getByTestId("mfa-secret")).toBeVisible();
    await enterCode(page, "mfa-enroll-form");

    await expect(page.getByTestId("mfa-error")).toContainText(
      ru.mfaEnroll.errorGeneric,
    );
    await expect(page.getByTestId("mfa-outage")).toHaveCount(0);
  });
});
