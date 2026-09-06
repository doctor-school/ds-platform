import { test, expect, type Page, type Request } from "@playwright/test";

/**
 * 021 EARS-19 (#1558) — the browser tier of the bot-protection wiring on the
 * doctor registration door and the code-resend surface it opens.
 *
 * Backend-free tier (`playwright.ci.config.ts`): the `/v1/*` commands are
 * intercepted at the network boundary, which is what makes the REQUEST itself
 * assertable — the body the enabled submit builds, and the fact that a resend is
 * a real round trip rather than a re-render.
 *
 * TOKENLESS BY CONSTRUCTION, and deliberately so. The CI build carries no
 * `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`, so `<BotProtectionField>` renders no
 * provider widget and resumes the pending action without a token — exactly the
 * state the backend guard no-ops in when the provider is disabled, and exactly
 * the dev-stand default. That is the honest browser assertion: the challenge
 * MECHANISM is mounted and the command flows through it. Where the token lands
 * when there IS one (`x-smartcaptcha-token`, header not body) is pinned one tier
 * down in `apps/doctor/lib/storefront-auth-client.test.ts`, and the guard
 * refusing a submission without it in
 * `apps/api/test/storefront/doctor-register-bot-protection.e2e-spec.ts`. A
 * third-party challenge iframe is not something this tier can drive at all, so
 * asserting it here would mean faking the provider — and then asserting the fake.
 * The challenge load-failure path (EARS-19.6) is covered by the block unit test,
 * `packages/design-system/src/blocks/smart-captcha.test.tsx`.
 */
const REGISTER_ROUTE = "**/v1/storefront/doctor/register";
const RESEND_ROUTE = "**/v1/auth/verify/resend";
const VERIFY_ROUTE = "**/v1/auth/verify";

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";

/** Tick a consent through its label — the checkbox primitive own hit area. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

/** Fill the door to the point where the command is reachable. */
async function fillRegistration(page: Page) {
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
}

/** The enumeration-safe registration answer — identical for every address. */
async function acceptRegistration(page: Page) {
  await page.route(REGISTER_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending_verification" }),
    }),
  );
}

function body(request: Request): Record<string, unknown> {
  return JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
}

