import { describe, expect, it } from "vitest";
import { resolveRealSmtp } from "./real-smtp.js";

const valid = { IDP_SMTP_REAL_PROVIDER: "postbox", IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net:465", IDP_SMTP_REAL_USER: "id", IDP_SMTP_REAL_PASSWORD: "secret", IDP_SMTP_REAL_SENDER_ADDRESS: "noreply@doctor.school" };
describe("explicit real SMTP", () => {
  it("EARS-31: resolves the explicit Postbox TLS endpoint and shared credentials", () => {
    expect(resolveRealSmtp(valid)).toEqual({ provider: "postbox", host: "postbox.cloud.yandex.net", port: 465, user: "id", password: "secret", from: "noreply@doctor.school" });
  });
  it("EARS-31: rejects missing, mismatched and insecure real configuration without secret diagnostics", () => {
    for (const patch of [{ IDP_SMTP_REAL_PROVIDER: undefined }, { IDP_SMTP_REAL_PROVIDER: "other" }, { IDP_SMTP_REAL_HOST: "smtp.mail.ru:465" }, { IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net:587" }, { IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net:465extra" }, { IDP_SMTP_REAL_PASSWORD: " " }, { IDP_SMTP_REAL_SENDER_ADDRESS: "broken" }]) {
      expect(() => resolveRealSmtp({ ...valid, ...patch })).toThrow("Invalid real SMTP configuration");
    }
  });
  it("EARS-31: keeps mail.ru available only through matching explicit configuration", () => {
    expect(resolveRealSmtp({ ...valid, IDP_SMTP_REAL_PROVIDER: "mail.ru", IDP_SMTP_REAL_HOST: "smtp.mail.ru", IDP_SMTP_REAL_PORT: 465 }).provider).toBe("mail.ru");
  });
});
