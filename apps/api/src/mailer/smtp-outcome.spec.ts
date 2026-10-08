import { describe, expect, it } from "vitest";
import { classifySmtpError, classifySmtpResult } from "./smtp-outcome.js";

/** A nodemailer-shaped server reply error (`_formatError`). */
function reply(command: string, response: string): Error {
  return Object.assign(new Error(`failed: ${response}`), {
    command,
    response,
    responseCode: Number(response.slice(0, 3)),
  });
}
function errno(code: string): Error {
  return Object.assign(new Error(code), { code, command: "CONN" });
}

describe("003 EARS-45 SMTP outcome classes (design §14.3)", () => {
  it("EARS-45: only an enhanced 5.1.x (not 5.1.7/5.1.8) to RCPT TO is recipient-permanent", () => {
    for (const r of ["550 5.1.1 user unknown", "553 5.1.3 bad syntax"]) {
      expect(classifySmtpError(reply("RCPT TO", r), "unknown")).toMatchObject({
        outcome: "recipient-permanent",
      });
    }
    expect(
      classifySmtpError(reply("RCPT TO", "550 5.1.1 no such user"), "unknown")
        .code,
    ).toBe("550 5.1.1");
  });

  it("EARS-45: bare 550/551/553, 5.1.7/5.1.8, 5.7.1 at RCPT and any MAIL FROM reply are provider-failure", () => {
    for (const [command, r] of [
      ["RCPT TO", "550 mailbox unavailable"],
      ["RCPT TO", "551 not local"],
      ["RCPT TO", "553 rejected"],
      ["RCPT TO", "550 5.7.1 relaying denied"],
      ["RCPT TO", "550 5.1.7 bad sender mailbox"],
      ["RCPT TO", "550 5.1.8 bad sender system"],
      ["MAIL FROM", "553 5.1.8 sender rejected"],
      ["MAIL FROM", "550 5.1.1 sender unknown"],
    ] as const) {
      expect(classifySmtpError(reply(command, r), "unknown")).toMatchObject({
        outcome: "provider-failure",
      });
    }
  });

  it("EARS-45: 535 AUTH, any 4xx and a 5xx reply to the end-of-data sequence are provider-failure", () => {
    for (const [command, r] of [
      ["AUTH PLAIN", "535 5.7.8 authentication failed"],
      ["RCPT TO", "451 4.1.1 try later"],
      ["DATA", "554 5.6.0 message rejected"],
      ["DATA", "451 local error"],
    ] as const) {
      expect(
        classifySmtpError(reply(command, r), "after-end-of-data"),
      ).toMatchObject({ outcome: "provider-failure" });
    }
  });

  it("EARS-45: connection refusal, DNS and TLS failures are provider-failure in any phase", () => {
    for (const code of [
      "ECONNREFUSED",
      "ENOTFOUND",
      "EDNS",
      "ETLS",
      "CERT_HAS_EXPIRED",
    ]) {
      expect(classifySmtpError(errno(code), "unknown")).toMatchObject({
        outcome: "provider-failure",
      });
    }
  });

  it("EARS-45: timeout or connection loss before end-of-data is provider-failure; after it, or with unknown phase, ambiguous", () => {
    for (const code of ["ETIMEDOUT", "ECONNECTION", "ECONNRESET"]) {
      expect(classifySmtpError(errno(code), "before-end-of-data").outcome).toBe(
        "provider-failure",
      );
      expect(classifySmtpError(errno(code), "after-end-of-data").outcome).toBe(
        "ambiguous",
      );
      expect(classifySmtpError(errno(code), "unknown").outcome).toBe(
        "ambiguous",
      );
    }
  });

  it("EARS-45: a resolved non-2xx final reply is provider-failure and a missing reply is ambiguous", () => {
    expect(classifySmtpResult({ response: "250 2.0.0 queued" })).toBeNull();
    expect(classifySmtpResult({ response: "554 failed" })?.outcome).toBe(
      "provider-failure",
    );
    expect(classifySmtpResult({})?.outcome).toBe("ambiguous");
  });

  it("EARS-30: provider text never reaches the classified code", () => {
    const r = classifySmtpError(
      reply("RCPT TO", "550 5.1.1 doctor@example.com ABC123"),
      "unknown",
    );
    expect(`${r.code} ${r.message}`).not.toMatch(/doctor@|ABC123/);
    expect(
      classifySmtpError(errno("weird secret-bearing code"), "unknown").code,
    ).toBe("connection-failure");
  });
});
