/**
 * The BFF's own transactional-email channel (003 EARS-23/29, design §4, §14).
 * Two mail classes ride this port:
 *
 * - **Product / security notices** that must never carry a secret — the
 *   account-exists notice (EARS-23) is the first consumer; lockout / welcome
 *   mails are future ones.
 * - **One-time-code credential emails** (EARS-29, #910/#1045): the email-verify
 *   and password-reset codes are obtained from Zitadel via `returnCode`
 *   (Zitadel generates/stores/expires/verifies the code but sends nothing) and
 *   delivered as the branded, Russian, code-only, fully link-free §13.3/§13.4
 *   artifacts. The BFF transports the code; it never generates or checks one.
 *   EARS-30 governs the transit: in memory for the in-flight send only — never
 *   logged, never persisted, never echoed into an error (implementations
 *   sanitize provider rejections before surfacing them).
 */
export interface Mailer {
  /**
   * EARS-23: send the account-exists notice to `email` — a sign-in /
   * password-reset prompt for a registration attempt on an already-registered
   * address. It carries **no** verification code, login code, token, or
   * account/PD.
   *
   * Implementations MUST reject an empty / blank / syntactically invalid email
   * (contract parity: the fake is no more permissive than the real adapter).
   */
  sendAccountExistsNotice(email: string): Promise<void>;

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
  const ok =
    trimmed.length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed);
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
  const ok =
    typeof code === "string" && code.length > 0 && !/\s/.test(code);
  if (!ok) {
    throw new Error(
      "Mailer: refusing to send an empty or malformed one-time code",
    );
  }
}