test.describe("021 EARS-19: bot protection on the registration and resend forms", () => {
  test("021 EARS-19.1: the challenge is mounted and the submit is LIVE once the stated conditions are met", async ({
    page,
  }) => {
    await page.goto("/register");

    const submit = page.getByTestId("register-submit");
    // Before the access conditions: disabled WITH its reason, unchanged EARS-12.
    await expect(submit).toBeDisabled();
    await expect(page.getByTestId("register-submit-reason")).toBeVisible();

    await fillRegistration(page);

    // The whole point of the clause: the door stops waiting. The challenge is
    // invisible and runs inside the submit, so it is not a stated obstacle and
    // the reason line is ABSENT rather than empty.
    await expect(submit).toBeEnabled();
    await expect(page.getByTestId("register-submit-reason")).toHaveCount(0);
    // The build-note reason this Issue removes must be nowhere on the surface.
    await expect(
      page.getByText("Защита от ботов подключается"),
      "the pending-wiring reason is gone, not merely hidden",
    ).toHaveCount(0);
    // No provider widget without a site key — and no placeholder standing in
    // for one either.
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("021 EARS-19.2: the submitted command carries both access consents and the EARS-4 declaration", async ({
    page,
  }) => {
    await acceptRegistration(page);
    await page.goto("/register");
    await fillRegistration(page);

    const [request] = await Promise.all([
      page.waitForRequest(REGISTER_ROUTE),
      page.getByTestId("register-submit").click(),
    ]);

    const payload = body(request);
    expect(payload.email).toBe(EMAIL);
    expect(payload.medicalWorkerDeclaration).toBe(true);
    const purposes = (
      payload.consent as { purpose: string; version: string }[]
    ).map((entry) => entry.purpose);
    expect(purposes, "the granted access condition travels").toContain(
      "partner-data-sharing",
    );
    // EARS-7 — an ungranted optional purpose is ABSENT, never granted: false.
    expect(
      purposes,
      "the untouched marketing opt-in produces no row",
    ).not.toContain("marketing-communications");
    // The declaration is derived server-side from the flag, so the array must
    // not carry a second, untrusted claim about the same tick.
    expect(purposes).not.toContain("medical-worker-declaration");
  });

  test("021 EARS-19.2: a ticked marketing opt-in adds its purpose, and only then", async ({
    page,
  }) => {
    await acceptRegistration(page);
    await page.goto("/register");
    await fillRegistration(page);
    await tick(page, "register-marketing");

    const [request] = await Promise.all([
      page.waitForRequest(REGISTER_ROUTE),
      page.getByTestId("register-submit").click(),
    ]);

    const purposes = (body(request).consent as { purpose: string }[]).map(
      (entry) => entry.purpose,
    );
    expect(purposes).toContain("marketing-communications");
  });

  for (const [label, code, statement] of [
    [
      "rejected",
      "BOT_PROTECTION_REJECTED",
      "Проверка истекла или не пройдена. Подтвердите ещё раз.",
    ],
    ["required", "BOT_PROTECTION_REQUIRED", "Подтвердите, что вы не робот."],
  ] as const) {
    test(`021 EARS-19.4: a ${label} challenge is stated at FORM level, never as a field error`, async ({
      page,
    }) => {
      await page.route(REGISTER_ROUTE, (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ message: "captcha", code }),
        }),
      );
      await page.goto("/register");
      await fillRegistration(page);
      await page.getByTestId("register-submit").click();

      // The 003 catalog statement, verbatim — 021 invents no captcha copy.
      await expect(page.getByTestId("register-captcha-error")).toHaveText(
        statement,
      );
      // Not a field error: nothing the doctor typed is wrong, so no control
      // may be marked invalid by a challenge outcome.
      await expect(
        page.locator('[aria-invalid="true"]'),
        "a challenge failure marks no field invalid",
      ).toHaveCount(0);
      // And the door is not a dead end — the submit stays live for a retry.
      await expect(page.getByTestId("register-submit")).toBeEnabled();
    });
  }

  test("021 EARS-19.5: a successful submit opens the confirmation state, whose resend is protected by the same challenge", async ({
    page,
  }) => {
    // The 003 resend control opens INSIDE its cooldown — a code has just been
    // sent, so the countdown is already running when the state mounts. Waiting
    // it out is the honest assertion (the alternative is asserting a shortened
    // fake), and it costs more than the default per-test budget.
    test.setTimeout(90_000);
    await acceptRegistration(page);
    await page.route(RESEND_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "resend_requested" }),
      }),
    );
    await page.goto("/register");
    await fillRegistration(page);
    await page.getByTestId("register-submit").click();

    // No dead end: a command the server accepted always lands somewhere.
    await expect(page.getByTestId("verify-submit")).toBeVisible();
    await expect(page.locator("h1")).toHaveText("Проверьте почту");
    // The form is gone, so the door cannot be submitted twice.
    await expect(page.getByTestId("registration-form")).toHaveCount(0);

    // EARS-19 «every verification-code resend»: a real round trip through the
    // @BotProtected resend route, not a re-render.
    const resend = page.getByTestId("verify-resend");
    await expect(resend, "the cooldown that opened with the state runs out").toBeEnabled(
      { timeout: 45_000 },
    );
    const [request] = await Promise.all([
      page.waitForRequest(RESEND_ROUTE),
      resend.click(),
    ]);
    expect(body(request).identifier).toBe(EMAIL);
    // The acknowledgement is conditionally phrased — identical for a
    // registrant, a stranger and an already-verified owner (003 EARS-16).
    await expect(page.getByTestId("verify-resend-notice")).toContainText(
      "Если регистрация ещё не подтверждена",
    );
  });

  test("021 EARS-19.5: the confirmation state confirms the code through the shipped 003 route", async ({
    page,
  }) => {
    await acceptRegistration(page);
    await page.route(VERIFY_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "verified" }),
      }),
    );
    await page.goto("/register");
    await fillRegistration(page);
    await page.getByTestId("register-submit").click();
    await expect(page.getByTestId("verify-submit")).toBeVisible();

    const [request] = await Promise.all([
      page.waitForRequest(VERIFY_ROUTE),
      // The slotted OTP field auto-submits on completion (#175), so filling
      // it IS the submit — the same way the portal drives its code fields.
      page.locator('input[autocomplete="one-time-code"]').fill("ABC123"),
    ]);
    expect(body(request)).toEqual({ email: EMAIL, code: "ABC123" });

    await expect(page.getByTestId("verify-succeeded")).toBeVisible();
  });
});
