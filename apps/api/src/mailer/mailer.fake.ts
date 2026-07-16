import {
  assertSendableCode,
  assertSendableEmail,
  type Mailer,
} from "./mailer.types.js";

/**
 * In-memory {@link Mailer} — the unit-test double. Records every accepted send so
 * a test can assert exactly one account-exists notice (EARS-23) or exactly one
 * code-only credential email (EARS-29) fired. Mirrors `InMemoryAuthAuditLog` /
 * `FakeIdpClient`: the fake binding for assertions.
 *
 * Contract parity (a test fake must be no more permissive than the real
 * dependency): it runs the SAME {@link assertSendableEmail} /
 * {@link assertSendableCode} guards `SmtpMailer` runs, so an invalid email or a
 * blank/broken code is rejected identically — a parity test proves it. A
 * future regression that relied on the fake accepting a bad input fails in unit
 * tests, not only live. (Recording the code here is a TEST convenience — the
 * production adapters hold it in memory only for the in-flight send, EARS-30.)
 */
export class FakeMailer implements Mailer {
  /** Lowercased recipient addresses of every accepted account-exists notice, in order. */
  readonly accountExistsNotices: string[] = [];
  /** Every accepted §13.3 verification-code send (EARS-1/3/25), in order. */
  readonly verificationCodeEmails: Array<{ to: string; code: string }> = [];
  /** Every accepted §13.4 password-reset-code send (EARS-11), in order. */
  readonly passwordResetCodeEmails: Array<{ to: string; code: string }> = [];
  /** When set, the NEXT code send rejects with it (models a transport outage). */
  private nextCodeSendFailure: Error | undefined;

  /**
   * Test control: make every SUBSEQUENT code send reject with `error` — the
   * EARS-30 failover/total-failure outcomes are exercised against this seam
   * (the real transport chain is #1046; the port contract is pinned here).
   */
  failNextCodeSends(error: Error): void {
    this.nextCodeSendFailure = error;
  }

  // `async` so the parity guard's rejection is delivered as a rejected promise
  // (like the real adapter's `async` method), never a synchronous throw — the two
  // adapters must be indistinguishable to a caller, including in error shape.
  async sendAccountExistsNotice(email: string): Promise<void> {
    assertSendableEmail(email);
    this.accountExistsNotices.push(email.trim().toLowerCase());
  }

  async sendVerificationCodeEmail(email: string, code: string): Promise<void> {
    assertSendableEmail(email);
    assertSendableCode(code);
    if (this.nextCodeSendFailure) throw this.nextCodeSendFailure;
    this.verificationCodeEmails.push({
      to: email.trim().toLowerCase(),
      code,
    });
  }

  async sendPasswordResetCodeEmail(
    email: string,
    code: string,
  ): Promise<void> {
    assertSendableEmail(email);
    assertSendableCode(code);
    if (this.nextCodeSendFailure) throw this.nextCodeSendFailure;
    this.passwordResetCodeEmails.push({
      to: email.trim().toLowerCase(),
      code,
    });
  }
}
