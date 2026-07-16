import { describe, expect, it } from "vitest";
import { register } from "prom-client";
import {
  DefaultRelayObservability,
  MAILER_RELAY_EVENTS_METRIC,
  type FailoverEvent,
  type RelayFailureEvent,
  type RelayObservability,
} from "./relay-observability.js";
import {
  SmtpMailer,
  type SmtpMailerConfig,
  type SmtpTransport,
} from "./smtp-mailer.js";

/**
 * 003 EARS-31/32 (#1046, design §14.3): the mail.ru→Resend failover chain in
 * the BFF mailer transport layer, exercised with SCRIPTED FAKE TRANSPORTS per
 * spec Verification row 31 — no live provider account involved.
 */

/** A scripted SMTP transport recording every sendMail call. */
function scriptedSmtp(impl: (msg: unknown) => Promise<unknown>): {
  calls: Array<Record<string, string>>;
  transport: SmtpTransport;
} {
  const calls: Array<Record<string, string>> = [];
  return {
    calls,
    transport: {
      async sendMail(message) {
        calls.push(message as unknown as Record<string, string>);
        return impl(message);
      },
    },
  };
}

/** A nodemailer-shaped SMTP rejection (`responseCode` carries the provider code). */
function smtpRejection(code: number, message: string): Error {
  return Object.assign(new Error(message), { responseCode: code });
}

/** A nodemailer-shaped connection failure (errno string on `code`, no responseCode). */
function connectionFailure(errno: string): Error {
  return Object.assign(new Error(`connect failed (${errno})`), {
    code: errno,
  });
}

