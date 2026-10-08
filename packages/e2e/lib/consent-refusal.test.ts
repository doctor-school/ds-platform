import { describe, expect, it, vi } from "vitest";
import {
  ownedMirrorCount,
  ownedMirrorQuery,
  parseMirrorCount,
} from "./consent-refusal.js";
import { consentRefusalEvidence } from "./owned-registration.js";

const email = "register-2704-12345678-1234-4234-8234-123456789abc@example.test";
const account = { email, password: "synthetic-password" };
const request = JSON.stringify({ ...account, consent: [] });
const refusal = JSON.stringify({
  statusCode: 400,
  message: "the request could not be completed",
  error: "Bad Request",
});

describe("consent refusal evidence", () => {
  it("EARS-20: proves an exact owned empty-consent request and generic refusal", () => {
    expect(consentRefusalEvidence(request, refusal, account)).toEqual({
      credentialsMatch: true,
      consentAbsent: true,
      refusalMatches: true,
    });
  });
  it.each([undefined, null, [{}], [{ purpose: "tos", version: "2026-01" }]])(
    "EARS-20: missing or accepted consent cannot credit the empty-array probe %#",
    (consent) => {
      expect(
        consentRefusalEvidence(
          JSON.stringify({ ...account, consent }),
          refusal,
          account,
        ).consentAbsent,
      ).toBe(false);
    },
  );
  it("EARS-20: malformed or secret-bearing responses fail with boolean diagnostics", () => {
    for (const response of [
      "synthetic-secret",
      "null",
      JSON.stringify({
        statusCode: 400,
        message: account.password,
        error: "Bad Request",
      }),
      JSON.stringify({ ...JSON.parse(refusal), token: "synthetic-token" }),
    ]) {
      const evidence = consentRefusalEvidence(request, response, account);
      expect(evidence.refusalMatches).toBe(false);
      expect(
        Object.values(evidence).every((value) => typeof value === "boolean"),
      ).toBe(true);
    }
    expect(
      consentRefusalEvidence("synthetic-secret", refusal, account)
        .credentialsMatch,
    ).toBe(false);
    expect(
      consentRefusalEvidence(
        JSON.stringify({
          ...account,
          email: "other@example.test",
          consent: [],
        }),
        refusal,
        account,
      ).credentialsMatch,
    ).toBe(false);
  });
});

describe("read-only owned mirror proof", () => {
  it("EARS-20: bounds a read-only count to the exact owned synthetic email", () => {
    const sql = ownedMirrorQuery(email);
    expect(sql).toContain("BEGIN READ ONLY");
    expect(sql).toContain("statement_timeout = '5s'");
    expect(sql).toContain(
      `SELECT count(*) FROM users WHERE email = '${email}'`,
    );
    expect(sql.endsWith("ROLLBACK;")).toBe(true);
    expect(/SELECT \*|INSERT|UPDATE|DELETE|DROP/i.test(sql)).toBe(false);
  });
  it.each([
    "golden@example.test",
    "owner@example.org",
    `${email}' OR true--`,
    "",
  ])(
    "EARS-20: rejects foreign or unsafe query inputs without echoing them %#",
    (input) => {
      expect(() => ownedMirrorQuery(input)).toThrow(
        "Expected this consent-refusal journey's unique synthetic address",
      );
    },
  );
  it("EARS-20: accepts only a complete nonnegative safe count", () => {
    expect(parseMirrorCount("0\n")).toBe(0);
    expect(parseMirrorCount("1")).toBe(1);
    for (const output of [
      "",
      "0\n1",
      "secret",
      "-1",
      "1.5",
      "9007199254740992",
    ]) {
      expect(() => parseMirrorCount(output)).toThrow(
        "Invalid owned mirror count",
      );
    }
  });
  it("EARS-20: transport failure fails closed without retaining remote diagnostics", async () => {
    const query = vi.fn().mockRejectedValue(new Error("synthetic-secret"));
    await expect(
      ownedMirrorCount(
        "https://academy-pr-2705.stage.doctor.school",
        email,
        query,
      ),
    ).rejects.toThrow("Owned mirror read failed");
  });
  it("EARS-20: chooses the actual Academy slot and returns only the count", async () => {
    const query = vi.fn().mockResolvedValue("0");
    expect(
      await ownedMirrorCount(
        "https://academy-pr-2705.stage.doctor.school",
        email,
        query,
      ),
    ).toBe(0);
    expect(query.mock.calls[0]?.[0]).toBe("pr-2705");
    expect(query.mock.calls[0]?.[1]).toBe(ownedMirrorQuery(email));
  });
  it.each([
    "https://doctor-pr-2705.stage.doctor.school",
    "http://academy-pr-2705.stage.doctor.school",
    "https://academy-pr-0.stage.doctor.school",
    "https://academy-pr-2705.stage.doctor.school/foreign",
  ])(
    "EARS-20: refuses an ambiguous or non-Academy probe target %#",
    async (url) => {
      const query = vi.fn();
      await expect(ownedMirrorCount(url, email, query)).rejects.toThrow(
        "Expected an Academy staging slot origin",
      );
      expect(query).not.toHaveBeenCalled();
    },
  );
});
