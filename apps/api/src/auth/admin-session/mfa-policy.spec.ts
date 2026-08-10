import { describe, expect, it } from "vitest";
import {
  MFA_REQUIRED_BY_ROLE,
  mfaRequiredRoles,
  requiresMfa,
} from "./mfa-policy.js";

describe("011 EARS-3 — role → mfa_required policy", () => {
  it("EARS-3: the policy is populated with platform_admin, and with platform_admin only", () => {
    // 011 Scope → Out is explicit that `moderator` / `support` / `expert` /
    // `clinic_admin` / `investor` are NOT tenants yet (their factor kinds differ
    // per ADR-0001 §4). A silent extra entry here would mandate TOTP for a role
    // with no enrollment path — a lockout, not a hardening.
    expect(mfaRequiredRoles()).toEqual(["platform_admin"]);
  });

  it("EARS-3: a principal holding platform_admin requires a second factor", () => {
    expect(requiresMfa(["platform_admin"])).toBe(true);
    expect(requiresMfa(["doctor_guest", "platform_admin"])).toBe(true);
  });

  it("EARS-3: a principal holding no policy role does not", () => {
    expect(requiresMfa([])).toBe(false);
    expect(requiresMfa(["doctor_guest"])).toBe(false);
    expect(requiresMfa(["doctor", "expert"])).toBe(false);
    // An unknown//future role string is not silently treated as elevated.
    expect(requiresMfa(["not_a_real_role"])).toBe(false);
  });

  it("EARS-3: the policy stays a role → requirement map, so adding a role is a data change", () => {
    // The shape is the requirement: a future `moderator` tenant must be one new
    // key, not a reshape of the check (011 Scope → Out).
    expect(typeof MFA_REQUIRED_BY_ROLE).toBe("object");
    for (const value of Object.values(MFA_REQUIRED_BY_ROLE)) {
      expect(value).toBe(true);
    }
  });
});
