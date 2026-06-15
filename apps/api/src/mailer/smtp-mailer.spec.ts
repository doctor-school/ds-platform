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
