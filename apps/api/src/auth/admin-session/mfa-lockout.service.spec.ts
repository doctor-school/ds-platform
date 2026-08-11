import { describe, expect, it } from "vitest";
import {
  MFA_LOCKOUT_THRESHOLD,
  MFA_LOCKOUT_WINDOW_MS,
  MfaLockoutService,
} from "./mfa-lockout.service.js";

/**
 * 011 EARS-7 — the second-factor soft-lock, at the altitude where its window
 * arithmetic is actually observable.
 *
 * The e2e proves the lock through HTTP (threshold → refusal → `auth.lockout
 * .triggered` → a correct code still refused). What it cannot reach without
 * sleeping for half an hour is the window boundary, which is exactly where a
 * lockout goes wrong in practice: a counter that never rolls over turns a typo
 * streak into a permanent lockout, and one that rolls over per attempt never
 * locks at all.
 */
describe("011 EARS-7 — MFA soft-lock window (unit)", () => {
  function serviceAt(start = 1_000_000): {
    lockout: MfaLockoutService;
    advance: (ms: number) => void;
  } {
    let now = start;
    const lockout = new MfaLockoutService(() => now);
    return { lockout, advance: (ms) => (now += ms) };
  }

  it("EARS-7: the threshold-th failure locks, and only that one reports justLocked", async () => {
    const { lockout } = serviceAt();
    const flags: boolean[] = [];
    for (let i = 0; i < MFA_LOCKOUT_THRESHOLD + 3; i++) {
      flags.push(lockout.recordFailure("sub-a").justLocked);
    }
    // Exactly one `justLocked` for the whole burst — the ledger writes one
    // `auth.lockout.triggered` row and the mailer sends one notice, no matter how
    // long an attacker keeps guessing afterwards.
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(flags.indexOf(true)).toBe(MFA_LOCKOUT_THRESHOLD - 1);
    expect(lockout.isLocked("sub-a")).toBe(true);
    await Promise.resolve();
  });

  it("EARS-7: one failure short of the threshold does not lock", () => {
    const { lockout } = serviceAt();
    for (let i = 0; i < MFA_LOCKOUT_THRESHOLD - 1; i++)
      lockout.recordFailure("sub-b");
    expect(lockout.isLocked("sub-b")).toBe(false);
  });

  it("EARS-7: the lock is a SOFT lock — it expires with its 30-minute window", () => {
    const { lockout, advance } = serviceAt();
    for (let i = 0; i < MFA_LOCKOUT_THRESHOLD; i++)
      lockout.recordFailure("sub-c");
    expect(lockout.isLocked("sub-c")).toBe(true);

    advance(MFA_LOCKOUT_WINDOW_MS - 1);
    expect(lockout.isLocked("sub-c")).toBe(true);
    advance(1);
    expect(lockout.isLocked("sub-c")).toBe(false);
    // …and the next failure opens a FRESH window rather than resuming the old
    // tally, so an operator is not one keystroke from being re-locked.
    expect(lockout.recordFailure("sub-c").locked).toBe(false);
  });

  it("EARS-7: failures spread across more than the window never accumulate into a lock", () => {
    const { lockout, advance } = serviceAt();
    for (let i = 0; i < MFA_LOCKOUT_THRESHOLD * 2; i++) {
      lockout.recordFailure("sub-d");
      advance(MFA_LOCKOUT_WINDOW_MS);
    }
    expect(lockout.isLocked("sub-d")).toBe(false);
  });

  it("EARS-7: a proven factor forgives the tally; the counter is per-subject", () => {
    const { lockout } = serviceAt();
    for (let i = 0; i < MFA_LOCKOUT_THRESHOLD - 1; i++)
      lockout.recordFailure("sub-e");
    lockout.clear("sub-e");
    for (let i = 0; i < MFA_LOCKOUT_THRESHOLD - 1; i++)
      lockout.recordFailure("sub-e");
    expect(lockout.isLocked("sub-e")).toBe(false);

    // A neighbour's failures cannot lock this subject — the key is the IdP
    // subject, so an attacker cannot lock out an operator they merely share an
    // origin with.
    for (let i = 0; i < MFA_LOCKOUT_THRESHOLD; i++)
      lockout.recordFailure("sub-f");
    expect(lockout.isLocked("sub-f")).toBe(true);
    expect(lockout.isLocked("sub-e")).toBe(false);
  });
});