/** A scripted Resend HTTP endpoint (fetch fake) recording every request. */
function scriptedResend(
  status: number,
  body = '{"id":"re_123"}',
): {
  calls: Array<{ url: string; init: RequestInit }>;
  fetchFn: typeof fetch;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

/** A recording {@link RelayObservability} fake. */
function recordingObservability(): {
  failovers: FailoverEvent[];
  failures: RelayFailureEvent[];
  sink: RelayObservability;
} {
  const failovers: FailoverEvent[] = [];
  const failures: RelayFailureEvent[] = [];
  return {
    failovers,
    failures,
    sink: {
      failover: (e) => failovers.push(e),
      relayFailure: (e) => failures.push(e),
    },
  };
}

interface MailerFixtureOptions {
  real?: (msg: unknown) => Promise<unknown>;
  intercept?: (msg: unknown) => Promise<unknown>;
  resendFetch?: typeof fetch;
  /** Omit to leave the Resend channel unconfigured. */
  resendApiKey?: string | undefined;
  flagOn?: boolean;
  observability?: RelayObservability;
  warn?: (m: string) => void;
}

function makeMailer(opts: MailerFixtureOptions): {
  mailer: SmtpMailer;
  realCalls: Array<Record<string, string>>;
  interceptCalls: Array<Record<string, string>>;
} {
  const real = scriptedSmtp(opts.real ?? (async () => ({ response: "250 OK" })));
  const intercept = scriptedSmtp(
    opts.intercept ?? (async () => ({ response: "250 OK" })),
  );
  const config: SmtpMailerConfig = {
    intercept: { host: "mailpit.local", port: 1025, from: "dev@doctor.school" },
    real: {
      host: "smtp.mail.ru",
      port: 465,
      user: "noreply@doctor.school",
      password: "app-password",
      from: "noreply@doctor.school",
    },
    resend:
      opts.resendApiKey === undefined
        ? undefined
        : {
            apiKey: opts.resendApiKey,
            from: "noreply@doctor.school",
            fetchFn: opts.resendFetch,
          },
    isEnabled: () => opts.flagOn ?? true,
    portalBaseUrl: "https://app.doctor.school",
    transportFactory: (o) =>
      o.host === "smtp.mail.ru" ? real.transport : intercept.transport,
    observability: opts.observability,
    warn: opts.warn ?? (() => {}),
  };
  return {
    mailer: new SmtpMailer(config),
    realCalls: real.calls,
    interceptCalls: intercept.calls,
  };
}

describe("003 EARS-31 SmtpMailer failover chain (design §14.3)", () => {
  it("EARS-31.1: when mail.ru rejects with 451 Ratelimit exceeded, the system shall switch to Resend within the same send and deliver", async () => {
    const resend = scriptedResend(200);
    const obs = recordingObservability();
    const { mailer, realCalls } = makeMailer({
      real: async () => {
        throw smtpRejection(451, "451 Ratelimit exceeded");
      },
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      observability: obs.sink,
    });

    await mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");

    expect(realCalls).toHaveLength(1);
    expect(resend.calls).toHaveLength(1);
    expect(obs.failovers).toHaveLength(1);
    expect(obs.failovers[0]).toMatchObject({
      from: "mail.ru",
      to: "resend",
      code: "451",
    });
    // Delivered via the failover channel ⇒ NOT a relay failure.
    expect(obs.failures).toHaveLength(0);
  });

  it("EARS-31.2: when the active channel fails with a connection failure, the system shall switch to the other channel within the same send", async () => {
    const resend = scriptedResend(200);
    const obs = recordingObservability();
    const { mailer, realCalls } = makeMailer({
      real: async () => {
        throw connectionFailure("ECONNREFUSED");
      },
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      observability: obs.sink,
    });

    await mailer.sendPasswordResetCodeEmail("doctor@example.com", "XYZ789");

    expect(realCalls).toHaveLength(1);
    expect(resend.calls).toHaveLength(1);
    expect(obs.failovers[0]).toMatchObject({
      from: "mail.ru",
      code: "ECONNREFUSED",
      to: "resend",
    });
  });

  it("EARS-31.3: the system shall count a send as delivered only on a 2xx provider acceptance — a resolved non-2xx SMTP response still fails over", async () => {
    const resend = scriptedResend(200);
    const obs = recordingObservability();
    const { mailer, realCalls } = makeMailer({
      // nodemailer resolved, but the provider did NOT accept with a 2xx.
      real: async () => ({ response: "554 Transaction failed" }),
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      observability: obs.sink,
    });

    await mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");

    expect(realCalls).toHaveLength(1);
    expect(resend.calls).toHaveLength(1);
    expect(obs.failovers[0]).toMatchObject({ from: "mail.ru", code: "554" });
  });

  it("EARS-31.4: when both channels fail (mail.ru 451, Resend 429) the send shall fail closed with both provider codes and never re-try a rejected channel", async () => {
    const resend = scriptedResend(429, '{"message":"rate limited"}');
    const obs = recordingObservability();
    const { mailer, realCalls, interceptCalls } = makeMailer({
      real: async () => {
        throw smtpRejection(451, "451 Ratelimit exceeded");
      },
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      observability: obs.sink,
    });

    await expect(
      mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/mail\.ru=451.*resend=429/);

    // ONE attempt per channel — never a same-channel retry (EARS-31).
    expect(realCalls).toHaveLength(1);
    expect(resend.calls).toHaveLength(1);
    // The intercept transport is NOT a hidden third channel on the real path.
    expect(interceptCalls).toHaveLength(0);
    // Fail-closed is logged with BOTH provider response codes (EARS-32).
    expect(obs.failures).toHaveLength(1);
    expect(obs.failures[0]!.attempts).toEqual([
      expect.objectContaining({ provider: "mail.ru", code: "451" }),
      expect.objectContaining({ provider: "resend", code: "429" }),
    ]);
  });

  it("EARS-31.5: when Resend is the only configured real channel, a Resend 429 shall fail closed (no same-channel retry, no silent success)", async () => {
    const resend = scriptedResend(429, '{"message":"rate limited"}');
    const obs = recordingObservability();
    const { mailer } = makeMailer({
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      observability: obs.sink,
    });
    // Drop mail.ru from the chain: simulate the unconfigured-primary edge by
    // building a mailer whose real SMTP host is absent.
    const single = new SmtpMailer({
      intercept: { host: undefined },
      resend: {
        apiKey: "re_test_key",
        from: "noreply@doctor.school",
        fetchFn: resend.fetchFn,
      },
      isEnabled: () => true,
      portalBaseUrl: "https://app.doctor.school",
      observability: obs.sink,
      warn: () => {},
    });

    await expect(
      single.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/resend=429/);
    expect(resend.calls).toHaveLength(1);
    expect(obs.failures).toHaveLength(1);
    expect(mailer).toBeDefined();
  });

  it("EARS-31.6: a mail.ru 2xx acceptance shall deliver on the primary — Resend is never contacted and no failover is recorded", async () => {
    const resend = scriptedResend(200);
    const obs = recordingObservability();
    const { mailer, realCalls } = makeMailer({
      real: async () => ({ response: "250 2.0.0 OK queued" }),
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      observability: obs.sink,
    });

    await mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");

    expect(realCalls).toHaveLength(1);
    expect(resend.calls).toHaveLength(0);
    expect(obs.failovers).toHaveLength(0);
    expect(obs.failures).toHaveLength(0);
  });

  it("EARS-31.7: sink mode (#209) is preserved — flag OFF routes to the Mailpit intercept only, and an intercept failure never fails over to a real channel", async () => {
    const resend = scriptedResend(200);
    const obs = recordingObservability();
    const { mailer, realCalls, interceptCalls } = makeMailer({
      intercept: async () => {
        throw connectionFailure("ECONNREFUSED");
      },
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      flagOn: false,
      observability: obs.sink,
    });

    await expect(
      mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/mailpit=ECONNREFUSED/);

    expect(interceptCalls).toHaveLength(1);
    // NEVER leak a sink-mode send to a real provider (mail.ru or Resend).
    expect(realCalls).toHaveLength(0);
    expect(resend.calls).toHaveLength(0);
    expect(obs.failovers).toHaveLength(0);
    expect(obs.failures).toHaveLength(1);
  });

  it("EARS-31.8: sink mode captures the full artifact — a flag-OFF send lands the composed mail in the intercept transport", async () => {
    const { mailer, interceptCalls } = makeMailer({ flagOn: false });

    await mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");

    expect(interceptCalls).toHaveLength(1);
    expect(interceptCalls[0]!.to).toBe("doctor@example.com");
    expect(interceptCalls[0]!.subject).toContain("ABC123");
  });

  it("EARS-31.9: the fail-closed error and the observability payloads never carry the one-time code (EARS-30), even when the provider rejection echoes it", async () => {
    const code = "SECRET1";
    const resend = scriptedResend(
      500,
      `{"message":"could not deliver mail containing ${"SECRET1"}"}`,
    );
    const obs = recordingObservability();
    const { mailer } = makeMailer({
      real: async () => {
        // A provider rejection that echoes the outbound message (and thus the code).
        throw smtpRejection(451, `451 rejected message with body ${code}`);
      },
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      observability: obs.sink,
    });

    let thrown: Error | undefined;
    try {
      await mailer.sendVerificationCodeEmail("doctor@example.com", code);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown?.message).not.toContain(code);
    expect(JSON.stringify(obs.failovers)).not.toContain(code);
    expect(JSON.stringify(obs.failures)).not.toContain(code);
  });

  it("EARS-31.10: the Resend adapter authenticates with the configured key and posts the composed artifact to the provider", async () => {
    const resend = scriptedResend(200);
    const { mailer } = makeMailer({
      real: async () => {
        throw smtpRejection(451, "451 Ratelimit exceeded");
      },
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
    });

    await mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");

    expect(resend.calls).toHaveLength(1);
    const { url, init } = resend.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(
      (init.headers as Record<string, string>)["Authorization"],
    ).toBe("Bearer re_test_key");
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.to).toEqual(["doctor@example.com"]);
    expect(payload.from).toBe("noreply@doctor.school");
    expect(String(payload.subject)).toContain("ABC123");
  });
});

