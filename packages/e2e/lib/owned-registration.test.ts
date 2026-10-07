import { describe, expect, it } from "vitest";
import {
  registrationEvidence,
  verificationEvidence,
} from "./owned-registration.js";

const account = { email: "owned@example.test", password: "synthetic-password" };
const request = {
  ...account,
  consent: [{ purpose: "tos", version: "2026-01" }],
};
const ack = { status: "pending_verification" };

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
