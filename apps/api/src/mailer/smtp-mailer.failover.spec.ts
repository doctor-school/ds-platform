import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "prom-client";
import { ChannelRejection } from "./relay-channel.js";
import {
  DefaultRelayObservability,
  MAILER_RELAY_EVENTS_METRIC,
  type AttemptEvent,
  type ChainEvent,
  type ConfigurationErrorEvent,
  type RelayObservability,
} from "./relay-observability.js";
import {
  MAIL_CHAIN_BUDGET_MS,
  SmtpMailer,
  type SmtpMailerConfig,
  type SmtpSendOptions,
  type SmtpTransport,
} from "./smtp-mailer.js";

/**
 * 003 EARS-31/32/45 (#2144, design §14.3): the Postbox → mail.ru → Resend
 * chain exercised with SCRIPTED FAKE TRANSPORTS — no live provider account.
 */

type Script = (msg: unknown, options?: SmtpSendOptions) => Promise<unknown>;

function scriptedSmtp(impl: Script): {
  calls: Array<Record<string, string>>;
  options: Array<SmtpSendOptions | undefined>;
  transport: SmtpTransport;
} {
  const calls: Array<Record<string, string>> = [];
  const options: Array<SmtpSendOptions | undefined> = [];
  return {
    calls,
    options,
    transport: {
      async sendMail(message, opts) {
        calls.push(message as unknown as Record<string, string>);
        options.push(opts);
        return impl(message, opts);
      },
    },
  };
}

const ok: Script = async () => ({ response: "250 2.0.0 OK queued" });
function reply(command: string, response: string): Script {
  return async () => {
    throw Object.assign(new Error(`failed: ${response}`), {
      command,
      response,
      responseCode: Number(response.slice(0, 3)),
    });
  };
}
function errno(code: string): Script {
  return async () => {
    throw Object.assign(new Error(`socket ${code}`), { code });
  };
}
/** Honors the effective deadline like the owned-socket transport does. */
function stallUntilDeadline(outcome: "provider-failure" | "ambiguous"): Script {
  return (_msg, opts) =>
    new Promise((_resolve, reject) =>
      setTimeout(
        () => reject(new ChannelRejection("timeout", "deadline", outcome)),
        Math.min(15_000, opts?.deadlineMs ?? 15_000),
      ),
    );
}

function scriptedResend(
  status: number,
  body = '{"id":"re_123"}',
): { calls: Array<{ url: string; init: RequestInit }>; fetchFn: typeof fetch } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

function recordingObservability(): {
  attempts: AttemptEvent[];
  chains: ChainEvent[];
  configErrors: ConfigurationErrorEvent[];
  sink: RelayObservability;
} {
  const attempts: AttemptEvent[] = [];
  const chains: ChainEvent[] = [];
  const configErrors: ConfigurationErrorEvent[] = [];
  return {
    attempts,
    chains,
    configErrors,
    sink: {
      attempt: (e) => attempts.push(e),
      chain: (e) => chains.push(e),
      configurationError: (e) => configErrors.push(e),
    },
  };
}

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

interface Options {
  postbox?: Script;
  mailru?: Script;
  intercept?: Script;
  resend?: { status: number; body?: string } | false;
  resendEnabled?: boolean;
  mailruEnabled?: boolean;
  config?: Partial<SmtpMailerConfig>;
}

function chain(opts: Options = {}) {
  const postbox = scriptedSmtp(opts.postbox ?? ok);
  const mailru = scriptedSmtp(opts.mailru ?? ok);
  const intercept = scriptedSmtp(opts.intercept ?? ok);
  const resend = scriptedResend(
    opts.resend ? opts.resend.status : 200,
    opts.resend ? opts.resend.body : undefined,
  );
  const obs = recordingObservability();
  const config: SmtpMailerConfig = {
    intercept: { host: "mailpit.local", port: 1025, from: "dev@doctor.school" },
    real: POSTBOX,
    fallback: { ...MAILRU, enabled: opts.mailruEnabled ?? true },
    resend: {
      enabled: opts.resendEnabled ?? true,
      apiKey: "re_test_key",
      from: "noreply@doctor.school",
      fetchFn: resend.fetchFn,
    },
    isEnabled: () => true,
    transportFactory: (o) =>
      o.host === "postbox.cloud.yandex.net"
        ? postbox.transport
        : o.host === "smtp.mail.ru"
          ? mailru.transport
          : intercept.transport,
    observability: obs.sink,
    ...opts.config,
  };
  return {
    mailer: new SmtpMailer(config),
    postbox,
    mailru,
    intercept,
    resend,
    obs,
  };
}

