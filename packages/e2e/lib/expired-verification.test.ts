import { describe, expect, it } from "vitest";
import {
  expiryBudget,
  expiredVerificationEvidence,
  expiryAuditPlan,
  parseExpiryAudit,
  readExpiryAudit,
} from "./expired-verification.js";

describe("real expired confirmation evidence", () => {
  const account = {
    email: "owned@example.test",
    password: "synthetic-password",
  };
  const code = "123456";
  const submitted = JSON.stringify({
    email: account.email,
    code,
    registration: { password: account.password },
  });
  const refusal = JSON.stringify({
    statusCode: 400,
    message: "the request could not be completed",
    error: "Bad Request",
  });
  it("EARS-3: bounds only the expiry scenario from the live generator readback", () => {
    expect(expiryBudget("3600000")).toEqual({
      ttlMs: 3600000,
      waitMs: 3602000,
      timeoutMs: 3782000,
    });
  });
  it.each([undefined, "", "0", "-1", "1.5", "7200001", "synthetic-secret"])(
    "EARS-3: fails closed on absent or unbounded expiry %#",
    (ttl) => {
      expect(() => expiryBudget(ttl)).toThrow(
        "A live verification-generator TTL in milliseconds is required (1–7200000)",
      );
    },
  );
  it("EARS-3: proves the same delivered code refused after the complete monotonic lifetime", () => {
    expect(
      expiredVerificationEvidence(
        submitted,
        refusal,
        account,
        code,
        code,
        3600000,
        3602000,
      ),
    ).toEqual({
      credentialsMatch: true,
      deliveredCode: true,
      expired: true,
      refusalMatches: true,
    });
  });
  it.each([3599999, 3600000, NaN])(
    "EARS-3: cannot credit a premature or unknown expiry %#",
    (elapsed) => {
      expect(
        expiredVerificationEvidence(
          submitted,
          refusal,
          account,
          code,
          code,
          3600000,
          elapsed,
        ).expired,
      ).toBe(false);
    },
  );
  it("EARS-3: a wrong code never proves expiry", () => {
    expect(
      expiredVerificationEvidence(
        submitted,
        refusal,
        account,
        code,
        "654321",
        3600000,
        3602000,
      ).deliveredCode,
    ).toBe(false);
  });
  it("EARS-41: an expired volatile password hold can submit the same delivered code alone", () => {
    expect(
      expiredVerificationEvidence(
        JSON.stringify({ email: account.email, code }),
        refusal,
        account,
        code,
        code,
        3600000,
        3602000,
      ).credentialsMatch,
    ).toBe(true);
    expect(
      expiredVerificationEvidence(
        JSON.stringify({
          email: account.email,
          code,
          registration: { password: "other" },
        }),
        refusal,
        account,
        code,
        code,
        3600000,
        3602000,
      ).credentialsMatch,
    ).toBe(false);
  });
  it.each([
    "synthetic-secret",
    '{"status":"verified"}',
    JSON.stringify({
      statusCode: 400,
      message: account.password,
      error: "Bad Request",
    }),
  ])(
    "EARS-3: secret-bearing or inexact refusal stays boolean and fails %#",
    (body) => {
      const evidence = expiredVerificationEvidence(
        submitted,
        body,
        account,
        code,
        code,
        3600000,
        3602000,
      );
      expect(evidence.refusalMatches).toBe(false);
      expect(
        Object.values(evidence).every((value) => typeof value === "boolean"),
      ).toBe(true);
    },
  );
});

describe("owned expired-attempt audit read", () => {
  it("EARS-3: runs the exact read-only plan through an injected executor and validates its output", async () => {
    let ran = "";
    const snapshot = await readExpiryAudit(
      "https://academy-pr-2696.stage.doctor.school",
      "owned@example.test",
      async (script) => {
        ran = script;
        return '{"failed":0,"safe":true,"unverified":true}';
      },
    );
    expect(ran).toBe(
      expiryAuditPlan(
        "https://academy-pr-2696.stage.doctor.school",
        "owned@example.test",
        "slot-pr-2696",
      ),
    );
    expect(snapshot.failed).toBe(0);
  });
  it("EARS-3: plans only a scoped read-only query with no credential transfer", () => {
    const plan = expiryAuditPlan(
      "https://academy-pr-2696.stage.doctor.school",
      "owned@example.test",
      "slot-pr-2696",
    );
    expect(plan).toContain("slot-pr-2696-api-1");
    expect(plan).toContain("BEGIN READ ONLY");
    expect(plan).toContain("identifier_hash");
    expect(plan).toContain("AUDIT_IDENTIFIER_PEPPER");
    expect(plan).not.toMatch(
      /\b(?:UPDATE|INSERT|DELETE|DROP|TRUNCATE|ALTER)\b/,
    );
  });
  it.each([
    "https://academy.doctor.school",
    "https://academy-main.stage.doctor.school",
    "https://doctor-pr-2696.stage.doctor.school",
    "http://academy-pr-2696.stage.doctor.school",
  ])("EARS-3: refuses any host outside a per-PR Academy slot %#", (base) => {
    expect(() =>
      expiryAuditPlan(base, "owned@example.test", "slot-pr-2696"),
    ).toThrow("Expiry audit requires a per-PR Academy HTTPS slot");
  });
  it("EARS-3: accepts only the minimal safe count projection", () => {
    expect(
      parseExpiryAudit('{"failed":1,"safe":true,"unverified":true}'),
    ).toEqual({ failed: 1, safe: true, unverified: true });
  });
  it.each([
    "synthetic-secret",
    '{"failed":-1,"safe":true,"unverified":true}',
    '{"failed":1,"safe":false,"unverified":true}',
    '{"failed":1,"safe":true,"unverified":false}',
    '{"failed":1,"safe":true,"unverified":true,"code":"synthetic-secret"}',
  ])("EARS-3: discards unsafe audit diagnostics %#", (value) => {
    expect(() => parseExpiryAudit(value)).toThrow(
      "Invalid owned verification-attempt audit projection",
    );
  });
});
