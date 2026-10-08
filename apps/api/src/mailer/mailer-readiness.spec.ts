import { describe, expect, it, vi } from "vitest";
import { register } from "prom-client";
import {
  MAILER_CHANNEL_READINESS_METRIC,
  MailerReadinessMonitor,
  operationalReserve,
  type ChannelReadiness,
} from "./mailer-readiness.js";
import {
  SmtpMailer,
  type SmtpMailerConfig,
  type SmtpTransport,
} from "./smtp-mailer.js";

/** 003 EARS-46 (#2144, design §14.3a): per-channel readiness without sending. */

const POSTBOX = {
  provider: "postbox",
  host: "postbox.cloud.yandex.net",
  port: 465,
  user: "key-id",
  password: "key-secret",
  from: "noreply@doctor.school",
};
const MAILRU = {
  enabled: true,
  provider: "mail.ru",
  host: "smtp.mail.ru",
  port: 465,
  user: "reserve@doctor.school",
  password: "app-password",
  from: "noreply@doctor.school",
};

function probeFixture(
  overrides: Partial<SmtpMailerConfig> = {},
  verify: Record<string, () => Promise<void>> = {},
  resendProbe: { status: number; body?: string } = { status: 200 },
) {
  const sendMail = vi.fn();
  const verified: string[] = [];
  const fetchFn = vi.fn(
    async () =>
      new Response(resendProbe.body ?? "{}", { status: resendProbe.status }),
  ) as unknown as typeof fetch;
  const config: SmtpMailerConfig = {
    intercept: { host: "mailpit.local", port: 1025 },
    real: POSTBOX,
    fallback: MAILRU,
    resend: { enabled: true, apiKey: "re_key", fetchFn },
    isEnabled: () => true,
    transportFactory: (o): SmtpTransport => ({
      sendMail,
      verify: async () => {
        verified.push(o.host);
        await (verify[o.host] ?? (async () => undefined))();
      },
    }),
    ...overrides,
  };
  return { mailer: new SmtpMailer(config), sendMail, verified, fetchFn };
}

const states = (s: ChannelReadiness[]) =>
  Object.fromEntries(s.map((c) => [c.role, `${c.provider}:${c.state}`]));

describe("003 EARS-46 per-channel readiness (design §14.3a)", () => {
  it("EARS-46: configured channels are configured-unverified until probed, then verified by handshake or key check — no message is sent", async () => {
    const f = probeFixture();
    expect(states(f.mailer.readinessStatement())).toEqual({
      primary: "postbox:configured-unverified",
      reserve: "mail.ru:configured-unverified",
      resend: "resend:configured-unverified",
    });
    expect(states(await f.mailer.probeReadiness())).toEqual({
      primary: "postbox:verified",
      reserve: "mail.ru:verified",
      resend: "resend:verified",
    });
    expect(f.verified.sort()).toEqual([
      "postbox.cloud.yandex.net",
      "smtp.mail.ru",
    ]);
    expect(f.sendMail).not.toHaveBeenCalled();
    const [url, init] = (f.fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).not.toMatch(/\/emails/);
    expect(init.method).toBe("GET");
  });

  it("EARS-46: a failed handshake or invalid key is probe-failed; a restricted sending-only key is verified", async () => {
    const f = probeFixture(
      {},
      {
        "smtp.mail.ru": async () => {
          throw Object.assign(new Error("535 auth"), { responseCode: 535 });
        },
      },
      { status: 403, body: '{"name":"invalid_api_key"}' },
    );
    expect(states(await f.mailer.probeReadiness())).toEqual({
      primary: "postbox:verified",
      reserve: "mail.ru:probe-failed",
      resend: "resend:probe-failed",
    });
    const restricted = probeFixture(
      {},
      {},
      {
        status: 401,
        body: '{"name":"restricted_api_key"}',
      },
    );
    expect(states(await restricted.mailer.probeReadiness()).resend).toBe(
      "resend:verified",
    );
  });

  it("EARS-46: switched-off channels are disabled, unconfigured ones absent, and neither is probed", async () => {
    const off = probeFixture({
      isEnabled: () => false,
      fallback: { ...MAILRU, enabled: false },
      resend: { enabled: false, apiKey: "dormant" },
    });
    expect(states(await off.mailer.probeReadiness())).toEqual({
      primary: "postbox:disabled",
      reserve: "mail.ru:disabled",
      resend: "resend:disabled",
    });
    const none = probeFixture({
      real: undefined,
      fallback: undefined,
      resend: undefined,
    });
    expect(states(await none.mailer.probeReadiness())).toEqual({
      primary: "postbox:absent",
      reserve: "mail.ru:absent",
      resend: "resend:absent",
    });
    expect([...off.verified, ...none.verified]).toEqual([]);
  });

  it("EARS-46: only verified reserves count as operational reserve", () => {
    expect(
      operationalReserve([
        { role: "primary", provider: "postbox", state: "verified" },
        { role: "reserve", provider: "mail.ru", state: "probe-failed" },
        { role: "resend", provider: "resend", state: "verified" },
      ]),
    ).toEqual(["resend"]);
    for (const state of [
      "disabled",
      "absent",
      "configured-unverified",
      "probe-failed",
    ] as const) {
      expect(
        operationalReserve([{ role: "reserve", provider: "mail.ru", state }]),
      ).toEqual([]);
    }
  });

  it("EARS-46: the monitor probes at startup and on every flag change, publishing a gauge and a log with no secret or address", async () => {
    register.clear();
    const logs: string[] = [];
    const f = probeFixture();
    const monitor = new MailerReadinessMonitor(
      () => f.mailer.probeReadiness(),
      f.mailer.readinessStatement(),
      { log: (l) => logs.push(l) },
    );
    let flagListener: (() => void) | undefined;
    const seen: ChannelReadiness[][] = [];
    monitor.onChange((s) => seen.push(s));
    monitor.start({
      onChange: (l) => {
        flagListener = l;
        return () => undefined;
      },
      onSynchronized: () => () => undefined,
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    flagListener!();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(f.verified).toHaveLength(4);
    const gauge = await register
      .getSingleMetric(MAILER_CHANNEL_READINESS_METRIC)
      ?.get();
    expect(gauge?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 1,
          labels: { provider: "mail.ru", state: "verified" },
        }),
        expect.objectContaining({
          value: 0,
          labels: { provider: "mail.ru", state: "configured-unverified" },
        }),
      ]),
    );
    expect(JSON.parse(logs[0]!)).toMatchObject({
      event: "mailer_channel_readiness",
      operational_reserve: ["mail.ru", "resend"],
    });
    expect(JSON.stringify([logs, gauge])).not.toMatch(
      /key-secret|app-password|re_key|@doctor\.school/,
    );
    monitor.stop();
  });

  it("EARS-46: the monitor re-probes on the first flag-service sync and unsubscribes both signals on stop", async () => {
    register.clear();
    const f = probeFixture();
    const monitor = new MailerReadinessMonitor(
      () => f.mailer.probeReadiness(),
      f.mailer.readinessStatement(),
      { log: () => undefined },
    );
    let syncListener: (() => void) | undefined;
    const unsubscribed: string[] = [];
    const seen: ChannelReadiness[][] = [];
    monitor.onChange((s) => seen.push(s));
    monitor.start({
      onChange: () => () => unsubscribed.push("change"),
      onSynchronized: (l) => {
        syncListener = l;
        return () => unsubscribed.push("sync");
      },
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(syncListener).toBeTypeOf("function");
    syncListener!();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    monitor.stop();
    expect(unsubscribed.sort()).toEqual(["change", "sync"]);
  });
});
