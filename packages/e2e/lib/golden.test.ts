import { describe, expect, it } from "vitest";

import {
  GOLDEN_DOCTOR_SEED_NAMES,
  GoldenSeedError,
  resolveGoldenDoctor,
} from "./golden";

/**
 * `Given the golden doctor "verified-cardiologist" is signed in` (tech spec §6.1)
 * names a golden entity by its SEED NAME, never by hand-typed data. This registry
 * is the one place a seed name becomes a real `@ds/db` golden account, so a typo
 * in a feature file fails loudly with the accepted names listed.
 */
describe("resolveGoldenDoctor", () => {
  it("resolves the default regression doctor to the golden catalogue entry", () => {
    const doctor = resolveGoldenDoctor("verified-cardiologist");
    expect(doctor.email).toBe("golden.doctor.verified@example.test");
    expect(doctor.key).toBe("doctorVerified");
    expect(doctor.passwordEnvVar).toBe("DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED");
  });

  it("resolves every published seed name", () => {
    for (const name of GOLDEN_DOCTOR_SEED_NAMES) {
      expect(resolveGoldenDoctor(name).email).toMatch(/@example\.test$/);
    }
  });

  it("rejects an unknown seed name and names the accepted ones", () => {
    expect(() => resolveGoldenDoctor("verified-cardiolgist")).toThrow(
      GoldenSeedError,
    );
    expect(() => resolveGoldenDoctor("verified-cardiolgist")).toThrow(
      /verified-cardiologist/,
    );
  });
});
