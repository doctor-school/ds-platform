import { describe, expect, it } from "vitest";
import { resolveFallbackSmtp, resolveRealSmtp } from "./real-smtp.js";

const valid = {
  IDP_SMTP_REAL_PROVIDER: "postbox",
  IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net:465",
  IDP_SMTP_REAL_USER: "id",
  IDP_SMTP_REAL_PASSWORD: "secret",
  IDP_SMTP_REAL_SENDER_ADDRESS: "noreply@doctor.school",
};
describe("explicit real SMTP", () => {
  it("EARS-31: resolves the explicit Postbox TLS endpoint and shared credentials", () => {
    expect(resolveRealSmtp(valid)).toEqual({
      provider: "postbox",
      host: "postbox.cloud.yandex.net",
      port: 465,
      user: "id",
      password: "secret",
      from: "noreply@doctor.school",
    });
  });
  it("EARS-31: rejects missing, mismatched and insecure real configuration without secret diagnostics", () => {
    for (const patch of [
      { IDP_SMTP_REAL_PROVIDER: undefined },
      { IDP_SMTP_REAL_PROVIDER: "other" },
      { IDP_SMTP_REAL_HOST: "smtp.mail.ru:465" },
      { IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net:587" },
      { IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net:465extra" },
      { IDP_SMTP_REAL_PASSWORD: " " },
      { IDP_SMTP_REAL_SENDER_ADDRESS: "broken" },
    ]) {
      expect(() => resolveRealSmtp({ ...valid, ...patch })).toThrow(
        "Invalid real SMTP configuration",
      );
    }
  });
  it("EARS-31: keeps mail.ru available only through matching explicit configuration", () => {
    expect(
      resolveRealSmtp({
        ...valid,
        IDP_SMTP_REAL_PROVIDER: "mail.ru",
        IDP_SMTP_REAL_HOST: "smtp.mail.ru",
        IDP_SMTP_REAL_PORT: 465,
      }).provider,
    ).toBe("mail.ru");
  });
});

const reserve = {
  MAILER_FALLBACK_SMTP_ENABLED: true,
  MAILER_FALLBACK_SMTP_PROVIDER: "mail.ru",
  MAILER_FALLBACK_SMTP_HOST: "smtp.mail.ru",
  MAILER_FALLBACK_SMTP_PORT: 465,
  MAILER_FALLBACK_SMTP_USER: "noreply@doctor.school",
  MAILER_FALLBACK_SMTP_PASSWORD: "app-password",
  MAILER_FALLBACK_SMTP_SENDER_ADDRESS: "noreply@doctor.school",
};
describe("003 EARS-31 mail.ru reserve configuration", () => {
  it("EARS-31: joins only with its own switch and a complete independent credential set", () => {
    expect(resolveFallbackSmtp(reserve, "postbox")).toEqual({
      state: "configured",
      config: {
        provider: "mail.ru",
        host: "smtp.mail.ru",
        port: 465,
        user: "noreply@doctor.school",
        password: "app-password",
        from: "noreply@doctor.school",
      },
    });
  });
  it("EARS-31: credentials alone are inert — switch off is disabled, nothing configured is absent", () => {
    expect(
      resolveFallbackSmtp(
        { ...reserve, MAILER_FALLBACK_SMTP_ENABLED: false },
        "postbox",
      ),
    ).toEqual({ state: "disabled" });
    expect(resolveFallbackSmtp({}, "postbox")).toEqual({ state: "absent" });
  });
  it("EARS-31: an enabled reserve with incomplete credentials or another provider is a configuration error", () => {
    for (const patch of [
      { MAILER_FALLBACK_SMTP_PROVIDER: undefined },
      { MAILER_FALLBACK_SMTP_PROVIDER: "postbox" },
      { MAILER_FALLBACK_SMTP_HOST: "postbox.cloud.yandex.net" },
      { MAILER_FALLBACK_SMTP_PORT: 587 },
      { MAILER_FALLBACK_SMTP_USER: " " },
      { MAILER_FALLBACK_SMTP_PASSWORD: undefined },
      { MAILER_FALLBACK_SMTP_SENDER_ADDRESS: "broken" },
    ]) {
      expect(() =>
        resolveFallbackSmtp({ ...reserve, ...patch }, "postbox"),
      ).toThrow("Invalid fallback SMTP configuration");
    }
  });
  it("EARS-31: a reserve identical to a mail.ru primary is a configuration error that names no secret", () => {
    let message = "";
    try {
      resolveFallbackSmtp(reserve, "mail.ru");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("Invalid fallback SMTP configuration");
    expect(message).not.toMatch(/app-password|noreply/);
  });
});
