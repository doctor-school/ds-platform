import { describe, expect, it, vi } from "vitest";
import {
  expiryBudget,
  expiredVerificationEvidence,
  expiryAuditPlan,
  parseExpiryAudit,
  readExpiryAudit,
  readExpiryBudget,
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
  it("EARS-3: unfiltered staging main uses its canonical read-only API container", () => {
    expect(
      expiryAuditPlan(
        "https://academy-main.stage.doctor.school",
        "owned@example.test",
        "slot-main",
        "main-api",
      ),
    ).toContain("sudo -n docker exec -i main-api node");
  });
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
        "pr-2696-api",
      ),
    );
    const slots = await import(
      new URL("../../../tools/staging/slot.mjs", import.meta.url).href
    );
    expect(ran).toContain(
      `sudo -n docker exec -i ${slots.containerAliases("pr-2696").api} node`,
    );
    expect(snapshot.failed).toBe(0);
  });
  it("EARS-3: plans only a scoped read-only query with no credential transfer", () => {
    const plan = expiryAuditPlan(
      "https://academy-pr-2696.stage.doctor.school",
      "owned@example.test",
      "slot-pr-2696",
      "pr-2696-api",
    );
    expect(plan).toContain("sudo -n docker exec -i pr-2696-api node");
    expect(plan).toContain("BEGIN READ ONLY");
    expect(plan).toContain("identifier_hash");
    expect(plan).toContain("AUDIT_IDENTIFIER_PEPPER");
    expect(plan).not.toMatch(
      /\b(?:UPDATE|INSERT|DELETE|DROP|TRUNCATE|ALTER)\b/,
    );
  });
  it.each([
    "https://academy.doctor.school",
    "https://doctor-pr-2696.stage.doctor.school",
    "http://academy-pr-2696.stage.doctor.school",
  ])("EARS-3: refuses any host outside an Academy staging slot %#", (base) => {
    expect(() =>
      expiryAuditPlan(
        base,
        "owned@example.test",
        "slot-pr-2696",
        "pr-2696-api",
      ),
    ).toThrow("Expiry audit requires an Academy staging HTTPS slot");
  });
  it.each(["pr-7-api", "slot-pr-2696-api-1", "pr-2696-api; false"])(
    "EARS-3: refuses a container outside the owned canonical slot %#",
    (apiContainer) => {
      expect(() =>
        expiryAuditPlan(
          "https://academy-pr-2696.stage.doctor.school",
          "owned@example.test",
          "slot-pr-2696",
          apiContainer,
        ),
      ).toThrow("Expiry audit requires an Academy staging HTTPS slot");
    },
  );
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

describe("fresh verification-generator readback", () => {
  const generator = {
    secretGenerator: {
      expiry: "3600s",
      length: 6,
      includeDigits: true,
    },
  };
  function effects(
    value: unknown = generator,
    baseDomain = "stage.doctor.school",
    idpDomain = `id.${baseDomain}`,
  ) {
    return {
      capture: vi.fn(async (script: string) => {
        if (script.includes("/etc/ds-platform/stage.env"))
          return `STAGE_BASE_DOMAIN=${baseDomain}\nIDP_EXTERNAL_DOMAIN=${idpDomain}\nIDP_EXTERNAL_SECURE=true\nIDP_EXTERNAL_PORT=443`;
        if (script.includes("/etc/ds-platform/idp-bootstrap-pat.txt"))
          return "synthetic-pat";
        throw new Error("Unexpected read");
      }),
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify(value), { status: 200 }),
        ),
    };
  }
  it.each(["main", "pr-2696"])(
    "EARS-3: unfiltered staging reads fresh TTL without an operator value on %s",
    async (slot) => {
      const io = effects();
      expect(
        await readExpiryBudget(
          `https://academy-${slot}.stage.doctor.school`,
          undefined,
          io,
        ),
      ).toEqual({ ttlMs: 3600000, waitMs: 3602000, timeoutMs: 3782000 });
      expect(io.capture).toHaveBeenCalledTimes(2);
      expect(io.fetch).toHaveBeenCalledWith(
        "https://id.stage.doctor.school/admin/v1/secretgenerators/SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE",
        expect.objectContaining({ method: "GET" }),
      );
    },
  );
  it("EARS-3: a supplied TTL only corroborates the fresh generator readback", async () => {
    const io = effects();
    expect(
      (
        await readExpiryBudget(
          "https://academy-main.stage.doctor.school",
          "3600000",
          io,
        )
      ).ttlMs,
    ).toBe(3600000);
    expect(io.fetch).toHaveBeenCalledOnce();
  });
  it.each(["3599999", "3600001"])(
    "EARS-3: a supplied lifetime cannot shorten or replace the actual TTL %#",
    async (ttl) => {
      await expect(
        readExpiryBudget(
          "https://academy-main.stage.doctor.school",
          ttl,
          effects(),
        ),
      ).rejects.toThrow("Supplied verification TTL differs from live readback");
    },
  );
  it("EARS-3: a foreign stage hostname fails before credentials or IdP access", async () => {
    const io = effects();
    await expect(
      readExpiryBudget("https://academy-main.other.test", undefined, io),
    ).rejects.toThrow("Live verification-generator read failed");
    expect(io.capture).toHaveBeenCalledOnce();
    expect(io.fetch).not.toHaveBeenCalled();
  });
  it("EARS-3: a non-staging IdP origin cannot receive the operator credential", async () => {
    const io = effects(generator, "stage.doctor.school", "id.doctor.school");
    await expect(
      readExpiryBudget(
        "https://academy-main.stage.doctor.school",
        undefined,
        io,
      ),
    ).rejects.toThrow("Live verification-generator read failed");
    expect(io.capture).toHaveBeenCalledOnce();
    expect(io.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { expiry: "synthetic-secret", length: 6, includeDigits: true },
    { expiry: "3600s", length: 8, includeDigits: true },
    { expiry: "3600s", length: 6, includeDigits: true, includeSymbols: true },
  ])(
    "EARS-3: rejects an unusable or nonnumeric generator without echoing it %#",
    async (value) => {
      await expect(
        readExpiryBudget(
          "https://academy-main.stage.doctor.school",
          undefined,
          effects({ secretGenerator: value }),
        ),
      ).rejects.toThrow("Invalid live verification-generator readback");
    },
  );
  it("EARS-3: secret-bearing transport errors never escape the readback", async () => {
    const io = effects();
    io.capture.mockRejectedValue(new Error("synthetic-secret"));
    await expect(
      readExpiryBudget(
        "https://academy-main.stage.doctor.school",
        undefined,
        io,
      ),
    ).rejects.toThrow("Live verification-generator read failed");
    expect(io.fetch).not.toHaveBeenCalled();
  });
});
