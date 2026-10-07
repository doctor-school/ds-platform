import { test, expect, type Page } from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 021 EARS-13 + 003 EARS-23/41/42 (#2556) — a duplicate registration on the
 * DOCTOR host is existence-agnostic AND ends signed in, driven end to end.
 *
 * The doctor twin of the Academy's `apps/portal/e2e/auth-journeys.e2e.spec.ts`
 * «003 EARS-23/41: re-registration → the one code step → a code mail → signed
 * in», on this host's own `/verify` code step — the same package step the
 * Academy serves (003 EARS-24/42):
 *
 *   1. re-registering an ALREADY-VERIFIED address reaches the SAME code step a
 *      new registrant reaches — nothing on screen says the account exists;
 *   2. the owner receives privately a CODE mail (003 EARS-23 amended): «already
 *      registered», «Ваш пароль не изменился», the sign-in code, and no link;
 *   3. the resend acknowledgement is byte-identical for the pending registrant
 *      and for the existing owner (#326, 003 EARS-16) — no existence branch;
 *   4. the code typed on that step signs the owner in (003 EARS-41) — the
 *      storefront the doctor lands on renders the signed-in header.
 *
 * Why a LIVE tier and not the return-context double: the mail is the one the
 * real api sends through Mailpit, and the identity of the answers and the
 * session after the code are properties of the real 003 engine — a double
 * would assert its own fixture.
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
/**
 * Stable tail of the sign-in code subject — the 003 EARS-23 re-registration
 * mail carries the EARS-34 code under it (BFF `code-emails.ts`).
 */
const LOGIN_SUBJECT = "код для входа в Doctor.School";

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

/** The code of a code mail: the branded subject leads with it (#869). */
function codeOf(mail: MailpitMessage): string | null {
  return (
    mail.Subject.match(/^(\d{6})\s+—/)?.[1] ??
    `${mail.Text}\n${mail.HTML}`.match(/\bCode\s+(\d{6})\b/)?.[1] ??
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

/** The signed-in header cluster of the storefront the doctor landed on. */
async function expectSignedIn(page: Page) {
  const header = page.getByTestId("storefront-header");
  await expect(header.getByRole("link", { name: "Личный кабинет" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Войти" })).toHaveCount(0);
}

test.describe("021 EARS-13 / 003 EARS-23: a duplicate registration on the doctor host", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("003 EARS-23/41/42: duplicate register → the same code step + a code mail (no link), an identical resend acknowledgement, and the code signs the owner in", async ({
    page,
  }) => {
    // Two resend cooldowns and three mail round trips.
    test.setTimeout(180_000);
    const email = newEmail();
    const password = livePassword();

    // ── Register #1 (new account) → the code step ─────────────────────────
    await register(page, email, password);
    await expect(page.getByTestId("verify-back")).toBeVisible();
    // The PENDING registrant's resend acknowledgement — the reference answer.
    const resentAt = new Date().toISOString();
    const pendingAck = await resendAcknowledgement(page);

    // Verify with the resent code so the address becomes an EXISTING account;
    // the code itself signs the registrant in (003 EARS-41, no replay).
    const verifyMail = await fetchMail(email, resentAt, VERIFY_SUBJECT);
    expect(verifyMail, "the resent verify-email should reach Mailpit").toBeTruthy();
    const code = codeOf(verifyMail!);
    expect(code).toMatch(/^\d{6}$/);
    await page.locator('input[autocomplete="one-time-code"]').fill(code!);
    await expect(page).not.toHaveURL(/\/verify/);
    await expectSignedIn(page);
    // Sign out by dropping the session cookie: the second attempt is a guest's.
    await page.context().clearCookies();

    // ── Register #2 (same, already-verified address, another password) ────
    const dupAt = new Date().toISOString();
    await register(page, email, livePassword());
    // Identical to the new-registrant case: the same code step (003 EARS-42),
    // no field error, no «этот email уже занят».
    await expect(page.getByTestId("verify-back")).toBeVisible();
    await expect(page.getByText(/уже занят|уже зарегистрирован/i)).toHaveCount(0);

    // 003 EARS-23: a code mail, «already registered» and the password kept —
    // only in the mail — and no link of any kind.
    const reRegistration = await fetchMail(email, dupAt, LOGIN_SUBJECT);
    expect(reRegistration, "the re-registration code mail should reach Mailpit").toBeTruthy();
    const body = `${reRegistration!.Text}\n${reRegistration!.HTML}`;
    expect(body).toMatch(/уже зарегистрирован/);
    expect(body).toMatch(/Ваш пароль не изменился/);
    expect(codeOf(reRegistration!)).toMatch(/^\d{6}$/);
    expect(body).not.toMatch(/\/login|\/reset|\/verify/);

    // #326 / 003 EARS-16: the EXISTING owner's acknowledgement is the pending
    // registrant's, byte for byte — no existence branch on this surface.
    const ownerResentAt = new Date().toISOString();
    expect(await resendAcknowledgement(page)).toBe(pendingAck);

    // 003 EARS-25/41: the resent code (the login code for a verified account)
    // typed on the same step signs the owner in.
    const resent = await fetchMail(email, ownerResentAt, LOGIN_SUBJECT);
    expect(resent, "the resent sign-in code should reach Mailpit").toBeTruthy();
    await page.locator('input[autocomplete="one-time-code"]').fill(codeOf(resent!)!);
    await expect(page).not.toHaveURL(/\/verify/);
    await expectSignedIn(page);
  });
});
