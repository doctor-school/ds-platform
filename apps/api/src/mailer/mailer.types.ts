import type { CodeLifetime, ReRegistrationCopyInput } from "./code-emails.js";

/**
 * The BFF's own transactional-email channel (003 EARS-23/29, design §4, §14).
 * Two mail classes ride this port:
 *
 * - **Product / security notices** that must never carry a secret (the 011
 *   admin-lockout notice, the congress letters).
 * - **One-time-code credential emails** (EARS-23/29/34, #910/#1045): the
 *   email-verify, sign-in, re-registration and password-reset codes are obtained from Zitadel via `returnCode`
 *   (Zitadel generates/stores/expires/verifies the code but sends nothing) and
 *   delivered as the branded, Russian, code-only, fully link-free §13.3/§13.4
 *   artifacts. The BFF transports the code; it never generates or checks one.
 *   EARS-30 governs the transit: in memory for the in-flight send only — never
 *   logged, never persisted, never echoed into an error (implementations
 *   sanitize provider rejections before surfacing them).
 */
/**
 * 044 EARS-13 — everything the confirmation email needs that the CALLER knows.
 *
 * The letter carries no portal link and no account fact (044 EARS-13
 * production amendment, #2369), so the request names only the event. The event
 * instant arrives as a `Date` rather than a pre-rendered string: the Moscow
 * wall-clock rendering is presentation, and presentation belongs to the mail
 * layer, not to the intake.
 */
export interface CongressConfirmationRequest {
  email: string;
  /** `events.title` of the congress the participant just signed up for. */
  eventTitle: string;
  /** `events.starts_at` as the instant it is; rendered in `Europe/Moscow`. */
  eventStartsAt: Date;
  /** The congress venue (a per-deployment constant, 044 EARS-13). */
  eventVenue: string;
}

/** 046 EARS-14 — what the congress submission receipt is rendered from. */
export interface CongressSubmissionReceiptRequest {
  /** The account email of the submission's author. */
  email: string;
  /** The submission's title («тема»). */
  title: string;
  /** The kind's Russian name as the section shows it. */
  kindLabel: string;
  /** `events.title` of the congress, as the 044 confirmation names it. */
  eventTitle: string;
}

/**
 * 046 EARS-29, EARS-35 — what a committee decision letter or a revision
 * deadline extension letter is rendered from. The deadline arrives as the
 * stored instant; rendering its last day is presentation, the mail layer's.
 */
export type CongressSubmissionDecisionRequest = {
  /** The account email of the submission's author. */
  email: string;
  /** The submission's title («тема»). */
  title: string;
  /** The kind's Russian name as the section shows it. */
  kindLabel: string;
} & (
  | { letter: "accepted" }
  | { letter: "rejected"; comment: string }
  | { letter: "needs_revision"; comment: string; revisionDueAt: Date }
  | { letter: "revision_extended"; revisionDueAt: Date }
);

export interface Mailer {
  /**
   * EARS-29: dispatch the §13.3 email-verification artifact — the one-time
   * code as the ONLY payload (code-led subject, unbroken enlarged token,
   * expiry line, zero links). Serves both the EARS-1/3 registration cascade
   * and every EARS-25 resend. Implementations MUST reject an invalid `email`
   * or an empty/blank/whitespace-broken `code` (parity), and MUST scrub the
   * code from any transport error they surface (EARS-30).
   */
  sendVerificationCodeEmail(email: string, code: string): Promise<void>;

  /**
   * EARS-29: dispatch the §13.4 password-reset artifact (EARS-11) — same
   * contract as {@link sendVerificationCodeEmail}, reset copy.
   */
  sendPasswordResetCodeEmail(email: string, code: string): Promise<void>;

  /**
   * EARS-6/29/34: the sign-in code mail, same validation/privacy contract.
   * `lifetime` states the carried code's expiry: `"5m"` for a login code
   * (default), `"1h"` for the verification code of an unverified account.
   */
  sendLoginCodeEmail(
    email: string,
    code: string,
    lifetime?: CodeLifetime,
  ): Promise<void>;

  /**
   * EARS-23: the re-registration code mail for an already-registered address —
   * same validation/privacy contract as {@link sendLoginCodeEmail}, «already
   * registered» copy and the password line, no link.
   */
  sendReRegistrationCodeEmail(
    email: string,
    code: string,
    input: ReRegistrationCopyInput,
  ): Promise<void>;

