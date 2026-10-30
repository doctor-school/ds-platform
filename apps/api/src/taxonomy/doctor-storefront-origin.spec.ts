import { describe, expect, it } from "vitest";

import {
  doctorStorefrontOrigin,
  isOnStorefrontOrigin,
} from "./doctor-storefront-origin.js";

describe("030 EARS-2 — the doctor-storefront origin of a result link", () => {
  it("030 EARS-2: when a result link is checked, the system shall accept only a link on the configured doctor-storefront origin", () => {
    const origin = "https://doctor.school";
    expect(isOnStorefrontOrigin("https://doctor.school/events/x", origin)).toBe(
      true,
    );
    expect(
      isOnStorefrontOrigin("https://doctor.school:443/events/x", origin),
    ).toBe(true);
    for (const foreign of [
      "https://doctor.school.evil.example/x",
      "https://academy.doctor.school/x",
      "http://doctor.school/x",
      "not a url",
    ]) {
      expect(isOnStorefrontOrigin(foreign, origin), foreign).toBe(false);
    }
  });

  it("030 EARS-2: when the doctor-storefront origin is not configured, the system shall refuse by name instead of passing the link", () => {
    expect(() => doctorStorefrontOrigin({})).toThrow(/DOCTOR_PUBLIC_ORIGIN/);
    expect(
      doctorStorefrontOrigin({ DOCTOR_PUBLIC_ORIGIN: " https://doctor.school " }),
    ).toBe("https://doctor.school");
  });
});
