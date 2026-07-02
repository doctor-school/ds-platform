import { test, expect, type Page } from "@playwright/test";

/**
 * Portal per-channel identifier validation + phone mask (#192).
 *
 * UNGATED, backend-free tier. Unlike `auth-journeys.e2e.spec.ts` (the live-Zitadel
 * journey suite, `test.skip`ped unless the dev-stand OIDC env is present), this
 * spec exercises ONLY client-side form validation: a malformed identifier is
 * rejected by the RHF resolver before any network call, so it needs no api /
 * Zitadel / Mailpit — just a running portal. It therefore runs against whatever
 * `baseURL` the Playwright config points at (default `http://localhost:3001` for
 * local dev) with NO env gate.
 *
 * The contract under test (issue #192): the login + OTP-login identifier boxes
 * must reject input that is neither a valid email nor an E.164 phone (e.g. the bare
 * numeric `99545545445`) with a clear, channel-appropriate error, and the SMS
 * channel must mask free-typing into an E.164-valid value. The BFF identifier
 * contract is unchanged (`@ds/schemas` stays loose) — this is purely the portal-UX
 * guard. Selectors are locale-agnostic (`data-testid` / `autocomplete` / ARIA), so
 * the Russian copy (#177) does not break them.
 *
 * Traceability (ADR-0006 §4 — a `user-facing` requirement is verified by Playwright
 * E2E): these ungated client-side checks ARE the requirement-level coverage for
 * EARS-22 (each field applies its data-type validation rule + input mask before
 * submit) and EARS-21 (malformed input surfaces localized RU copy from the typed
 * message catalog, never baked English) — the titles below carry those ids.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";

// A bare numeric string — the exact bug report: neither an email nor an E.164
// phone (no leading `+`), so it must be rejected in every identifier box.
const BAD_NUMERIC = "99545545445";
const VALID_EMAIL = "doctor@example.com";
const VALID_PHONE = "+79991234567";
const VALID_PASSWORD = "sufficiently-long-pw";
// A creation password that fails the #147 complexity baseline (no upper/digit/
// symbol) — the /register + /reset-complete "new password" must flag it.
const WEAK_NEW_PASSWORD = "weakpassword";
// The RU complexity copy (apps/portal/messages/ru.json → errors.validation.
// passwordComplexity). The English baked into `@ds/schemas` `NewPasswordSchema`
// ("password must include …") must NEVER reach the rendered field (#200).
const RU_PASSWORD_COMPLEXITY =
  "Пароль должен содержать заглавную и строчную буквы, цифру и спецсимвол.";

/** The identifier input is flagged invalid (aria-invalid) when validation fails. */
async function expectInvalid(
  input: ReturnType<Page["locator"]>,
): Promise<void> {
  await expect(input).toHaveAttribute("aria-invalid", "true");
}

async function expectValidOrAbsent(
  input: ReturnType<Page["locator"]>,
): Promise<void> {
  // RHF leaves aria-invalid="false" on a field that passed its resolver.
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
}

