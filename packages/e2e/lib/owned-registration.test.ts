import { describe, expect, it } from "vitest";
import {
  registrationEvidence,
  verificationEvidence,
  differentVerificationCode,
  verificationRefusalEvidence,
  coldVerificationEvidence,
  registrationUrl,
} from "./owned-registration.js";

const account = { email: "owned@example.test", password: "synthetic-password" };
const request = {
  ...account,
  consent: [{ purpose: "tos", version: "2026-01" }],
};
const ack = { status: "pending_verification" };

describe("cold verification evidence without secret diagnostics", () => {
  const code = "123456";
  const submitted = { email: account.email, code };
  it("EARS-41: accepts the owned code alone with the exact verified acknowledgement", () => {
    expect(
      coldVerificationEvidence(
        JSON.stringify(submitted),
        '{"status":"verified"}',
        account,
        code,
      ),
    ).toEqual({
      credentialsMatch: true,
      codeOnly: true,
      acknowledgementMatches: true,
    });
  });
  it.each([
    { ...submitted, registration: { password: account.password } },
    { ...submitted, password: account.password },
    { ...submitted, other: "synthetic-secret" },
  ])(
    "EARS-41: rejects any additional credential or request field %#",
    (request) => {
      expect(
        coldVerificationEvidence(
          JSON.stringify(request),
          '{"status":"verified"}',
          account,
          code,
        ).codeOnly,
      ).toBe(false);
    },
  );
  it.each([
    { ...submitted, email: "other@example.test" },
    { ...submitted, code: "654321" },
  ])(
    "EARS-41: a different identity or code cannot prove the owned confirmation %#",
    (request) => {
      expect(
        coldVerificationEvidence(
          JSON.stringify(request),
          '{"status":"verified"}',
          account,
          code,
        ).credentialsMatch,
      ).toBe(false);
    },
  );
  it.each([
    null,
    {},
    { status: "pending_verification" },
    { status: "verified", access_token: "synthetic-secret" },
  ])(
    "EARS-41: refuses an inexact or credential-bearing acknowledgement %#",
    (response) => {
      const evidence = coldVerificationEvidence(
        JSON.stringify(submitted),
        JSON.stringify(response),
        account,
        code,
      );
      expect(evidence.acknowledgementMatches).toBe(false);
      expect(
        Object.values(evidence).every((value) => typeof value === "boolean"),
      ).toBe(true);
    },
  );
  it("EARS-41: malformed secret-bearing JSON yields only false booleans", () => {
    expect(
      coldVerificationEvidence(
        "synthetic-secret",
        "synthetic-secret",
        account,
        code,
      ),
    ).toEqual({
      credentialsMatch: false,
      codeOnly: false,
      acknowledgementMatches: false,
    });
  });
});

describe("owned registration return context", () => {
  it("EARS-2: existing registrations keep their original entry URL", () => {
    expect(registrationUrl("https://academy.example.test")).toBe(
      "https://academy.example.test/register",
    );
  });
  it("EARS-2: account intent is carried from the real registration entry", () => {
    expect(registrationUrl("https://academy.example.test", "/account")).toBe(
      "https://academy.example.test/register?returnTo=%2Faccount",
    );
  });
  it("EARS-2: unsupported or hostile intents fail before navigation", () => {
    expect(() =>
      registrationUrl(
        "https://academy.example.test",
        "//other.test" as "/account",
      ),
    ).toThrow("Unsupported owned registration return target");
  });
});

describe("wrong confirmation code evidence", () => {
  const code = "923456";
  const submittedCode = "023456";
  const submitted = JSON.stringify({
    email: account.email,
    code: submittedCode,
    registration: { password: account.password },
  });
  const refusal = {
    statusCode: 400,
    message: "the request could not be completed",
    error: "Bad Request",
  };
  it.each(["000000", "123456", "999999"])(
    "EARS-39: constructs a different syntactically valid code %#",
    (actual) => {
      const wrong = differentVerificationCode(actual);
      expect(/^\d{6}$/.test(wrong)).toBe(true);
      expect(wrong === actual).toBe(false);
    },
  );
  it("EARS-39: malformed delivered code fails without printing it", () => {
    expect(() => differentVerificationCode("synthetic-secret")).toThrow(
      "Expected a delivered six-digit confirmation code",
    );
  });
  it("EARS-39: proves the owned wrong-code submission and generic refusal with booleans", () => {
    expect(
      verificationRefusalEvidence(
        submitted,
        JSON.stringify(refusal),
        account,
        code,
        submittedCode,
      ),
    ).toEqual({
      credentialsMatch: true,
      wrongCode: true,
      refusalMatches: true,
    });
  });
  it.each([
    { ...refusal, message: account.password },
    { ...refusal, code },
    { ...refusal, access_token: "synthetic-token" },
    { status: "verified" },
    null,
  ])("EARS-41: refuses non-generic or secret-bearing responses %#", (body) => {
    const evidence = verificationRefusalEvidence(
      submitted,
      JSON.stringify(body),
      account,
      code,
      submittedCode,
    );
    expect(evidence.refusalMatches).toBe(false);
    expect(
      Object.values(evidence).every((value) => typeof value === "boolean"),
    ).toBe(true);
  });
  it("EARS-39: cannot credit the delivered code as a refusal probe", () => {
    expect(
      verificationRefusalEvidence(
        submitted,
        JSON.stringify(refusal),
        account,
        code,
        code,
      ).wrongCode,
    ).toBe(false);
  });
  it("EARS-41: mismatched or malformed request never proves the owned submission", () => {
    expect(
      verificationRefusalEvidence(
        "synthetic-secret",
        JSON.stringify(refusal),
        account,
        code,
        submittedCode,
      ).credentialsMatch,
    ).toBe(false);
    expect(
      verificationRefusalEvidence(
        submitted,
        "synthetic-secret",
        account,
        code,
        submittedCode,
      ).refusalMatches,
    ).toBe(false);
  });
});

