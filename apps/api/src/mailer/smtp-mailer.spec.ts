import { describe, expect, it, vi } from "vitest";
import { SmtpMailer, type TransportFactory } from "./smtp-mailer.js";

// EARS-23 (flag-gated transport, #209): the BFF account-exists notice now honors
// the `email-delivery-real` Unleash flag with a DUAL transport — intercept
// (`MAILER_SMTP_*`, Mailpit on the dev-stand) by default, the real
// (`IDP_SMTP_REAL_*`) relay when the flag is ON — mirroring the Zitadel
// DeliveryReconcileService. The selection is read LIVE per send (the injected
// `isEnabled` callback), so an operator's flag flip takes effect with no restart;
// flag ON but real creds absent fails SOFT to intercept + warns (never throws,
// never silently drops); the existing host-unset logged no-op still holds.

const VALID_EMAIL = "owner@ds.test";

/** Records every transport created + every message sent on it, by created order. */
function recordingFactory(): {
  factory: TransportFactory;
  created: Array<{ host?: string | undefined; port?: number | undefined; secure: boolean }>;
  sends: Array<{ host?: string | undefined; to: string }>;
} {
  const created: Array<{
    host?: string | undefined;
    port?: number | undefined;
    secure: boolean;
  }> = [];
  const sends: Array<{ host?: string | undefined; to: string }> = [];
  const factory: TransportFactory = (opts) => {
    created.push({ host: opts.host, port: opts.port, secure: opts.secure });
    return {
      sendMail: (msg: { to?: unknown }) => {
        sends.push({ host: opts.host, to: String(msg.to) });
        return Promise.resolve();
      },
    };
  };
  return { factory, created, sends };
}

const interceptCfg = {
  host: "mailpit.local",
  port: 1025,
  user: undefined,
  password: undefined,
  from: "noreply@doctor.school",
};
const realCfg = {
  host: "smtp.relay.example",
  port: 465,
  user: "relay-user",
  password: "relay-pass",
  from: "noreply@doctor.school",
};

function buildMailer(
  isEnabled: () => boolean,
  opts: {
    real?: typeof realCfg | undefined;
    warn?: (m: string) => void;
    factory?: TransportFactory;
  } = {},
): { mailer: SmtpMailer; rec: ReturnType<typeof recordingFactory> } {
  const rec = recordingFactory();
  const mailer = new SmtpMailer({
    intercept: interceptCfg,
    real: "real" in opts ? opts.real : realCfg,
    isEnabled,
    portalBaseUrl: "http://localhost:3001",
    warn: opts.warn,
    transportFactory: opts.factory ?? rec.factory,
  });
  return { mailer, rec };
}

describe("SmtpMailer dual-transport flag gate (#209)", () => {
  it("EARS-23: when email-delivery-real is ON, system shall dispatch the notice via the real transport", async () => {
    const { mailer, rec } = buildMailer(() => true);
    await mailer.sendAccountExistsNotice(VALID_EMAIL);
    expect(rec.sends).toHaveLength(1);
    expect(rec.sends[0]?.host).toBe(realCfg.host);
  });

  it("EARS-23: when email-delivery-real is OFF (env default mailpit), system shall dispatch the notice via the Mailpit intercept transport", async () => {
    const { mailer, rec } = buildMailer(() => false);
    await mailer.sendAccountExistsNotice(VALID_EMAIL);
    expect(rec.sends).toHaveLength(1);
    expect(rec.sends[0]?.host).toBe(interceptCfg.host);
  });

  it("EARS-23: when the flag is read LIVE, a mid-session flip switches transport with no rebuild", async () => {
    let live = false;
    const { mailer, rec } = buildMailer(() => live);
    await mailer.sendAccountExistsNotice(VALID_EMAIL);
    live = true;
    await mailer.sendAccountExistsNotice(VALID_EMAIL);
    expect(rec.sends.map((s) => s.host)).toEqual([
      interceptCfg.host,
      realCfg.host,
    ]);
  });

  it("EARS-23: when email-delivery-real is ON but real creds are unconfigured, system shall warn and use intercept (never throw, never drop)", async () => {
    const warn = vi.fn();
    const { mailer, rec } = buildMailer(() => true, { real: undefined, warn });
    await expect(
      mailer.sendAccountExistsNotice(VALID_EMAIL),
    ).resolves.toBeUndefined();
    expect(rec.sends).toHaveLength(1);
    expect(rec.sends[0]?.host).toBe(interceptCfg.host);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/IDP_SMTP_REAL/);
  });

  it("EARS-23: derives secure=true for the real transport on port 465", async () => {
    const { mailer, rec } = buildMailer(() => true);
    await mailer.sendAccountExistsNotice(VALID_EMAIL);
    const realTransport = rec.created.find((c) => c.host === realCfg.host);
    expect(realTransport?.secure).toBe(true);
  });

  it("EARS-23: rejects an invalid email before any transport decision (parity)", async () => {
    const { mailer, rec } = buildMailer(() => true);
    await expect(mailer.sendAccountExistsNotice("no-at-sign")).rejects.toThrow();
    expect(rec.sends).toHaveLength(0);
  });

  it("EARS-23: when the selected transport's host is unset, the existing logged no-op holds", async () => {
    const warn = vi.fn();
    const rec = recordingFactory();
    const mailer = new SmtpMailer({
      intercept: { host: undefined, from: "noreply@doctor.school" },
      real: undefined,
      isEnabled: () => false,
      portalBaseUrl: "http://localhost:3001",
      warn,
      transportFactory: rec.factory,
    });
    await expect(
      mailer.sendAccountExistsNotice(VALID_EMAIL),
    ).resolves.toBeUndefined();
    expect(rec.sends).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });
});

