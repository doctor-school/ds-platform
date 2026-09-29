import { describe, expect, it } from "vitest";
import { mirrorRoleFromClaims } from "./staff-role.js";

describe("#2456 mirrorRoleFromClaims — the users.role projection of the project-roles claim", () => {
  it("#2456: a visitor-only claim projects onto the visitor role", () => {
    expect(mirrorRoleFromClaims(["doctor_guest"])).toBe("doctor_guest");
    expect(mirrorRoleFromClaims([])).toBe("doctor_guest");
  });

  it("#2456: any staff role present projects onto that staff role, visitor role held or not", () => {
    expect(mirrorRoleFromClaims(["doctor_guest", "platform_admin"])).toBe(
      "platform_admin",
    );
    expect(mirrorRoleFromClaims(["platform_admin"])).toBe("platform_admin");
    expect(mirrorRoleFromClaims(["doctor_guest", "event-registrar"])).toBe(
      "event-registrar",
    );
  });

  it("#2456: platform_admin wins over event-registrar (enumerated precedence)", () => {
    expect(mirrorRoleFromClaims(["event-registrar", "platform_admin"])).toBe(
      "platform_admin",
    );
  });

  it("#2456: a non-staff visitor tier never turns an account into staff", () => {
    expect(mirrorRoleFromClaims(["doctor_guest", "expert"])).toBe(
      "doctor_guest",
    );
  });
});
