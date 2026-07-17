import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DrizzleAuthAuditLog,
  hashIdentifier,
  toLedgerRow,
} from "./auth-audit.ledger.js";
import type { AuthAuditEvent } from "./auth-audit.types.js";

// #141: the ledger masks raw identifiers (email / phone) with a keyed
// HMAC-SHA256 pepper so the access-controlled `audit_ledger` is not itself a
// reproducible existence oracle (a rainbow table over a phone range). These
// are pure-function specs — no DB, no Nest — pinning the masking contract and
// the explicit pepper threading.
describe("hashIdentifier (#141 keyed HMAC pepper)", () => {
  const pepper = "test-pepper-A";

  it("is a 64-char lowercase hex string (HMAC-SHA256)", () => {
    const hash = hashIdentifier("user@example.com", pepper);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is case-insensitive on the identifier", () => {
    expect(hashIdentifier("User@Example.COM", pepper)).toBe(
      hashIdentifier("user@example.com", pepper),
    );
  });

  it("equals a hand-computed HMAC-SHA256 over the lowercased identifier", () => {
    const expected = createHmac("sha256", pepper)
      .update("user@example.com")
      .digest("hex");
    expect(hashIdentifier("User@Example.com", pepper)).toBe(expected);
  });

  it("DIFFERS for two different peppers on the same identifier (non-reproducible without the secret)", () => {
    expect(hashIdentifier("user@example.com", "pepper-A")).not.toBe(
      hashIdentifier("user@example.com", "pepper-B"),
    );
  });
});

describe("toLedgerRow identifier masking (#141 explicit threading)", () => {
  // A sentinel token (which does NOT contain the raw identifier) proves
  // toLedgerRow emits the mask's RESULT, and a spy proves it called the injected
  // mask with the raw identifier — never embeds it raw, never reads process.env.
  const SENTINEL = "SENTINEL_HASH";
  const rawEmail = "victim@example.com";
  const spyMask = () => vi.fn((_id: string) => SENTINEL);

  it("masks the identifier for LoginFailed and never embeds it raw", () => {
    const mask = spyMask();
    const event: AuthAuditEvent = {
      type: "LoginFailed",
      identifier: rawEmail,
      reason: "wrong_password",
    };
    const row = toLedgerRow(event, mask);
    expect(mask).toHaveBeenCalledWith(rawEmail);
    expect(row.metadata).toEqual({ identifier_hash: SENTINEL });
    expect(JSON.stringify(row)).not.toContain(rawEmail);
  });

  it("masks the identifier for OtpSent and never embeds it raw", () => {
    const mask = spyMask();
    const event: AuthAuditEvent = {
      type: "OtpSent",
      channel: "sms",
      identifier: rawEmail,
    };
    const row = toLedgerRow(event, mask);
    expect(mask).toHaveBeenCalledWith(rawEmail);
    expect(row.metadata).toMatchObject({
      channel: "sms",
      identifier_hash: SENTINEL,
    });
    expect(JSON.stringify(row)).not.toContain(rawEmail);
  });

  it("masks the identifier for PasswordResetRequested and never embeds it raw", () => {
    const mask = spyMask();
    const event: AuthAuditEvent = {
      type: "PasswordResetRequested",
      identifier: rawEmail,
    };
    const row = toLedgerRow(event, mask);
    expect(mask).toHaveBeenCalledWith(rawEmail);
    expect(row.metadata).toEqual({ identifier_hash: SENTINEL });
    expect(JSON.stringify(row)).not.toContain(rawEmail);
  });

  // #1112: the reason-coded auth-failure rows (a rejected verify / reset-complete
  // recorded nowhere on our side was the incident driver). Identifier-keyed and
  // masked exactly like LoginFailed — the attempt count is derived at read time by
  // grouping these rows on `identifier_hash`, so the row carries no subject and no
  // one-time code (003 EARS-30).
  it("masks the identifier for VerifyFailed → auth.account.verify_failed (reason, no subject, no raw PD)", () => {
    const mask = spyMask();
    const event: AuthAuditEvent = {
      type: "VerifyFailed",
      identifier: rawEmail,
      reason: "no-account",
    };
    const row = toLedgerRow(event, mask);
    expect(row.eventType).toBe("auth.account.verify_failed");
    expect(row.subjectId).toBeNull();
    expect(row.reason).toBe("no-account");
    expect(mask).toHaveBeenCalledWith(rawEmail);
    expect(row.metadata).toEqual({ identifier_hash: SENTINEL });
    expect(JSON.stringify(row)).not.toContain(rawEmail);
  });

  it("masks the identifier for PasswordResetFailed → auth.password.reset_failed (reason, no subject, no raw PD)", () => {
    const mask = spyMask();
    const event: AuthAuditEvent = {
      type: "PasswordResetFailed",
      identifier: rawEmail,
      reason: "invalid",
    };
    const row = toLedgerRow(event, mask);
    expect(row.eventType).toBe("auth.password.reset_failed");
    expect(row.subjectId).toBeNull();
    expect(row.reason).toBe("invalid");
    expect(mask).toHaveBeenCalledWith(rawEmail);
    expect(row.metadata).toEqual({ identifier_hash: SENTINEL });
    expect(JSON.stringify(row)).not.toContain(rawEmail);
  });
});

describe("DrizzleAuthAuditLog fail-closed pepper (#141)", () => {
  // The writer resolves the pepper once at construction and must fail closed in
  // a non-test runtime when none is configured — masking with no secret would
  // silently reintroduce the existence oracle. We simulate a non-test runtime by
  // unsetting VITEST and AUDIT_IDENTIFIER_PEPPER for the duration of the case,
  // then restore the env so the surrounding suite is unaffected.
  const fakeDb = {} as never;
  const saved = {
    vitest: process.env.VITEST,
    pepper: process.env.AUDIT_IDENTIFIER_PEPPER,
    dbUrl: process.env.DATABASE_URL,
  };

  afterEach(() => {
    if (saved.vitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = saved.vitest;
    if (saved.pepper === undefined) delete process.env.AUDIT_IDENTIFIER_PEPPER;
    else process.env.AUDIT_IDENTIFIER_PEPPER = saved.pepper;
    if (saved.dbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.dbUrl;
  });

  it("throws at construction when the pepper is unset and the test fallback is bypassed", () => {
    delete process.env.VITEST;
    delete process.env.AUDIT_IDENTIFIER_PEPPER;
    // loadEnv() requires a DATABASE_URL to parse; supply a placeholder so the
    // throw we assert on is the missing-pepper one, not a schema error.
    process.env.DATABASE_URL = "postgres://x@127.0.0.1:5432/x";

    expect(() => new DrizzleAuthAuditLog(fakeDb)).toThrow(
      /AUDIT_IDENTIFIER_PEPPER is not configured/,
    );
  });

  it("constructs (no throw) under the VITEST test runtime with no pepper configured", () => {
    process.env.VITEST = "1";
    delete process.env.AUDIT_IDENTIFIER_PEPPER;
    process.env.DATABASE_URL = "postgres://x@127.0.0.1:5432/x";

    expect(() => new DrizzleAuthAuditLog(fakeDb)).not.toThrow();
  });
});
