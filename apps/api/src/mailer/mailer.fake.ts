import { assertSendableEmail, type Mailer } from "./mailer.types.js";

/**
 * In-memory {@link Mailer} — the unit-test double. Records every accepted send so
 * a test can assert exactly one account-exists notice fired (EARS-23). Mirrors
 * `InMemoryAuthAuditLog` / `FakeIdpClient`: the fake binding for assertions.
 *
 * Contract parity (a test fake must be no more permissive than the real
 * dependency): it runs the SAME {@link assertSendableEmail} guard `SmtpMailer`
 * runs, so an invalid email is rejected identically — a parity test proves it. A
 * future regression that relied on the fake accepting a bad address fails in unit
 * tests, not only live.
 */
export class FakeMailer implements Mailer {
  /** Lowercased recipient addresses of every accepted account-exists notice, in order. */
  readonly accountExistsNotices: string[] = [];

  // `async` so the parity guard's rejection is delivered as a rejected promise
  // (like the real adapter's `async` method), never a synchronous throw — the two
  // adapters must be indistinguishable to a caller, including in error shape.
  async sendAccountExistsNotice(email: string): Promise<void> {
    assertSendableEmail(email);
    this.accountExistsNotices.push(email.trim().toLowerCase());
  }
}
