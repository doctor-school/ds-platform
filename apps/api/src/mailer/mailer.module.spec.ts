import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailerModule } from "./mailer.module.js";
import { MAILER } from "./mailer.types.js";
import type { SmtpMailerConfig } from "./smtp-mailer.js";
const capture = vi.hoisted(() => ({
  config: undefined as SmtpMailerConfig | undefined,
}));
vi.mock("./smtp-mailer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./smtp-mailer.js")>()),
  SmtpMailer: class {
    constructor(config: SmtpMailerConfig) {
      capture.config = config;
    }
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  capture.config = undefined;
});

function mailerFactory() {
  const providers = Reflect.getMetadata("providers", MailerModule) as Array<{
    provide: unknown;
    useFactory: (flags: unknown, synthetic: unknown) => unknown;
  }>;
  return providers.find((p) => p.provide === MAILER)!.useFactory;
}
const flags = (real: boolean) => ({ isEnabled: () => real });

function stubPrimary(
  provider = "postbox",
  host = "postbox.cloud.yandex.net:465",
) {
  vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
  vi.stubEnv("IDP_SMTP_REAL_PROVIDER", provider);
  vi.stubEnv("IDP_SMTP_REAL_HOST", host);
  vi.stubEnv("IDP_SMTP_REAL_USER", "id");
  vi.stubEnv("IDP_SMTP_REAL_PASSWORD", "secret");
  vi.stubEnv("IDP_SMTP_REAL_SENDER_ADDRESS", "noreply@doctor.school");
}
function stubReserve(enabled: string) {
  vi.stubEnv("MAILER_FALLBACK_SMTP_ENABLED", enabled);
  vi.stubEnv("MAILER_FALLBACK_SMTP_PROVIDER", "mail.ru");
  vi.stubEnv("MAILER_FALLBACK_SMTP_HOST", "smtp.mail.ru");
  vi.stubEnv("MAILER_FALLBACK_SMTP_PORT", "465");
  vi.stubEnv("MAILER_FALLBACK_SMTP_USER", "reserve@doctor.school");
  vi.stubEnv("MAILER_FALLBACK_SMTP_PASSWORD", "app-password");
  vi.stubEnv("MAILER_FALLBACK_SMTP_SENDER_ADDRESS", "noreply@doctor.school");
}

describe("mailer environment wiring", () => {
  it("EARS-31: credentials alone cannot activate Resend, while explicit activation without a key fails startup", () => {
    stubPrimary();
    vi.stubEnv("RESEND_API_KEY", "dormant");
    vi.stubEnv("RESEND_ENABLED", "false");
    mailerFactory()(flags(true), undefined);
    expect(capture.config?.real?.provider).toBe("postbox");
    expect(capture.config?.resend).toMatchObject({ enabled: false });
    vi.stubEnv("RESEND_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(() => mailerFactory()(flags(false), undefined)).toThrow(
      "Mailer: invalid transport configuration",
    );
  });

  it("EARS-31: the mail.ru reserve is wired from its own namespace and stays inert without its switch", () => {
    stubPrimary();
    stubReserve("false");
    mailerFactory()(flags(true), undefined);
    expect(capture.config?.fallback).toMatchObject({
      enabled: false,
      provider: "mail.ru",
      host: "smtp.mail.ru",
      port: 465,
      user: "reserve@doctor.school",
    });
    stubReserve("true");
    mailerFactory()(flags(true), undefined);
    expect(capture.config?.fallback?.enabled).toBe(true);
  });

  it("EARS-31: an enabled incomplete reserve, or a reserve while the primary is mail.ru, fails startup without naming a secret", () => {
    stubPrimary();
    stubReserve("true");
    vi.stubEnv("MAILER_FALLBACK_SMTP_PASSWORD", "");
    expect(() => mailerFactory()(flags(false), undefined)).toThrow(
      "Mailer: invalid transport configuration",
    );
    stubReserve("true");
    stubPrimary("mail.ru", "smtp.mail.ru:465");
    let message = "";
    try {
      mailerFactory()(flags(true), undefined);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("Mailer: invalid transport configuration");
  });

  it("EARS-31: a missing primary fails startup when real mode is selected, never in explicit intercept", () => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    vi.stubEnv("IDP_SMTP_REAL_PROVIDER", "");
    vi.stubEnv("IDP_SMTP_REAL_HOST", "");
    expect(() => mailerFactory()(flags(false), undefined)).not.toThrow();
    expect(() => mailerFactory()(flags(true), undefined)).toThrow(
      "Mailer: invalid transport configuration",
    );
  });
});
