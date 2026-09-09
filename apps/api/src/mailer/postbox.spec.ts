import { describe, expect, it, vi } from "vitest";
import { SmtpMailer, type SmtpMailerConfig } from "./smtp-mailer.js";

function fixture(overrides: Partial<SmtpMailerConfig> = {}) {
  const smtp = vi.fn().mockResolvedValue({ response: "250 accepted" });
  const http = vi.fn().mockResolvedValue(new Response("{}"));
  const failover = vi.fn();
  const relayFailure = vi.fn();
  const accepted = vi.fn();
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
    portalBaseUrl: "https://academy.doctor.school",
    transportFactory: () => ({ sendMail: smtp }),
    observability: { failover, relayFailure, accepted },
    ...overrides,
  } as SmtpMailerConfig;
  return {
    mailer: new SmtpMailer(config),
    smtp,
    http,
    failover,
    relayFailure,
    accepted,
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
  it("EARS-32: definite Postbox rejection can use enabled fallback exactly once", async () => {
    const http = vi.fn().mockResolvedValue(new Response("{}"));
    const f = fixture({
      resend: { enabled: true, apiKey: "key", fetchFn: http },
    });
    f.smtp.mockRejectedValue(
      Object.assign(new Error("recipient ABC123"), { responseCode: 550 }),
    );
    await f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");
    expect(http).toHaveBeenCalledTimes(1);
    expect(f.accepted).toHaveBeenCalledWith({
      context: "verification-code email",
      provider: "resend",
      route: "fallback",
    });
    expect(f.failover).toHaveBeenCalledWith({
      context: "verification-code email",
      from: "postbox",
      code: "550",
      to: "resend",
    });
  });
  it("EARS-31: when real configuration is missing, shall reject without intercept or promoting Resend", async () => {
    const f = fixture({ real: undefined });
    await expect(
      f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/configuration/);
    expect(f.smtp).not.toHaveBeenCalled();
    expect(f.http).not.toHaveBeenCalled();
    expect(f.relayFailure).toHaveBeenCalled();
  });
  it("EARS-31: when credentials exist but fallback is disabled, shall leave Resend inert", async () => {
    const f = fixture();
    f.smtp.mockRejectedValue(
      Object.assign(
        new Error("provider echoed key-secret doctor@example.com ABC123"),
        { responseCode: 451 },
      ),
    );
    await expect(
      f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow(/postbox=451/);
    expect(f.http).not.toHaveBeenCalled();
    expect(JSON.stringify(f.relayFailure.mock.calls)).not.toMatch(
      /key-secret|doctor@example.com|ABC123/,
    );
  });
  it("EARS-31: when acceptance is uncertain, shall never automatically fail over", async () => {
    const http = vi.fn().mockResolvedValue(new Response("{}"));
    const f = fixture({
      resend: { enabled: true, apiKey: "key", fetchFn: http },
    } as Partial<SmtpMailerConfig>);
    f.smtp.mockRejectedValue(
      Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
    );
    await expect(
      f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123"),
    ).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
    expect(f.relayFailure.mock.calls[0]?.[0].outcome).toBe("uncertain");
  });
  it("EARS-32: when Postbox accepts, shall report primary acceptance rather than delivery", async () => {
    const f = fixture();
    await f.mailer.sendVerificationCodeEmail("doctor@example.com", "ABC123");
    expect(f.accepted).toHaveBeenCalledWith({
      context: "verification-code email",
      provider: "postbox",
      route: "primary",
    });
  });
});