test.describe("EARS-22: portal identifier validation + mask (client-side, ungated) (#192)", () => {
  test.use({ baseURL: BASE });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("password login: rejects a bare-numeric identifier, accepts a valid email", async ({
    page,
  }) => {
    const id = page.locator('input[autocomplete="username"]');
    const pw = page.locator('input[autocomplete="current-password"]');

    // ── reject ──────────────────────────────────────────────────────────
    await id.fill(BAD_NUMERIC);
    await pw.fill(VALID_PASSWORD);
    await page.getByTestId("password-login-submit").click();
    // No navigation off /login, and the field is flagged invalid.
    await expect(page).toHaveURL(/\/login/);
    await expectInvalid(id);

    // ── accept ──────────────────────────────────────────────────────────
    // A valid email passes the resolver (the submit will then fail the network
    // call against no/real backend — but the FIELD is no longer invalid, which is
    // all this client-side guard asserts).
    await id.fill(VALID_EMAIL);
    await pw.fill(VALID_PASSWORD);
    await page.getByTestId("password-login-submit").click();
    await expectValidOrAbsent(id);
  });

  test("password login: accepts a valid E.164 phone identifier", async ({
    page,
  }) => {
    const id = page.locator('input[autocomplete="username"]');
    const pw = page.locator('input[autocomplete="current-password"]');
    await id.fill(VALID_PHONE);
    await pw.fill(VALID_PASSWORD);
    await page.getByTestId("password-login-submit").click();
    await expectValidOrAbsent(id);
  });

  test("OTP email channel: rejects a bare-numeric identifier, accepts a valid email", async ({
    page,
  }) => {
    await page.getByTestId("login-method-otp").click();
    await page.getByTestId("otp-channel-email").click();
    const id = page.getByTestId("otp-identifier");

    await id.fill(BAD_NUMERIC);
    await page.getByTestId("otp-send").click();
    await expectInvalid(id);

    await id.fill(VALID_EMAIL);
    await page.getByTestId("otp-send").click();
    await expectValidOrAbsent(id);
  });

  test("OTP SMS channel: masks free-typing to E.164 and accepts a valid phone", async ({
    page,
  }) => {
    await page.getByTestId("login-method-otp").click();
    await page.getByTestId("otp-channel-sms").click();
    const id = page.getByTestId("otp-identifier");

    // The phone mask coerces a RU domestic `8…` number into `+7…` as the user
    // types — the stored value must be the E.164 form, never the raw keystrokes.
    await id.fill("89991234567");
    await expect(id).toHaveValue("+79991234567");

    // …but the RU `8→7` convenience is gated to the domestic 11-digit length, so an
    // international number that starts with `8` but is NOT 11 digits (e.g. a 12-digit
    // Japan mobile `+81 90…`) passes through untouched and is NOT corrupted into
    // `+71…`. (An 11-digit `8…` is genuinely ambiguous and still reads as RU domestic
    // — that collision is an accepted limit of the length heuristic.)
    await id.fill("+81 90 1234 5678");
    await expect(id).toHaveValue("+819012345678");

    // A bare numeric (no country logic) is masked to a `+`-prefixed value but, if
    // too short / malformed, still fails the E.164 resolver on submit.
    await id.fill("12");
    await page.getByTestId("otp-send").click();
    await expectInvalid(id);

    // A full valid phone passes.
    await id.fill(VALID_PHONE);
    await expect(id).toHaveValue(VALID_PHONE);
    await page.getByTestId("otp-send").click();
    await expectValidOrAbsent(id);
  });

  test("OTP SMS channel: rejects an email (wrong channel shape)", async ({
    page,
  }) => {
    await page.getByTestId("login-method-otp").click();
    await page.getByTestId("otp-channel-sms").click();
    const id = page.getByTestId("otp-identifier");

    // The mask strips the non-digits of an email down to its digits, so an email
    // can never satisfy the SMS channel — it is rejected.
    await id.fill(VALID_EMAIL);
    await page.getByTestId("otp-send").click();
    await expectInvalid(id);
  });
});

/**
 * #196 — the `/reset` identifier had NO validation/mask: the exact #192 defect on
 * an adjacent surface. #197 migrates it onto the shared `<IdentifierField>`, so the
 * same union guard (email OR E.164 phone, unmasked like the login-password box —
 * `/reset` is not a phone-only channel) now applies. Same ungated, backend-free
 * tier: the resolver rejects a bare-numeric identifier before any network call.
 */