// 003 EARS-29/30 (#910/#1045): the verify/reset one-time codes ride returnCode
// off Zitadel and the BFF mailer dispatches the §13.3/§13.4 code-only artifacts
// through the SAME dual flag-gated transport as the account-exists notice. The
// transiting code is a SECRET: it must never leak into a log line, a thrown
// error, or a provider-response echo (EARS-30 — testable across every outcome).
describe("SmtpMailer code-only credential emails (003 EARS-29/30)", () => {
  const CODE = "GX5AVU";

  /** A factory whose transport records full messages and can be made to fail. */
  function messageFactory(fail?: (msg: { to: string }) => Error): {
    factory: TransportFactory;
    messages: Array<{
      host: string;
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }>;
  } {
    const messages: Array<{
      host: string;
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }> = [];
    const factory: TransportFactory = (opts) => ({
      sendMail: (msg) => {
        if (fail) return Promise.reject(fail(msg));
        messages.push({ host: opts.host, ...msg });
        return Promise.resolve();
      },
    });
    return { factory, messages };
  }

  function buildCodeMailer(opts: {
    factory: TransportFactory;
    warn?: (m: string) => void;
  }): SmtpMailer {
    return new SmtpMailer({
      intercept: interceptCfg,
      real: undefined,
      isEnabled: () => false,
      portalBaseUrl: "http://localhost:3001",
      warn: opts.warn,
      transportFactory: opts.factory,
    });
  }

  it("EARS-29: sendVerificationCodeEmail dispatches the §13.3 artifact — code-led subject, unbroken token, zero links", async () => {
    const { factory, messages } = messageFactory();
    const mailer = buildCodeMailer({ factory });
    await mailer.sendVerificationCodeEmail(VALID_EMAIL, CODE);
    expect(messages).toHaveLength(1);
    const m = messages[0]!;
    expect(m.to).toBe(VALID_EMAIL);
    expect(m.subject).toBe(`${CODE} — код подтверждения Doctor.School`);
    expect(m.html).toContain(`<strong>${CODE}</strong>`);
    expect(m.html.toLowerCase()).not.toMatch(/<a[\s>]/);
    expect(m.html).not.toMatch(/https?:\/\//);
  });

  it("EARS-29: sendPasswordResetCodeEmail dispatches the §13.4 artifact — code-led subject, unbroken token, zero links", async () => {
    const { factory, messages } = messageFactory();
    const mailer = buildCodeMailer({ factory });
    await mailer.sendPasswordResetCodeEmail(VALID_EMAIL, CODE);
    expect(messages).toHaveLength(1);
    const m = messages[0]!;
    expect(m.subject).toBe(`${CODE} — код сброса пароля Doctor.School`);
    expect(m.html).toContain(`<strong>${CODE}</strong>`);
    expect(m.html.toLowerCase()).not.toMatch(/<a[\s>]/);
    expect(m.html).not.toMatch(/https?:\/\//);
  });

  it("EARS-29: rejects an invalid recipient and an empty/blank code before any transport decision", async () => {
    const { factory, messages } = messageFactory();
    const mailer = buildCodeMailer({ factory });
    await expect(
      mailer.sendVerificationCodeEmail("no-at-sign", CODE),
    ).rejects.toThrow();
    await expect(
      mailer.sendVerificationCodeEmail(VALID_EMAIL, ""),
    ).rejects.toThrow();
    await expect(
      mailer.sendPasswordResetCodeEmail(VALID_EMAIL, "  "),
    ).rejects.toThrow();
    expect(messages).toHaveLength(0);
  });

  it("EARS-30: a provider rejection that echoes the outbound message is SANITIZED — the thrown error and warn sink never contain the code", async () => {
    // Model the worst-case provider echo: the transport error message quotes the
    // whole outbound payload (subject + body), i.e. the code appears in it.
    const warn = vi.fn();
    const { factory } = messageFactory(
      () => new Error(`550 rejected message: subject "${CODE} — код" body ${CODE}`),
    );
    const mailer = buildCodeMailer({ factory, warn });
    let thrown: unknown;
    try {
      await mailer.sendVerificationCodeEmail(VALID_EMAIL, CODE);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(CODE);
    expect((thrown as Error).stack ?? "").not.toContain(CODE);
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain(CODE);
    }
  });

  it("EARS-30: the reset-code error path is scrubbed identically (total-failure outcome)", async () => {
    const { factory } = messageFactory(() => new Error(`boom ${CODE} boom`));
    const mailer = buildCodeMailer({ factory });
    await expect(
      mailer.sendPasswordResetCodeEmail(VALID_EMAIL, CODE),
    ).rejects.toThrow();
    await mailer.sendPasswordResetCodeEmail(VALID_EMAIL, CODE).catch((e) => {
      expect((e as Error).message).not.toContain(CODE);
    });
  });

  it("EARS-30: the host-unset logged no-op warn carries no code either", async () => {
    const warn = vi.fn();
    const rec = recordingFactory();
    const mailer = new SmtpMailer({
      intercept: { host: undefined, from: "noreply@doctor.school" },
      real: undefined,
      isEnabled: () => false,
      portalBaseUrl: "http://localhost:3001",
      warn,
      transportFactory: rec.factory,
    });
    await mailer.sendVerificationCodeEmail(VALID_EMAIL, CODE);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain(CODE);
    }
  });
});
