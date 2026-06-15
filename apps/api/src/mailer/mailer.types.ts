/**
 * The BFF's own transactional-email channel (003 EARS-23, design §4) — distinct
 * from Zitadel's identity-credential notifications (verification / OTP / reset
 * codes, the ones that carry a secret). This port owns **product / security
 * notices** that must never carry a secret: the account-exists notice is the
 * first consumer; lockout / welcome mails are future ones.
 */
export interface Mailer {
  /**
   * EARS-23: send the account-exists notice to `email` — a sign-in /
   * password-reset prompt for a registration attempt on an already-registered
   * address. It carries **no** verification code, login code, token, or
   * account/PD (it is not an identity-credential email; that is Zitadel's job).
   *
   * Implementations MUST reject an empty / blank / syntactically invalid email
   * (contract parity: the fake is no more permissive than the real adapter).
   */
  sendAccountExistsNotice(email: string): Promise<void>;
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
