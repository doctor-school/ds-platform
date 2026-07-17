import { describe, expect, it, vi } from "vitest";
import { SmtpMailer, type TransportFactory } from "./smtp-mailer.js";
import {
  DEFAULT_SYNTHETIC_DOMAIN,
  DEFAULT_SYNTHETIC_MSISDN_PREFIX,
  SyntheticSuppression,
} from "./synthetic-suppression.js";

// 003 EARS-33 (design §14.8): the SmtpMailer honours the synthetic-send
// suppression seam at its single send point — a tagged (`@loadtest.invalid`)
// recipient under the ON toggle is dropped BEFORE any transport is contacted, so
// ZERO real send leaves the box, while every untagged recipient (and every send
// with the toggle OFF) proceeds byte-identically to today. The suppressed path
// still runs the identical request-shape pipeline (the parity guards + artifact
// composition in the public method) minus the relay hop.

/** Records every message any transport is asked to send. */
function recordingFactory(): {
  factory: TransportFactory;
  sends: Array<{ to: string }>;
} {
  const sends: Array<{ to: string }> = [];
  const factory: TransportFactory = () => ({
    sendMail: (msg: { to?: unknown }) => {
      sends.push({ to: String(msg.to) });
      return Promise.resolve();
    },
  });
  return { factory, sends };
}

const interceptCfg = {
  host: "mailpit.local",
  port: 1025,
  from: "noreply@doctor.school",
};

function buildMailer(
  synthetic: SyntheticSuppression,
): { mailer: SmtpMailer; sends: Array<{ to: string }> } {
  const rec = recordingFactory();
  const mailer = new SmtpMailer({
    intercept: interceptCfg,
    isEnabled: () => false, // intercept (Mailpit) transport — the send point under test
    portalBaseUrl: "http://localhost:3001",
    transportFactory: rec.factory,
    synthetic,
  });
  return { mailer, sends: rec.sends };
}

function enabledSuppression(onSuppressed = vi.fn()): {
  seam: SyntheticSuppression;
  onSuppressed: typeof onSuppressed;
} {
  return {
    onSuppressed,
    seam: new SyntheticSuppression({
      enabled: () => true,
      tags: {
        domain: DEFAULT_SYNTHETIC_DOMAIN,
        msisdnPrefix: DEFAULT_SYNTHETIC_MSISDN_PREFIX,
      },
      sinks: { onSuppressed },
    }),
  };
}

const CODE = "123456";

describe("SmtpMailer synthetic-send suppression (003 EARS-33)", () => {
  it("003 EARS-33: ON + tagged recipient → zero transport sends + one suppression count", async () => {
    const { seam, onSuppressed } = enabledSuppression();
    const { mailer, sends } = buildMailer(seam);

    await mailer.sendVerificationCodeEmail("burst@loadtest.invalid", CODE);
    await mailer.sendPasswordResetCodeEmail("burst2@loadtest.invalid", CODE);
    await mailer.sendAccountExistsNotice("burst3@loadtest.invalid");

    // The transport is NEVER contacted — zero real send leaves the box.
    expect(sends).toHaveLength(0);
    // One loud per-suppression signal per dropped send, channel = email.
    expect(onSuppressed).toHaveBeenCalledTimes(3);
    expect(onSuppressed.mock.calls[0]?.[0]).toBe("email");
  });

  it("003 EARS-33: ON + UNtagged (real) recipient → send proceeds unchanged", async () => {
    const { seam, onSuppressed } = enabledSuppression();
    const { mailer, sends } = buildMailer(seam);

    await mailer.sendVerificationCodeEmail("doctor@ds.test", CODE);

    expect(sends).toHaveLength(1);
    expect(sends[0]?.to).toBe("doctor@ds.test");
    expect(onSuppressed).not.toHaveBeenCalled();
  });

  it("003 EARS-33: toggle OFF → a tagged recipient still sends normally (default inert)", async () => {
    const { mailer, sends } = buildMailer(SyntheticSuppression.disabled());

    await mailer.sendVerificationCodeEmail("burst@loadtest.invalid", CODE);

    expect(sends).toHaveLength(1);
    expect(sends[0]?.to).toBe("burst@loadtest.invalid");
  });

  it("003 EARS-33: a mailer with NO suppression seam configured always sends (back-compat)", async () => {
    const rec = recordingFactory();
    const mailer = new SmtpMailer({
      intercept: interceptCfg,
      isEnabled: () => false,
      portalBaseUrl: "http://localhost:3001",
      transportFactory: rec.factory,
    });
    await mailer.sendVerificationCodeEmail("burst@loadtest.invalid", CODE);
    expect(rec.sends).toHaveLength(1);
  });
});
