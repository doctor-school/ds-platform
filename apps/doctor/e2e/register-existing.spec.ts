import { test, expect, type Page } from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 021 EARS-13 (#1549; tech spec 2026-09-15 wave 1, rows 73 + 77) — a duplicate
 * registration on the DOCTOR host is existence-agnostic, driven end to end.
 *
 * The doctor twin of the Academy's `apps/portal/e2e/auth-journeys.e2e.spec.ts`
 * «EARS-23/24: duplicate register → existence-agnostic screen + account-exists
 * notice (no code)», retargeted at this host's inline confirmation step (the
 * doctor door has no `/verify` route — the step renders on `/register`):
 *
 *   1. re-registering an ALREADY-VERIFIED address reaches the SAME confirmation
 *      step a new registrant reaches — nothing on screen says the account exists;
 *   2. the account-exists notice lands privately in the inbox with a single
 *      sign-in action and NO code (003 EARS-23);
 *   3. the resend acknowledgement is byte-identical for the pending registrant
 *      and for the existing owner (#326, 003 EARS-16) — no existence branch.
 *
 * Why a LIVE tier and not the return-context double: the notice is an email the
 * real api sends through Mailpit, and the identity of the two answers is a
 * property of the real 003 engine — a double would assert its own fixture.
 *
 * ENV SET (`playwright.register-live.config.ts`): `E2E_DOCTOR_URL`,
 * `MAILPIT_URL` (+ `IDP_ISSUER` for the stand). Bare CI → inert green; a
 * HALF-exported env fails loudly by variable name (`support/live-stand-env.ts`).
 * The stand preconditions of that module apply — in particular the raised
 * rate-limit ceilings. Bot protection must be in its stand bypass mode.
 */

requireLiveStandEnv(["E2E_DOCTOR_URL", "MAILPIT_URL"]);

const MAILPIT_BASE = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");
/** Stable tail of the verify-email subject (BFF `code-emails.ts`, §13.3). */
const VERIFY_SUBJECT = "код подтверждения Doctor.School";
/** Stable fragment of the 003 EARS-23 account-exists notice subject. */
const NOTICE_SUBJECT = "уже есть аккаунт";

const newEmail = (): string =>
  `e2e-2027-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
const livePassword = (): string => `Doc-${Date.now()}-aA1!`;

type MailpitMessage = { Subject: string; Text: string; HTML: string };

/**
 * Poll Mailpit for the newest mail to `email` delivered after `afterIso` whose
 * subject carries `subject` — polled, because SMTP delivery is async after the
 * BFF's 2xx. Mirrors `fetchMessage` of the Academy's `e2e/support/mailpit.ts`,
 * restated here because `apps/doctor` may not import from `apps/portal`
 * (ADR-0013 A1).
 */
async function fetchMail(
  email: string,
  afterIso: string,
  subject: string,
): Promise<MailpitMessage | null> {
  const after = Date.parse(afterIso);
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(
      `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{ ID?: string; Created?: string; Subject?: string }>;
      };
      const hit = (data.messages ?? []).find(
        (m) =>
          m.Created &&
          Date.parse(m.Created) >= after &&
          (m.Subject ?? "").includes(subject),
      );
      if (hit?.ID) {
        const msg = await fetch(`${MAILPIT_BASE}/api/v1/message/${hit.ID}`);
        if (msg.ok) {
          const body = (await msg.json()) as Partial<MailpitMessage>;
          return {
            Subject: body.Subject ?? "",
            Text: body.Text ?? "",
            HTML: body.HTML ?? "",
          };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** The code of a verify-email mail: the branded subject leads with it (#869). */
function codeOf(mail: MailpitMessage): string | null {
  return (
    mail.Subject.match(/^([A-Z0-9]{4,12})\s+—/)?.[1] ??
    `${mail.Text}\n${mail.HTML}`.match(/\bCode\s+([A-Z0-9]{4,12})\b/)?.[1] ??
    null
  );
}

/** Tick a consent through its label — the hit area of the checkbox primitive. */
async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

/** Submit the door with `email`; the step that answers is the confirmation. */
async function register(page: Page, email: string, password: string) {
  await page.goto("/register");
  await page.getByTestId("register-email").fill(email);
  await page.getByTestId("register-password").fill(password);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("verify-submit")).toBeVisible();
}

/**
 * Wait out the resend cooldown (`EMAIL_CONFIRM_RESEND_COOLDOWN_SECONDS`, 30 s),
 * press resend and return the acknowledgement the step renders.
 */
async function resendAcknowledgement(page: Page): Promise<string> {
  const resend = page.getByTestId("verify-resend");
  await expect(resend).toBeEnabled({ timeout: 40_000 });
  await resend.click();
  const notice = page.getByTestId("verify-resend-notice");
  await expect(notice).toBeVisible();
  return (await notice.innerText()).trim();
}

test.describe("021 EARS-13: a duplicate registration on the doctor host", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 EARS-13: duplicate register → the same confirmation step + account-exists notice (no code), and an identical resend acknowledgement", async ({
    page,
  }) => {
    // Two resend cooldowns and three mail round trips.
    test.setTimeout(180_000);
    const email = newEmail();
    const password = livePassword();

    // ── Register #1 (new account) → the confirmation step ─────────────────
    await register(page, email, password);
    await expect(page.getByTestId("verify-go-to-login")).toBeVisible();
    // The PENDING registrant's resend acknowledgement — the reference answer.
    const resentAt = new Date().toISOString();
    const pendingAck = await resendAcknowledgement(page);

    // Verify with the resent code so the address becomes an EXISTING account.
    const verifyMail = await fetchMail(email, resentAt, VERIFY_SUBJECT);
    expect(verifyMail, "the resent verify-email should reach Mailpit").toBeTruthy();
    const code = codeOf(verifyMail!);
    expect(code).toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(code!);
    await expect(page).not.toHaveURL(/\/register/);
    // Sign out by dropping the session cookie: the second attempt is a guest's.
    await page.context().clearCookies();

    // ── Register #2 (same, already-verified address) ──────────────────────
    const dupAt = new Date().toISOString();
    await register(page, email, livePassword());
    // Identical to the new-registrant case: the same step, the same co-equal
    // actions, no field error, no «этот email уже занят».
    await expect(page.getByTestId("verify-go-to-login")).toBeVisible();
    await expect(page.getByTestId("verify-go-to-reset")).toBeVisible();
    await expect(page.getByText(/уже занят|уже зарегистрирован/i)).toHaveCount(0);

    // 003 EARS-23: the notice carries a sign-in action and NO code.
    const notice = await fetchMail(email, dupAt, NOTICE_SUBJECT);
    expect(notice, "account-exists notice should reach Mailpit").toBeTruthy();
    const body = `${notice!.Text}\n${notice!.HTML}`;
    expect(body).toMatch(/\/login/);
    expect(body).not.toMatch(/\/reset/);
    expect(body).not.toMatch(/\bCode\s+[A-Z0-9]{4,12}\b/);
    expect(body).not.toMatch(/\b[0-9]{6,8}\b/);

    // #326 / 003 EARS-16: the EXISTING owner's acknowledgement is the pending
    // registrant's, byte for byte — no existence branch on this surface.
    expect(await resendAcknowledgement(page)).toBe(pendingAck);
  });
});
