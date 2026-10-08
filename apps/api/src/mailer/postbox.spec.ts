import { describe, expect, it, vi } from "vitest";
import { SmtpMailer, type SmtpMailerConfig } from "./smtp-mailer.js";

function fixture(overrides: Partial<SmtpMailerConfig> = {}) {
  const smtp = vi.fn().mockResolvedValue({ response: "250 accepted" });
  const http = vi.fn().mockResolvedValue(new Response("{}"));
  const attempt = vi.fn();
  const chain = vi.fn();
  const configurationError = vi.fn();
  const config = {
    intercept: { host: "mailpit.test", port: 1025 },
    real: {
      provider: "postbox",
      host: "postbox.cloud.yandex.net",
      port: 465,
      user: "key-id",
      password: "key-secret",
      from: "noreply@doctor.school",
    },
    resend: { enabled: false, apiKey: "dormant-key", fetchFn: http },
    isEnabled: () => true,
    transportFactory: () => ({ sendMail: smtp }),
    observability: { attempt, chain, configurationError },
    ...overrides,
  } as SmtpMailerConfig;
  return {
    mailer: new SmtpMailer(config),
    smtp,
    http,
    attempt,
    chain,
    configurationError,
  };
}

describe("Postbox explicit topology", () => {
  it("EARS-31: validates real configuration after a live flag flip and never uses intercept", async () => {
    let real = false;
    const f = fixture({ real: undefined, isEnabled: () => real });
    await f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");
    real = true;
    await expect(
      f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/configuration/);
    expect(f.smtp).toHaveBeenCalledTimes(1);
    expect(f.http).not.toHaveBeenCalled();
  });
  it("EARS-31: enabled fallback without a key fails configuration before contacting primary", async () => {
    const f = fixture({ resend: { enabled: true, apiKey: " " } });
    await expect(
      f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/configuration/);
    expect(f.smtp).not.toHaveBeenCalled();
  });
  it("EARS-31: a definite Postbox rejection uses an enabled Resend exactly once", async () => {
    const http = vi.fn().mockResolvedValue(new Response("{}"));
    const f = fixture({
      resend: { enabled: true, apiKey: "key", fetchFn: http },
    });
    f.smtp.mockRejectedValue(
      Object.assign(new Error("recipient ABC123"), {
        responseCode: 550,
        command: "RCPT TO",
      }),
    );
    await f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");
    expect(http).toHaveBeenCalledTimes(1);
    expect(f.attempt.mock.calls.map(([e]) => [e.provider, e.outcome])).toEqual([
      ["postbox", "provider-failure"],
      ["resend", "accepted"],
    ]);
    expect(f.chain).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "accepted-by-resend", skipped: 1 }),
    );
  });
  it("EARS-31: when real configuration is missing, shall reject without intercept or promoting Resend", async () => {
    const f = fixture({ real: undefined });
    await expect(
      f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/configuration/);
    expect(f.smtp).not.toHaveBeenCalled();
    expect(f.http).not.toHaveBeenCalled();
    expect(f.configurationError).toHaveBeenCalledWith({
      context: "verification-code email",
      provider: "unconfigured",
    });
  });
  it("EARS-31: when credentials exist but Resend is disabled, it stays inert", async () => {
    const f = fixture();
    f.smtp.mockRejectedValue(
      Object.assign(
        new Error("provider echoed key-secret doctor@example.com ABC123"),
        { responseCode: 451 },
      ),
    );
    await expect(
      f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/exhausted.*postbox=451/);
    expect(f.http).not.toHaveBeenCalled();
    expect(
      JSON.stringify([f.attempt.mock.calls, f.chain.mock.calls]),
    ).not.toMatch(/key-secret|doctor@example.com|ABC123/);
  });
  it("EARS-45: an ambiguous attempt never automatically fails over", async () => {
    const http = vi.fn().mockResolvedValue(new Response("{}"));
    const f = fixture({
      resend: { enabled: true, apiKey: "key", fetchFn: http },
    } as Partial<SmtpMailerConfig>);
    f.smtp.mockRejectedValue(
      Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
    );
    await expect(
      f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/stopped-ambiguous/);
    expect(http).not.toHaveBeenCalled();
    expect(f.chain.mock.calls[0]?.[0].outcome).toBe("stopped-ambiguous");
  });
  it("EARS-32: when Postbox accepts, shall report accepted-by-postbox rather than delivery", async () => {
    const f = fixture();
    await f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");
    expect(f.attempt).toHaveBeenCalledWith({
      context: "verification-code email",
      provider: "postbox",
      outcome: "accepted",
      code: "accepted",
    });
    expect(f.chain).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "accepted-by-postbox" }),
    );
  });
});
