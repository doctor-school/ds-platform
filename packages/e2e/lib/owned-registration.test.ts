import { describe, expect, it } from "vitest";
import {
  registrationEvidence,
  verificationEvidence,
  differentVerificationCode,
  verificationRefusalEvidence,
  coldVerificationEvidence,
  registrationUrl,
  storefrontCallbackAcknowledgement,
} from "./owned-registration.js";

const account = { email: "owned@example.test", password: "synthetic-password" };
const request = {
  ...account,
  consent: [{ purpose: "tos", version: "2026-01" }],
};
const ack = { status: "pending_verification" };
const base = "https://academy.example.test";
const form = { authRequest: "V2_synthetic", csrf: "synthetic-csrf" };
/** 003 EARS-5 (amended): the host answers with the storefront's own callback. */
const hostRedirect = JSON.stringify({
  status: "redirect",
  url: `${base}/auth/callback?code=idp-code&state=tx-state`,
});

describe("cold verification evidence without secret diagnostics", () => {
  const code = "123456";
  const submitted = { email: account.email, code, ...form };
  it("EARS-41: accepts the owned code alone with the storefront callback acknowledgement", () => {
    expect(
      coldVerificationEvidence(
        JSON.stringify(submitted),
        hostRedirect,
        account,
        code,
        base,
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
    { email: account.email, code, csrf: form.csrf, other: "x" },
  ])(
    "EARS-41: rejects any additional credential or request field %#",
    (request) => {
      expect(
        coldVerificationEvidence(
          JSON.stringify(request),
          hostRedirect,
          account,
          code,
          base,
        ).codeOnly,
      ).toBe(false);
    },
  );
  it.each([
    { ...submitted, email: "other@example.test" },
    { ...submitted, code: "654321" },
    { ...submitted, authRequest: undefined },
  ])(
    "EARS-41: a different identity, code or form cannot prove the owned confirmation %#",
    (request) => {
      expect(
        coldVerificationEvidence(
          JSON.stringify(request),
          hostRedirect,
          account,
          code,
          base,
        ).credentialsMatch,
      ).toBe(false);
    },
  );
  it.each([
    null,
    {},
    { status: "verified" },
    { status: "redirect", url: `${base}/auth/callback?code=c&state=s`, access_token: "synthetic-secret" },
  ])(
    "EARS-41: refuses an inexact or credential-bearing acknowledgement %#",
    (response) => {
      const evidence = coldVerificationEvidence(
        JSON.stringify(submitted),
        JSON.stringify(response),
        account,
        code,
        base,
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
        base,
      ),
    ).toEqual({
      credentialsMatch: false,
      codeOnly: false,
      acknowledgementMatches: false,
    });
  });
});

describe("the storefront callback acknowledgement (003 EARS-5 amended)", () => {
  it("EARS-5: the originating storefront's /auth/callback with the IdP code and state", () => {
    expect(storefrontCallbackAcknowledgement(hostRedirect, base)).toBe(true);
  });
  it.each([
    // another storefront's callback is another client's transaction
    { status: "redirect", url: "https://doctor.example.test/auth/callback?code=c&state=s" },
    { status: "redirect", url: `${base}/account?code=c&state=s` },
    { status: "redirect", url: `${base}/auth/callback?state=s` },
    { status: "redirect", url: `${base}/auth/callback?code=c` },
    { status: "redirect", url: `${base}/auth/callback?code=c&state=s&error=access_denied` },
    { status: "redirect", url: "not a url" },
    { status: "verified" },
    { status: "redirect" },
  ])("EARS-5: never «some redirect» %#", (response) => {
    expect(
      storefrontCallbackAcknowledgement(JSON.stringify(response), base),
    ).toBe(false);
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
    ...form,
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
  const submitted = { email: account.email, code, ...form };
  it("EARS-3: accepts the owned code without a registration value and the storefront callback acknowledgement", () => {
    expect(
      verificationEvidence(
        JSON.stringify(submitted),
        hostRedirect,
        account,
        code,
        base,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
  });
  it.each([
    { ...submitted, email: "other@example.test" },
    { ...submitted, code: "654321" },
    // 003 EARS-39 (host): the code command carries no registration value
    { ...submitted, registration: { password: account.password } },
    { ...submitted, registration: {} },
    { ...submitted, held: account.password },
    { ...submitted, authRequest: "" },
  ])(
    "EARS-39: rejects a different identity or code, or any registration value %#",
    (request) => {
      expect(
        verificationEvidence(
          JSON.stringify(request),
          hostRedirect,
          account,
          code,
          base,
        ).credentialsMatch,
      ).toBe(false);
    },
  );
  it.each([
    null,
    {},
    { status: "verified" },
    { status: "pending_verification" },
    {
      status: "redirect",
      url: `${base}/auth/callback?code=c&state=s`,
      access_token: "synthetic-secret",
    },
  ])(
    "EARS-3: rejects an inexact verification acknowledgement without exposing its fields %#",
    (response) => {
      const evidence = verificationEvidence(
        JSON.stringify(submitted),
        JSON.stringify(response),
        account,
        code,
        base,
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
        base,
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
