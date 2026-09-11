import { describe, expect, it } from "vitest";
import { ZitadelIdpClient, type FetchLike } from "./zitadel.idp.js";
import { SmtpMailer, type SmtpTransport } from "../../mailer/smtp-mailer.js";
import { InMemoryOtpChallengeStore } from "./otp-challenge-store.fake.js";

const CODE = "12345678";
function setup(options: { code?: string; missingCode?: boolean; stalled?: boolean } = {}) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const emails: Parameters<SmtpTransport["sendMail"]>[0][] = [];
  const store = new InMemoryOtpChallengeStore();
  const fetchImpl: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body ?? "{}");
    calls.push({ url, body });
    const json = url.endsWith("/v2/users")
      ? { result: [{ userId: "user-1", human: { email: { email: "actual@ds.test", isVerified: true } } }] }
      : url.endsWith("/v2/sessions")
        ? { sessionId: "session-1", sessionToken: "pending-token", challenges: options.missingCode ? {} : { otpEmail: options.code ?? CODE } }
        : { sessionToken: "checked-token" };
    return { ok: true, status: 200, json: async () => json };
  };
  const mailer = new SmtpMailer({
    intercept: { host: "smtp.test" }, isEnabled: () => false,
    portalBaseUrl: "https://portal.test",
    transportFactory: () => ({ sendMail: async (email) => {
      emails.push(email);
      if (options.stalled) await new Promise(() => {});
      return { response: "250 accepted" };
    } }),
  });
  const client = new ZitadelIdpClient({ baseUrl: "https://idp.test", serviceToken: "test-token", mailer, fetchImpl }, store);
  return { client, calls, emails, store };
}

describe("login email shared template", () => {
  it("EARS-6: delivers the returned code once through the shared mailer and preserves session verification", async () => {
    const { client, calls, emails, store } = setup();
    await client.requestEmailOtp("alias@ds.test");
    expect(calls.find((call) => call.url.endsWith("/v2/sessions"))?.body).toEqual({ checks: { user: { userId: "user-1" } }, challenges: { otpEmail: { returnCode: true } } });
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.to).toBe("actual@ds.test");
    expect(email.subject).toBe(`${CODE} — код для входа в Doctor.School`);
    for (const body of [email.html, email.text]) {
      expect(body).toContain(CODE);
      expect(body).toContain("Код действует 5 минут");
      expect(body).toContain("уже открытой вкладке");
      expect(body).not.toMatch(/<a[\s>]|<button|https?:\/\//i);
      expect(body).not.toContain("1 час");
    }
    expect(JSON.stringify(await store.get("alias@ds.test"))).not.toContain(CODE);
    expect(await client.loginWithEmailOtp("alias@ds.test", CODE)).toEqual({ zitadelSessionId: "session-1", sub: "user-1", sessionToken: "checked-token" });
    expect(await client.loginWithEmailOtp("alias@ds.test", CODE)).toBeNull();
  });

  it("EARS-6: missing returned code sends nothing and does not cache a usable challenge", async () => {
    const { client, emails, store } = setup({ missingCode: true });
    await expect(client.requestEmailOtp("alias@ds.test")).resolves.toBeUndefined();
    expect(emails).toEqual([]);
    expect(await store.get("alias@ds.test")).toBeUndefined();
  });

  it("EARS-16: SMTP latency does not hold the enumeration-safe acknowledgement", async () => {
    const { client, emails } = setup({ stalled: true });
    await client.requestEmailOtp("alias@ds.test");
    expect(emails).toHaveLength(1);
  }, 1000);
});