describe("verification evidence without secret diagnostics", () => {
  const code = "123456";
  const submitted = {
    email: account.email,
    code,
    registration: { password: account.password },
  };
  it("EARS-3: accepts the owned code and held password with the exact verified acknowledgement", () => {
    expect(
      verificationEvidence(
        JSON.stringify(submitted),
        '{"status":"verified"}',
        account,
        code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
  });
  it.each([
    { ...submitted, email: "other@example.test" },
    { ...submitted, code: "654321" },
    { ...submitted, registration: undefined },
    { ...submitted, registration: { password: "other" } },
  ])(
    "EARS-41: rejects a different identity, code or missing held password %#",
    (request) => {
      expect(
        verificationEvidence(
          JSON.stringify(request),
          '{"status":"verified"}',
          account,
          code,
        ).credentialsMatch,
      ).toBe(false);
    },
  );
  it.each([
    null,
    {},
    { status: "pending_verification" },
    { status: "verified", access_token: "synthetic-secret" },
  ])(
    "EARS-3: rejects an inexact verification acknowledgement without exposing its fields %#",
    (response) => {
      const evidence = verificationEvidence(
        JSON.stringify(submitted),
        JSON.stringify(response),
        account,
        code,
      );
      expect(evidence.acknowledgementMatches).toBe(false);
      expect(
        Object.values(evidence).every((value) => typeof value === "boolean"),
      ).toBe(true);
    },
  );
  it("EARS-3: malformed credential-bearing JSON yields only false booleans", () => {
    expect(
      verificationEvidence(
        "synthetic-secret",
        "synthetic-secret",
        account,
        code,
      ),
    ).toEqual({ credentialsMatch: false, acknowledgementMatches: false });
  });
});

describe("registration evidence without secret diagnostics", () => {
  it("EARS-1: accepts the exact acknowledgement and the submitted owned credentials and consent", () => {
    expect(
      registrationEvidence(
        JSON.stringify(request),
        JSON.stringify(ack),
        account,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
  });
  it.each(
    [
      [],
      [{ purpose: "tos", version: "old" }],
      [{ purpose: "other", version: "2026-01" }],
      [...request.consent, ...request.consent],
      [{ ...request.consent[0], extra: true }],
    ].map((consent) => ({ consent })),
  )(
    "EARS-20: rejects missing, stale, wrong, duplicate or extra consent fields %#",
    ({ consent }) => {
      expect(
        registrationEvidence(
          JSON.stringify({ ...request, consent }),
          JSON.stringify(ack),
          account,
        ).consentMatches,
      ).toBe(false);
    },
  );
  it.each([
    null,
    {},
    { ...ack, access_token: "synthetic-secret" },
    { status: "registered" },
  ])(
    "EARS-1: rejects an inexact acknowledgement without returning its fields %#",
    (body) => {
      const evidence = registrationEvidence(
        JSON.stringify(request),
        JSON.stringify(body),
        account,
      );
      expect(evidence.acknowledgementMatches).toBe(false);
      expect(JSON.stringify(evidence)).not.toContain("synthetic-secret");
    },
  );
  it("EARS-1: rejects credentials that do not belong to this submission", () => {
    expect(
      registrationEvidence(
        JSON.stringify({ ...request, password: "other" }),
        JSON.stringify(ack),
        account,
      ).credentialsMatch,
    ).toBe(false);
  });
  it("EARS-1: malformed credential-bearing JSON returns only booleans", () => {
    expect(
      registrationEvidence(
        "synthetic-secret-invalid-json",
        "synthetic-secret-invalid-json",
        account,
      ),
    ).toEqual({
      credentialsMatch: false,
      consentMatches: false,
      acknowledgementMatches: false,
    });
  });
});
