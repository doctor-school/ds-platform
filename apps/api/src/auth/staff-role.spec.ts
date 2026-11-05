import { describe, expect, it } from "vitest";
import {
  holdsStaffRole,
  mirrorRoleFromClaims,
  PARTICIPANT_ROLE,
  STAFF_ROLES,
} from "./staff-role.js";

describe("003 EARS-26 mirrorRoleFromClaims (#2456) — the users.role projection of the project-roles claim", () => {
  it("EARS-26: a visitor-only claim projects onto the visitor role", () => {
    expect(mirrorRoleFromClaims(["doctor_guest"])).toBe("doctor_guest");
    expect(mirrorRoleFromClaims([])).toBe("doctor_guest");
  });

  it("EARS-26: any staff role present projects onto that staff role, visitor role held or not", () => {
    expect(mirrorRoleFromClaims(["doctor_guest", "platform_admin"])).toBe(
      "platform_admin",
    );
    expect(mirrorRoleFromClaims(["platform_admin"])).toBe("platform_admin");
    expect(mirrorRoleFromClaims(["doctor_guest", "event-registrar"])).toBe(
      "event-registrar",
    );
  });

  it("EARS-26: platform_admin wins over event-registrar (enumerated precedence)", () => {
    expect(mirrorRoleFromClaims(["event-registrar", "platform_admin"])).toBe(
      "platform_admin",
    );
  });

  it("EARS-26: a non-staff visitor tier never turns an account into staff", () => {
    expect(mirrorRoleFromClaims(["doctor_guest", "expert"])).toBe(
      "doctor_guest",
    );
  });
});

describe("049 EARS-2 — superadmin and broadcast_director are staff roles", () => {
  it("049 EARS-2: superadmin is recorded before every other staff role", () => {
    expect(
      mirrorRoleFromClaims(["doctor_guest", "platform_admin", "superadmin"]),
    ).toBe("superadmin");
  });

  it("049 EARS-2: broadcast_director is recorded after the congress roles and before legacy_admin", () => {
    expect(STAFF_ROLES.indexOf("broadcast_director")).toBe(
      STAFF_ROLES.indexOf("congress-program-committee") + 1,
    );
    expect(
      mirrorRoleFromClaims([
        "broadcast_director",
        "congress-program-committee",
      ]),
    ).toBe("congress-program-committee");
    expect(mirrorRoleFromClaims(["doctor_guest", "broadcast_director"])).toBe(
      "broadcast_director",
    );
    expect(mirrorRoleFromClaims(["legacy_admin", "broadcast_director"])).toBe(
      "broadcast_director",
    );
  });

  it("049 EARS-2: a holder of either role is staff, never a participant", () => {
    expect(holdsStaffRole(["doctor_guest", "superadmin"])).toBe(true);
    expect(holdsStaffRole(["doctor_guest", "broadcast_director"])).toBe(true);
    expect(mirrorRoleFromClaims(["broadcast_director"])).not.toBe(
      PARTICIPANT_ROLE,
    );
  });
});
