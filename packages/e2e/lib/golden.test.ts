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

  // #2805 — parallel workers each sign in as their own account.
  it("gives every parallel worker its own verified doctor with the shared password variable", () => {
    const accounts = [0, 1, 2, 3, 4, 5].map((worker) =>
      resolveGoldenDoctor("verified-cardiologist", worker),
    );
    expect(new Set(accounts.map((a) => a.email)).size).toBe(6);
    expect(new Set(accounts.map((a) => a.id)).size).toBe(6);
    expect(accounts[0]!.email).toBe("golden.doctor.verified@example.test");
    expect(accounts[3]!.email).toBe("golden.doctor.verified.w3@example.test");
    expect(accounts[3]!.key).toBe("doctorVerifiedW3");
    for (const account of accounts) {
      expect(account.passwordEnvVar).toBe("DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED");
      expect(account.displayName).toBe(accounts[0]!.displayName);
    }
  });

  it("refuses a worker beyond the pool instead of sharing an account", () => {
    expect(() => resolveGoldenDoctor("verified-cardiologist", 6)).toThrow(
      /exceeds the golden worker pool/,
    );
  });

  it("refuses an unpooled seed on any worker but 0", () => {
    expect(resolveGoldenDoctor("mfa-enrolled", 0).email).toBe(
      "golden.doctor.mfa@example.test",
    );
    expect(() => resolveGoldenDoctor("mfa-enrolled", 1)).toThrow(
      /has no worker pool/,
    );
  });
});
