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
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";

// A bare numeric string — the exact bug report: neither an email nor an E.164
// phone (no leading `+`), so it must be rejected in every identifier box.
const BAD_NUMERIC = "99545545445";
const VALID_EMAIL = "doctor@example.com";
const VALID_PHONE = "+79991234567";
const VALID_PASSWORD = "sufficiently-long-pw";

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

test.describe("#192 portal identifier validation (client-side, ungated)", () => {
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
