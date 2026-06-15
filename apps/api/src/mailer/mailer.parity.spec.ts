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