test.describe("EARS-22: portal /reset identifier validation (client-side, ungated) (#196)", () => {
  test.use({ baseURL: BASE });

  test.beforeEach(async ({ page }) => {
    await page.goto("/reset");
  });

  test("reset request: rejects a bare-numeric identifier, accepts email + phone", async ({
    page,
  }) => {
    const id = page.locator('input[autocomplete="username"]');

    // ── reject the bare numeric (#196 bug report) ───────────────────────
    await id.fill(BAD_NUMERIC);
    await page.getByTestId("reset-request-submit").click();
    await expect(page).toHaveURL(/\/reset/);
    await expectInvalid(id);

    // ── accept a valid email ─────────────────────────────────────────────
    await id.fill(VALID_EMAIL);
    await expectValidOrAbsent(id);

    // ── accept a valid E.164 phone ───────────────────────────────────────
    // The reset identifier is the union box (like login-password), and it is
    // UNMASKED — only the OTP sms channel masks. So a typed `+7…` phone is left
    // exactly as typed and passes the union resolver.
    await id.fill(VALID_PHONE);
    await expect(id).toHaveValue(VALID_PHONE);
    await page.getByTestId("reset-request-submit").click();
    await expectValidOrAbsent(id);
  });
});

/**
 * #200 — two creation-password / on-blur quality gaps surfaced by the #197/#199
 * migration, on the SAME ungated, backend-free tier (client-side RHF validation,
 * no api/Zitadel/Mailpit needed):
 *
 *  1. A weak NEW password on `/register` (and `/reset` complete) must render the RU
 *     `errors.validation.passwordComplexity` copy — NOT the English baked into the
 *     `@ds/schemas` `NewPasswordSchema` `.regex()` message. In zod v4 a schema-level
 *     message outranks the contextual error map the localized resolver installs, so
 *     the leak only disappears once the portal field schema composes the bare
 *     complexity regex WITHOUT a message (issue #200, defect 1).
 *  2. The auth forms must validate on BLUR (`mode: "onTouched"`), so an obviously
 *     malformed email is flagged before the user clicks submit (defect 2).
 *
 * Selectors stay locale-agnostic where possible (`data-testid` / `autocomplete`),
 * but the RU-copy assertion is intentionally exact — proving the localized string
 * (not the English) is what renders is the whole point of defect 1.
 */
test.describe("EARS-22: creation-password RU copy + on-blur validation (client-side, ungated) (#200)", () => {
  test.use({ baseURL: BASE });

  test("EARS-21/22: a weak new password renders the RU complexity copy from the message catalog, never the baked English", async ({
    page,
  }) => {
    await page.goto("/register");
    const pw = page.locator('input[autocomplete="new-password"]');

    await pw.fill(WEAK_NEW_PASSWORD);
    await page.getByTestId("register-submit").click();

    // The field is flagged invalid …
    await expectInvalid(pw);
    // … and the visible message is the RU copy, with NO English leak.
    await expect(page.getByText(RU_PASSWORD_COMPLEXITY)).toBeVisible();
    await expect(page.getByText(/password must include/i)).toHaveCount(0);
  });

  test("register: a malformed email is flagged on blur, before submit", async ({
    page,
  }) => {
    await page.goto("/register");
    const email = page.locator('input[autocomplete="email"]');
    const pw = page.locator('input[autocomplete="new-password"]');

    // Type a malformed email, then blur by focusing another field — NO submit click.
    await email.fill("not-an-email");
    await pw.focus();

    // `mode: "onTouched"` validates the touched email field on blur, so it is
    // flagged invalid without ever clicking the submit button.
    await expectInvalid(email);
  });

  // NOTE: the `/reset` *complete*-step variant of the weak-password RU-copy
  // assertion lives in the live-gated `auth-journeys.e2e.spec.ts`, NOT here:
  // reaching the complete step requires a real BFF reset ack
  // (`reset-request-submit` → `authClient.requestPasswordReset()` →
  // `POST /password/reset`) to flip the stage, so it is NOT backend-free and would
  // silently depend on a running api in this ungated tier. The `/register` test
  // above proves the SAME defect-1 mechanism (message-less complexity regex → RU
  // copy) purely client-side, which is why it belongs in this tier.
});