  /**
   * 011 EARS-7: notify an admin that repeated failed second-factor attempts have
   * soft-locked their account (the ADR-0001 §7 lockout notification).
   *
   * A **product/security notice**, in the first class above: it carries no code,
   * no token, no attempt count, and no timing — an inbox is not the place to hand
   * an attacker who already has the password a progress report. It says the
   * account is temporarily locked and names the operator recovery path, nothing
   * more.
   *
   * The BFF owes this mail (unlike 003's password lockout, where Zitadel's native
   * policy both locks and notifies): the TOTP-attempt lock is the BFF's own
   * counter, so a silent lock would be an operator locked out with no signal.
   * Implementations MUST reject an empty / blank / syntactically invalid email
   * (contract parity: the fake is no more permissive than the real adapter).
   */
  sendAdminLockoutNotice(email: string): Promise<void>;

  /**
   * 044 EARS-13: send the congress registration confirmation — a
   * **product notice**, in the first class above. It carries no code, no token
   * and nothing about the account beyond the one fact the recipient submitted
   * the form to establish.
   *
   * The caller dispatches it OFF the response path and never rolls a
   * registration back on a rejection (EARS-11), so this method's contract is
   * simply «resolve on acceptance, reject on a relay failure after failover» —
   * the caller records which of the two happened on the registration row.
   *
   * Implementations MUST reject an empty / blank / syntactically invalid email
   * (contract parity: the fake is no more permissive than the real adapter).
   */
  sendCongressRegistrationConfirmation(
    input: CongressConfirmationRequest,
  ): Promise<void>;

  /**
   * 046 EARS-14: send the author the receipt for a congress submission that
   * has just become `submitted` — a **product notice**, like the 044
   * confirmation. The caller dispatches it after commit and off the response
   * path and records the outcome on the submission; this method resolves on
   * acceptance and rejects on a relay failure after failover.
   *
   * Implementations MUST reject an empty / blank / syntactically invalid email
   * (contract parity: the fake is no more permissive than the real adapter).
   */
  sendCongressSubmissionReceipt(
    input: CongressSubmissionReceiptRequest,
  ): Promise<void>;

  /**
   * 046 EARS-29, EARS-35: send the author the letter of a committee decision
   * (`accepted`, `rejected`, `needs_revision`) or of the platform
   * administrator's revision-deadline extension — a **product notice**, sent
   * by the caller after commit and off the response path with the outcome
   * recorded on the submission. Resolves on acceptance, rejects on a relay
   * failure after failover; MUST reject an invalid email like the receipt.
   */
  sendCongressSubmissionDecision(
    input: CongressSubmissionDecisionRequest,
  ): Promise<void>;
}

/** DI token for the {@link Mailer} port (SmtpMailer in runtime; FakeMailer in tests). */
export const MAILER = Symbol("MAILER");

/**
 * Shared create-time validation for every {@link Mailer} implementation — the
 * single invariant the fake and the real adapter must agree on (a test fake no
 * more permissive than the real dependency: a parity test proves both reject the
 * same invalid input). A bare structural check (non-empty, single `@`, dot in
 * the domain) — the BFF never sends to a malformed address, and the registration
 * DTO has already validated a real submission upstream.
 */
export function assertSendableEmail(email: string): void {
  const trimmed = email?.trim() ?? "";
  const ok = trimmed.length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed);
  if (!ok) {
    throw new Error(`Mailer: refusing to send to an invalid email address`);
  }
}

/**
 * Shared validation for a one-time code about to ride a §13.3/§13.4 mail
 * (EARS-29 parity twin of {@link assertSendableEmail}): an empty / blank code,
 * or one broken by whitespace (which could never render as ONE unbroken
 * token), is refused identically by the fake and the real adapter. The error
 * message deliberately never echoes the value — the code is a secret (EARS-30).
 */
export function assertSendableCode(code: string): void {
  const ok = typeof code === "string" && code.length > 0 && !/\s/.test(code);
  if (!ok) {
    throw new Error(
      "Mailer: refusing to send an empty or malformed one-time code",
    );
  }
}