describe("003 EARS-32 relay observability (design §14.3)", () => {
  it("EARS-32.1: every failover emits a structured log, a Prometheus counter increment (provider + code), and a GlitchTip event", async () => {
    register.clear();
    const logs: string[] = [];
    const captured: Array<{ message: string; level: string }> = [];
    const obs = new DefaultRelayObservability({
      warn: (m) => logs.push(m),
      error: (m) => logs.push(m),
      capture: (message, level) => captured.push({ message, level }),
    });

    obs.failover({
      context: "verification-code email",
      from: "mail.ru",
      code: "451",
      to: "resend",
    });

    const structured = logs.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(structured[0]).toMatchObject({
      event: "mailer_failover",
      provider: "mail.ru",
      code: "451",
      failover_to: "resend",
    });
    const metric = await register
      .getSingleMetric(MAILER_RELAY_EVENTS_METRIC)
      ?.get();
    expect(metric?.values).toEqual([
      expect.objectContaining({
        value: 1,
        labels: expect.objectContaining({
          event: "failover",
          provider: "mail.ru",
          code: "451",
        }),
      }),
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.level).toBe("warning");
    expect(captured[0]!.message).toContain("mail.ru");
  });

  it("EARS-32.2: every relay failure emits the structured log, one counter increment per failed provider (with its response code), and a GlitchTip event", async () => {
    register.clear();
    const logs: string[] = [];
    const captured: Array<{ message: string; level: string }> = [];
    const obs = new DefaultRelayObservability({
      warn: (m) => logs.push(m),
      error: (m) => logs.push(m),
      capture: (message, level) => captured.push({ message, level }),
    });

    obs.relayFailure({
      context: "password-reset-code email",
      attempts: [
        { provider: "mail.ru", code: "451" },
        { provider: "resend", code: "429" },
      ],
    });

    const structured = logs.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(structured[0]).toMatchObject({ event: "mailer_relay_failure" });
    expect(JSON.stringify(structured[0])).toContain("451");
    expect(JSON.stringify(structured[0])).toContain("429");
    const metric = await register
      .getSingleMetric(MAILER_RELAY_EVENTS_METRIC)
      ?.get();
    expect(metric?.values).toHaveLength(2);
    expect(metric?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: expect.objectContaining({
            event: "relay_failure",
            provider: "mail.ru",
            code: "451",
          }),
        }),
        expect.objectContaining({
          labels: expect.objectContaining({
            event: "relay_failure",
            provider: "resend",
            code: "429",
          }),
        }),
      ]),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.level).toBe("error");
  });

  it("EARS-32.3: SmtpMailer wired with the default observability reports failover through the real sinks — degraded-channel state is visible, never silent", async () => {
    register.clear();
    const logs: string[] = [];
    const captured: Array<{ message: string; level: string }> = [];
    const resend = scriptedResend(200);
    const { mailer } = makeMailer({
      real: async () => {
        throw smtpRejection(451, "451 Ratelimit exceeded");
      },
      resendApiKey: "re_test_key",
      resendFetch: resend.fetchFn,
      observability: new DefaultRelayObservability({
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
        capture: (message, level) => captured.push({ message, level }),
      }),
    });

    await mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");

    expect(logs.length).toBeGreaterThan(0);
    const metric = await register
      .getSingleMetric(MAILER_RELAY_EVENTS_METRIC)
      ?.get();
    expect(metric?.values?.[0]?.value).toBe(1);
    expect(captured).toHaveLength(1);
  });
});
