import { describe, expect, it } from "vitest";
import { FakeMailer } from "./mailer.fake.js";
import { SmtpMailer } from "./smtp-mailer.js";

// Contract parity (a test fake must be no more permissive than the real
// dependency, #202 precedent): FakeMailer and the real SmtpMailer must reject the
// SAME invalid input. Both run `assertSendableEmail` before any transport
// decision, so an empty / blank / malformed address is refused identically — a
// future regression that leaned on the fake accepting a bad address fails here,
// not only live. The SmtpMailer under test is UNCONFIGURED (no host ⇒ logged
// no-op) so a VALID address resolves without a live SMTP, but an INVALID one
// still throws before the no-op short-circuit.

const INVALID_EMAILS = ["", "   ", "no-at-sign", "missing@domain", "@ds.test"];
const VALID_EMAIL = "owner@ds.test";

function buildSmtp(): SmtpMailer {
  // No host on either transport ⇒ the adapter is a logged no-op; the parity guard
  // (assertSendableEmail) runs FIRST, before any transport decision (#209).
  return new SmtpMailer({
    intercept: {},
    real: undefined,
    isEnabled: () => false,
    portalBaseUrl: "http://localhost:3001",
  });
}

describe("EARS-23: FakeMailer ↔ SmtpMailer contract parity", () => {
  it("EARS-23: when the email is invalid, both the fake and the real adapter shall reject", async () => {
    const fake = new FakeMailer();
    const smtp = buildSmtp();
    for (const bad of INVALID_EMAILS) {
      await expect(
        fake.sendAccountExistsNotice(bad),
        `FakeMailer should reject ${JSON.stringify(bad)}`,
      ).rejects.toThrow();
      await expect(
        smtp.sendAccountExistsNotice(bad),
        `SmtpMailer should reject ${JSON.stringify(bad)}`,
      ).rejects.toThrow();
    }
  });

  it("EARS-23: when the email is valid, both adapters shall accept (no throw)", async () => {
    const fake = new FakeMailer();
    const smtp = buildSmtp();
    await expect(
      fake.sendAccountExistsNotice(VALID_EMAIL),
    ).resolves.toBeUndefined();
    // Unconfigured SmtpMailer resolves (logged no-op) for a valid address.
    await expect(
      smtp.sendAccountExistsNotice(VALID_EMAIL),
    ).resolves.toBeUndefined();
    expect(fake.accountExistsNotices).toEqual([VALID_EMAIL]);
  });
});

// 003 EARS-29 (#1045): the code-only credential emails share the same parity
// contract — the fake rejects exactly what the real adapter rejects (invalid
// recipient, empty/blank/whitespace code), so a regression that leaned on the
// fake accepting a bad input fails here, not only live.
describe("003 EARS-29: code-email FakeMailer ↔ SmtpMailer contract parity", () => {
  const INVALID_CODES = ["", "   ", "GX5 AVU", "GX5\nAVU"];
  const CODE = "GX5AVU";

  it("EARS-29: when the recipient is invalid, both adapters shall reject the code sends", async () => {
    const fake = new FakeMailer();
    const smtp = buildSmtp();
    for (const bad of INVALID_EMAILS) {
      await expect(fake.sendVerificationCodeEmail(bad, CODE)).rejects.toThrow();
      await expect(smtp.sendVerificationCodeEmail(bad, CODE)).rejects.toThrow();
      await expect(
        fake.sendPasswordResetCodeEmail(bad, CODE),
      ).rejects.toThrow();
      await expect(
        smtp.sendPasswordResetCodeEmail(bad, CODE),
      ).rejects.toThrow();
    }
  });

  it("EARS-29: when the code is empty/blank/broken, both adapters shall reject — and the rejection never echoes the code", async () => {
    const fake = new FakeMailer();
    const smtp = buildSmtp();
    for (const bad of INVALID_CODES) {
      for (const adapter of [fake, smtp]) {
        for (const send of [
          () => adapter.sendVerificationCodeEmail(VALID_EMAIL, bad),
          () => adapter.sendPasswordResetCodeEmail(VALID_EMAIL, bad),
        ]) {
          let thrown: unknown;
          try {
            await send();
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(Error);
          if (bad.trim()) {
            expect((thrown as Error).message).not.toContain(bad.trim());
          }
        }
      }
    }
  });

  it("EARS-29: when input is valid, both adapters shall accept; the fake records the send", async () => {
    const fake = new FakeMailer();
    const smtp = buildSmtp();
    await expect(
      fake.sendVerificationCodeEmail(VALID_EMAIL, CODE),
    ).resolves.toBeUndefined();
    await expect(
      fake.sendPasswordResetCodeEmail(VALID_EMAIL, CODE),
    ).resolves.toBeUndefined();
    // Unconfigured SmtpMailer resolves (logged no-op) for valid input.
    await expect(
      smtp.sendVerificationCodeEmail(VALID_EMAIL, CODE),
    ).resolves.toBeUndefined();
    await expect(
      smtp.sendPasswordResetCodeEmail(VALID_EMAIL, CODE),
    ).resolves.toBeUndefined();
    expect(fake.verificationCodeEmails).toEqual([
      { to: VALID_EMAIL, code: CODE },
    ]);
    expect(fake.passwordResetCodeEmails).toEqual([
      { to: VALID_EMAIL, code: CODE },
    ]);
  });
});
