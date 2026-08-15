import { describe, expect, it } from "vitest";

import {
  HIGH_STAKES_AUDIT_COVERAGE,
  validateCoverageEntry,
  validateCoverageRegistry,
  type AuditEmissionCoverage,
} from "./audit-emission-coverage.js";

/**
 * Schema-level guard-test for the audit-emission coverage registry (#1191 →
 * #1270). The router cross-check (discovered high-stakes set ≡ registered set)
 * lives in `test/authz/audit-emission-coverage.e2e-spec.ts` and needs the booted
 * app; what the registry ACCEPTS and REJECTS is pure, so it is asserted here —
 * no database, runs in `pnpm --filter @ds/api test` and in preflight.
 */
const ENROLL_START = "POST /v1/admin/auth/mfa/enroll/start";

describe("audit-emission coverage registry — accepted accountings", () => {
  it("accepts a none-by-spec entry: a route that owes no durable row by spec", () => {
    const entry: AuditEmissionCoverage = {
      noneBySpec: {
        reason: "the command emits nothing durable — the factor is unconfirmed",
        spec: "011 Event Model (StartMfaEnrollment)",
      },
    };
    expect(validateCoverageEntry("POST /v1/x", entry)).toEqual([]);
  });

  it("accepts an emits entry naming taxonomy events", () => {
    const entry: AuditEmissionCoverage = {
      emits: ["Registered"],
      coveredBy: "audit-ledger.e2e: EARS-18",
    };
    expect(validateCoverageEntry("POST /v1/x", entry)).toEqual([]);
  });

  it("accepts a deferral pointing at a tracking Issue", () => {
    const entry: AuditEmissionCoverage = {
      deferred: { reason: "row not wired yet", issue: 135 },
    };
    expect(validateCoverageEntry("POST /v1/x", entry)).toEqual([]);
  });
});

describe("audit-emission coverage registry — rejected accountings", () => {
  it("still rejects a bare `emits: []` — no row is said with noneBySpec, not an empty list", () => {
    const entry = {
      emits: [],
      coveredBy: "nothing",
    } as unknown as AuditEmissionCoverage;
    const findings = validateCoverageEntry("POST /v1/x", entry);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/at least one emitted event/);
    expect(findings[0]).toMatch(/noneBySpec/);
  });

  it("rejects an emit outside the AuthAuditEvent taxonomy", () => {
    const entry = {
      emits: ["NotAnEvent"],
      coveredBy: "nothing",
    } as unknown as AuditEmissionCoverage;
    expect(validateCoverageEntry("POST /v1/x", entry)).toEqual([
      expect.stringMatching(/NotAnEvent/),
    ]);
  });

  it("rejects a none-by-spec entry with no reason and no spec citation — an unaudited opt-out", () => {
    const entry: AuditEmissionCoverage = {
      noneBySpec: { reason: "  ", spec: "" },
    };
    const findings = validateCoverageEntry("POST /v1/x", entry);
    expect(findings).toHaveLength(2);
    expect(findings.join("\n")).toMatch(/reason/);
    expect(findings.join("\n")).toMatch(/spec clause/);
  });

  it("rejects a deferral with no tracking Issue", () => {
    const entry: AuditEmissionCoverage = {
      deferred: { reason: "later", issue: 0 },
    };
    expect(validateCoverageEntry("POST /v1/x", entry)).toEqual([
      expect.stringMatching(/tracking Issue/),
    ]);
  });
});

describe("audit-emission coverage registry — the real registry", () => {
  it("is well-formed: every entry is a valid accounting", () => {
    expect(validateCoverageRegistry(HIGH_STAKES_AUDIT_COVERAGE)).toEqual([]);
  });

  it("011 EARS-5: mfa/enroll/start is registered as none-by-spec, not omitted and not under-classified", () => {
    const entry: AuditEmissionCoverage | undefined =
      HIGH_STAKES_AUDIT_COVERAGE[ENROLL_START];
    expect(entry, `${ENROLL_START} must carry a registry entry`).toBeDefined();
    if (!entry || !("noneBySpec" in entry)) {
      throw new Error(`${ENROLL_START} must be registered as none-by-spec`);
    }
    expect(entry.noneBySpec.reason).toMatch(/nothing durable/i);
    expect(entry.noneBySpec.spec).toMatch(/011/);
  });
});