const send = (m: SmtpMailer, code = "ABC123") =>
  m.sendVerificationCodeEmail("doctor@example.com", code);

afterEach(() => {
  vi.useRealTimers();
});

describe("003 EARS-31 Postbox → mail.ru → Resend chain (design §14.3)", () => {
  it("EARS-31: tries Postbox, then the mail.ru reserve, then Resend, in that order, one attempt each", async () => {
    const f = chain({
      postbox: reply("RCPT TO", "451 4.7.1 try later"),
      mailru: errno("ECONNREFUSED"),
    });
    await send(f.mailer);
    expect(f.obs.attempts.map((a) => a.provider)).toEqual([
      "postbox",
      "mail.ru",
      "resend",
    ]);
    expect(f.postbox.calls).toHaveLength(1);
    expect(f.mailru.calls).toHaveLength(1);
    expect(f.resend.calls).toHaveLength(1);
    expect(f.intercept.calls).toHaveLength(0);
    expect(f.obs.chains).toEqual([
      expect.objectContaining({ outcome: "accepted-by-resend", skipped: 0 }),
    ]);
  });

  it("EARS-31: a Postbox acceptance stops the chain — no reserve is contacted", async () => {
    const f = chain();
    await send(f.mailer);
    expect(f.mailru.calls).toHaveLength(0);
    expect(f.resend.calls).toHaveLength(0);
    expect(f.obs.chains).toEqual([
      expect.objectContaining({ outcome: "accepted-by-postbox" }),
    ]);
  });

  it("EARS-31: credentials alone are inert — switched-off reserves are skipped and counted as skipped, never tried", async () => {
    const f = chain({
      postbox: reply("DATA", "451 4.3.0 local error"),
      mailruEnabled: false,
      resendEnabled: false,
    });
    await expect(send(f.mailer)).rejects.toThrow(/exhausted.*postbox=451/);
    expect(f.mailru.calls).toHaveLength(0);
    expect(f.resend.calls).toHaveLength(0);
    expect(f.obs.chains).toEqual([
      expect.objectContaining({ outcome: "exhausted", skipped: 2 }),
    ]);
  });

  it("EARS-31: switching mail.ru off returns the chain to Postbox → Resend", async () => {
    const f = chain({
      postbox: reply("MAIL FROM", "553 5.1.8 sender rejected"),
      mailruEnabled: false,
    });
    await send(f.mailer);
    expect(f.obs.attempts.map((a) => a.provider)).toEqual([
      "postbox",
      "resend",
    ]);
    expect(f.obs.chains[0]).toMatchObject({
      outcome: "accepted-by-resend",
      skipped: 1,
    });
  });

  it("EARS-31: enabled-but-incomplete reserves, a reserve equal to a mail.ru primary and a missing or unknown primary are configuration errors that reach no provider and never Mailpit", async () => {
    const cases: Array<Partial<SmtpMailerConfig>> = [
      { fallback: { ...MAILRU, password: " " } },
      {
        real: { ...POSTBOX, provider: "mail.ru", host: "smtp.mail.ru" },
      },
      { resend: { enabled: true, apiKey: " " } },
      { real: undefined },
      { real: { ...POSTBOX, provider: "sendgrid" } },
      { real: { ...POSTBOX, host: "smtp.mail.ru" } },
    ];
    for (const config of cases) {
      const f = chain({ config });
      await expect(send(f.mailer)).rejects.toThrow(
        "Mailer: invalid transport configuration",
      );
      expect(f.postbox.calls).toHaveLength(0);
      expect(f.mailru.calls).toHaveLength(0);
      expect(f.intercept.calls).toHaveLength(0);
      expect(f.resend.calls).toHaveLength(0);
      expect(f.obs.configErrors).toHaveLength(1);
      expect(JSON.stringify(f.obs.configErrors)).not.toMatch(
        /key-secret|app-password|re_test_key/,
      );
    }
  });

  it("EARS-31: every channel sends the same code in the identical composed content, with no tracking or footer fields", async () => {
    const f = chain({
      postbox: errno("ECONNREFUSED"),
      mailru: reply("RCPT TO", "450 4.2.1 busy"),
    });
    await send(f.mailer, "QWE987");
    const p = f.postbox.calls[0]!;
    const m = f.mailru.calls[0]!;
    const payload = JSON.parse(String(f.resend.calls[0]!.init.body)) as Record<
      string,
      unknown
    >;
    for (const field of ["subject", "text", "html"] as const) {
      expect(m[field]).toBe(p[field]);
      expect(payload[field]).toBe(p[field]);
    }
    expect(p.text).toContain("QWE987");
    expect(Object.keys(payload).sort()).toEqual(
      ["from", "html", "subject", "text", "to"].sort(),
    );
    expect(Object.keys(p).sort()).toEqual(
      ["from", "html", "subject", "text", "to"].sort(),
    );
  });

  const CODE_FAMILIES: Array<{
    family: string;
    sendCode: (m: SmtpMailer, code: string) => Promise<void>;
  }> = [
    {
      family: "verification code",
      sendCode: (m, code) =>
        m.sendVerificationCodeEmail("doctor@example.com", code),
    },
    {
      family: "password-reset code",
      sendCode: (m, code) =>
        m.sendPasswordResetCodeEmail("doctor@example.com", code),
    },
    {
      family: "login code (5 min)",
      sendCode: (m, code) =>
        m.sendLoginCodeEmail("doctor@example.com", code, "5m"),
    },
    {
      family: "login code (1 h hand-off)",
      sendCode: (m, code) =>
        m.sendLoginCodeEmail("doctor@example.com", code, "1h"),
    },
    {
      family: "re-registration code",
      sendCode: (m, code) =>
        m.sendReRegistrationCodeEmail("doctor@example.com", code, {
          lifetime: "1h",
          passwordKept: true,
        }),
    },
  ];

  it("EARS-31: every code-email family — verification, password reset, login (5 min and 1 h) and re-registration — fails over Postbox → mail.ru → Resend with the identical code and content, one attempt each", async () => {
    for (const { family, sendCode } of CODE_FAMILIES) {
      const f = chain({
        postbox: reply("RCPT TO", "451 4.7.1 try later"),
        mailru: errno("ECONNREFUSED"),
      });
      await sendCode(f.mailer, "LGN482");
      expect(
        f.obs.attempts.map((a) => a.provider),
        family,
      ).toEqual(["postbox", "mail.ru", "resend"]);
      expect(f.postbox.calls, family).toHaveLength(1);
      expect(f.mailru.calls, family).toHaveLength(1);
      expect(f.resend.calls, family).toHaveLength(1);
      expect(f.intercept.calls, family).toHaveLength(0);
      const p = f.postbox.calls[0]!;
      const m = f.mailru.calls[0]!;
      const payload = JSON.parse(
        String(f.resend.calls[0]!.init.body),
      ) as Record<string, unknown>;
      for (const field of ["subject", "text", "html"] as const) {
        expect(m[field], `${family} ${field}`).toBe(p[field]);
        expect(payload[field], `${family} ${field}`).toBe(p[field]);
      }
      expect(p.text, family).toContain("LGN482");
      expect(p.to, family).toBe("doctor@example.com");
      expect(f.obs.chains, family).toEqual([
        expect.objectContaining({ outcome: "accepted-by-resend", skipped: 0 }),
      ]);
    }
  });

  it("EARS-31: a login-code email that every channel refuses throws the sanitized chain error — provider codes only, never the code or address", async () => {
    const f = chain({
      postbox: reply("RCPT TO", "451 4.7.1 doctor@example.com LGN482"),
      mailru: errno("ECONNREFUSED"),
      resend: { status: 429, body: '{"message":"LGN482 doctor@example.com"}' },
    });
    const err = (await f.mailer
      .sendLoginCodeEmail("doctor@example.com", "LGN482")
      .catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/exhausted.*postbox=451 4\.7\.1.*resend=429/);
    expect(f.obs.attempts.map((a) => a.provider)).toEqual([
      "postbox",
      "mail.ru",
      "resend",
    ]);
    expect(
      JSON.stringify([err.message, f.obs.attempts, f.obs.chains]),
    ).not.toMatch(/LGN482|doctor@example\.com|key-secret|re_test_key/);
  });

  it("EARS-31: the total budget is 40 s and each attempt gets the lesser of its channel deadline and the remaining budget", async () => {
    expect(MAIL_CHAIN_BUDGET_MS).toBe(40_000);
    vi.useFakeTimers();
    const f = chain({
      postbox: stallUntilDeadline("provider-failure"),
      mailru: stallUntilDeadline("provider-failure"),
      config: { budgetMs: 20_000 },
    });
    const result = expect(send(f.mailer)).rejects.toThrow(/stopped-budget/);
    await vi.advanceTimersByTimeAsync(20_000);
    await result;
    expect(f.postbox.options[0]?.deadlineMs).toBe(20_000);
    expect(f.mailru.options[0]?.deadlineMs).toBe(5_000);
    expect(f.resend.calls).toHaveLength(0);
    expect(f.obs.chains).toEqual([
      expect.objectContaining({ outcome: "stopped-budget" }),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("EARS-31: chain duration never changes the thrown error shape — it carries provider codes, never the code, address or secrets", async () => {
    const f = chain({
      postbox: reply("RCPT TO", "451 4.7.1 doctor@example.com SECRET1"),
      mailru: reply("RCPT TO", "451 4.7.1 app-password"),
      resend: { status: 429, body: '{"message":"SECRET1"}' },
    });
    const err = (await send(f.mailer, "SECRET1").catch(
      (e: unknown) => e,
    )) as Error;
    expect(err.message).toMatch(
      /postbox=451 4\.7\.1, mail\.ru=451 4\.7\.1, resend=429/,
    );
    const everything = JSON.stringify([
      err.message,
      f.obs.attempts,
      f.obs.chains,
    ]);
    expect(everything).not.toMatch(
      /SECRET1|doctor@example\.com|app-password|key-secret|re_test_key/,
    );
  });

  it("EARS-31: intercept mode routes to Mailpit only, and an intercept failure never reaches a real channel", async () => {
    const f = chain({
      intercept: errno("ECONNREFUSED"),
      config: { isEnabled: () => false },
    });
    await expect(send(f.mailer)).rejects.toThrow(/mailpit=ECONNREFUSED/);
    expect(f.intercept.calls).toHaveLength(1);
    expect(f.postbox.calls).toHaveLength(0);
    expect(f.mailru.calls).toHaveLength(0);
    expect(f.resend.calls).toHaveLength(0);
  });
});

describe("003 EARS-45 chain routing by outcome class (design §14.3)", () => {
  it("EARS-45: a recipient-permanent RCPT TO reply stops the chain at once", async () => {
    const f = chain({ postbox: reply("RCPT TO", "550 5.1.1 unknown user") });
    await expect(send(f.mailer)).rejects.toThrow(/stopped-recipient-permanent/);
    expect(f.mailru.calls).toHaveLength(0);
    expect(f.resend.calls).toHaveLength(0);
    expect(f.obs.attempts[0]).toMatchObject({
      provider: "postbox",
      outcome: "recipient-permanent",
      code: "550 5.1.1",
    });
  });

  it("EARS-45: a bare 550, 550 5.7.1 at RCPT, 535 and any MAIL FROM reply move to the next channel", async () => {
    for (const script of [
      reply("RCPT TO", "550 rejected"),
      reply("RCPT TO", "550 5.7.1 relaying denied"),
      reply("AUTH PLAIN", "535 5.7.8 bad credentials"),
      reply("MAIL FROM", "553 5.1.8 bad sender"),
      errno("ENOTFOUND"),
    ]) {
      const f = chain({ postbox: script });
      await send(f.mailer);
      expect(f.mailru.calls).toHaveLength(1);
      expect(f.obs.attempts[0]!.outcome).toBe("provider-failure");
      expect(f.obs.chains[0]!.outcome).toBe("accepted-by-mail.ru");
    }
  });

  it("EARS-45: an ambiguous attempt (timeout with unproven phase) stops the chain with no second send", async () => {
    const f = chain({ postbox: errno("ETIMEDOUT") });
    await expect(send(f.mailer)).rejects.toThrow(/stopped-ambiguous/);
    expect(f.postbox.calls).toHaveLength(1);
    expect(f.mailru.calls).toHaveLength(0);
    expect(f.resend.calls).toHaveLength(0);
    expect(f.obs.attempts[0]!.outcome).toBe("ambiguous");
  });

  it("EARS-45: a timeout proven before end-of-data is provider-failure and moves on", async () => {
    const f = chain({
      postbox: async () => {
        throw new ChannelRejection("timeout", "deadline", "provider-failure");
      },
    });
    await send(f.mailer);
    expect(f.obs.chains[0]!.outcome).toBe("accepted-by-mail.ru");
  });

  it("EARS-45: Resend 429 and non-recipient 4xx exhaust, 5xx is ambiguous, a recipient validation error stops", async () => {
    const cases: Array<[number, string, string, string]> = [
      [429, '{"name":"rate_limit_exceeded"}', "provider-failure", "exhausted"],
      [403, '{"name":"invalid_from_address"}', "provider-failure", "exhausted"],
      [
        500,
        '{"name":"internal_server_error"}',
        "ambiguous",
        "stopped-ambiguous",
      ],
      [
        422,
        '{"name":"validation_error","message":"Invalid `to` field."}',
        "recipient-permanent",
        "stopped-recipient-permanent",
      ],
    ];
    for (const [status, body, attempt, terminal] of cases) {
      const f = chain({
        postbox: errno("ECONNREFUSED"),
        mailru: errno("ECONNREFUSED"),
        resend: { status, body },
      });
      await expect(send(f.mailer)).rejects.toThrow(terminal);
      expect(f.obs.attempts[2]).toMatchObject({
        provider: "resend",
        outcome: attempt,
      });
      expect(f.obs.chains[0]!.outcome).toBe(terminal);
    }
  });

  it("EARS-45: budget expiry classifies the in-flight attempt by phase and tries no further channel", async () => {
    vi.useFakeTimers();
    const f = chain({
      postbox: errno("ECONNREFUSED"),
      mailru: stallUntilDeadline("ambiguous"),
      config: { budgetMs: 10_000 },
    });
    const result = expect(send(f.mailer)).rejects.toThrow(/stopped-budget/);
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(f.obs.attempts[1]).toMatchObject({
      provider: "mail.ru",
      outcome: "ambiguous",
    });
    expect(f.resend.calls).toHaveLength(0);
  });
});

describe("003 EARS-32 relay observability (design §14.3)", () => {
  it("EARS-32: every attempt names the actual provider and class, and each send emits exactly one terminal outcome with the skipped count", async () => {
    const f = chain({
      postbox: reply("RCPT TO", "451 4.7.1 later"),
      mailruEnabled: false,
    });
    await send(f.mailer);
    expect(f.obs.attempts).toEqual([
      expect.objectContaining({
        provider: "postbox",
        outcome: "provider-failure",
        code: "451 4.7.1",
        context: "verification-code email",
      }),
      expect.objectContaining({
        provider: "resend",
        outcome: "accepted",
        code: "accepted",
      }),
    ]);
    expect(f.obs.chains).toHaveLength(1);
    expect(f.obs.chains[0]).toMatchObject({
      outcome: "accepted-by-resend",
      skipped: 1,
    });
  });

  it("EARS-32: the default sinks emit structured logs, labelled counters and GlitchTip events with no recipient, code or secret", async () => {
    register.clear();
    const logs: string[] = [];
    const captured: Array<{ message: string; level: string }> = [];
    const sink = new DefaultRelayObservability({
      log: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => logs.push(m),
      capture: (message, level) => captured.push({ message, level }),
    });
    const f = chain({
      postbox: reply("RCPT TO", "451 4.7.1 doctor@example.com ABC123"),
      mailru: reply("DATA", "554 5.6.0 key-secret"),
      resend: { status: 429 },
      config: { observability: sink },
    });
    await expect(send(f.mailer)).rejects.toThrow(/exhausted/);
    const structured = logs.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(structured.map((s) => s.event)).toEqual([
      "mailer_attempt",
      "mailer_attempt",
      "mailer_attempt",
      "mailer_chain",
    ]);
    expect(structured[3]).toMatchObject({ outcome: "exhausted", skipped: 0 });
    const metric = await register
      .getSingleMetric(MAILER_RELAY_EVENTS_METRIC)
      ?.get();
    expect(metric?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: expect.objectContaining({
            event: "attempt",
            provider: "mail.ru",
            outcome: "provider-failure",
            code: "554 5.6.0",
          }),
        }),
        expect.objectContaining({
          labels: expect.objectContaining({
            event: "chain",
            outcome: "exhausted",
            skipped: "0",
          }),
        }),
      ]),
    );
    expect(captured).toEqual([expect.objectContaining({ level: "error" })]);
    expect(JSON.stringify([logs, captured, metric])).not.toMatch(
      /doctor@example\.com|ABC123|key-secret|re_test_key|Ваш код/,
    );
  });

  it("EARS-32: acceptance is reported as accepted-by-<provider>, never as delivered; degraded acceptance warns GlitchTip", async () => {
    register.clear();
    const logs: string[] = [];
    const captured: Array<{ level: string }> = [];
    const f = chain({
      postbox: errno("ECONNREFUSED"),
      config: {
        observability: new DefaultRelayObservability({
          log: (m) => logs.push(m),
          warn: (m) => logs.push(m),
          error: (m) => logs.push(m),
          capture: (_m, level) => captured.push({ level }),
        }),
      },
    });
    await send(f.mailer);
    expect(logs.join("\n")).not.toMatch(/deliver/i);
    expect(logs.at(-1)).toContain('"outcome":"accepted-by-mail.ru"');
    expect(captured).toEqual([{ level: "warning" }]);
  });
});
