import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailerModule } from "./mailer.module.js";
import { MAILER } from "./mailer.types.js";
import type { SmtpMailerConfig } from "./smtp-mailer.js";
const capture = vi.hoisted(() => ({ config: undefined as SmtpMailerConfig | undefined }));
vi.mock("./smtp-mailer.js", () => ({ SmtpMailer: class { constructor(config: SmtpMailerConfig) { capture.config = config; } } }));
afterEach(() => vi.unstubAllEnvs());
describe("mailer environment wiring", () => {
  it("EARS-31: credentials alone cannot activate Resend, while explicit activation retains missing-key errors", () => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
    vi.stubEnv("IDP_SMTP_REAL_PROVIDER", "postbox");
    vi.stubEnv("IDP_SMTP_REAL_HOST", "postbox.cloud.yandex.net:465");
    vi.stubEnv("RESEND_API_KEY", "dormant");
    vi.stubEnv("RESEND_ENABLED", "false");
    const providers = Reflect.getMetadata("providers", MailerModule) as Array<{ provide: unknown; useFactory: (flags: unknown, synthetic: unknown) => unknown }>;
    const factory = providers.find(p => p.provide === MAILER)!.useFactory;
    const flags = { isEnabled: () => true };
    factory(flags, undefined);
    expect(capture.config?.real?.provider).toBe("postbox");
    expect(capture.config?.resend).toBeUndefined();
    vi.stubEnv("RESEND_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "");
    factory(flags, undefined);
    expect(capture.config?.resend).toMatchObject({ enabled: true, apiKey: "" });
  });
});
