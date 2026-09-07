import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PENDING_TTL_MS,
  clearPendingRegistration,
  setPendingRegistration,
  takePendingRegistration,
} from "./pending-registration";

/**
 * 003 EARS-39 / 021 EARS-15 (#1996) — the security envelope of the shared
 * held-password slot, asserted once here now that BOTH storefronts replay
 * through it. The host projections assert their own wiring (the Academy in
 * `apps/portal/app/verify/page.test.tsx`, the doctor storefront in
 * `apps/doctor/components/registration-screen.test.tsx`); what belongs HERE is
 * the invariant neither host may weaken — single slot, atomic consume-and-wipe,
 * identifier match, TTL expiry.
 */
afterEach(() => {
  vi.useRealTimers();
  clearPendingRegistration();
});

describe("003 EARS-39 / 021 EARS-15: the held-password slot", () => {
  it("003 EARS-39: a held credential is returned once and only once for its identifier", () => {
    setPendingRegistration({ identifier: "doc@example.com", password: "s3cret" });

    expect(takePendingRegistration("doc@example.com")).toEqual({
      identifier: "doc@example.com",
      password: "s3cret",
    });
    // Atomic consume-and-wipe: a second read finds nothing, so a replay cannot
    // be repeated and the password does not outlive the one login it feeds.
    expect(takePendingRegistration("doc@example.com")).toBeNull();
  });

  it("003 EARS-39: a mismatched identifier yields nothing AND still wipes the slot", () => {
    setPendingRegistration({ identifier: "doc@example.com", password: "s3cret" });

    expect(takePendingRegistration("someone-else@example.com")).toBeNull();
    // The stale hand-off is gone rather than left waiting for its owner.
    expect(takePendingRegistration("doc@example.com")).toBeNull();
  });

  it("003 EARS-39: a record older than the TTL is treated as no-hold", () => {
    vi.useFakeTimers();
    setPendingRegistration({ identifier: "doc@example.com", password: "s3cret" });

    // Still in flight one millisecond before the bound.
    vi.advanceTimersByTime(PENDING_TTL_MS - 1);
    expect(takePendingRegistration("doc@example.com")).not.toBeNull();

    // Past the bound the record is dropped rather than replayed.
    setPendingRegistration({ identifier: "doc@example.com", password: "s3cret" });
    vi.advanceTimersByTime(PENDING_TTL_MS + 1);
    expect(takePendingRegistration("doc@example.com")).toBeNull();
  });

  it("003 EARS-39: the slot is single-valued — a fresh register submit replaces the prior hold", () => {
    setPendingRegistration({ identifier: "first@example.com", password: "one" });
    setPendingRegistration({ identifier: "second@example.com", password: "two" });

    expect(takePendingRegistration("first@example.com")).toBeNull();
    setPendingRegistration({ identifier: "second@example.com", password: "two" });
    expect(takePendingRegistration("second@example.com")).toEqual({
      identifier: "second@example.com",
      password: "two",
    });
  });

  it("003 EARS-39: clearing drops the credential without handing it back", () => {
    setPendingRegistration({ identifier: "doc@example.com", password: "s3cret" });
    clearPendingRegistration();

    expect(takePendingRegistration("doc@example.com")).toBeNull();
  });

  it("021 EARS-15: a fresh module (hard reload) holds nothing — the caller sees the no-hold path", () => {
    // No `setPendingRegistration` ran in this module lifetime: the reload case
    // both hosts must survive without a dead end (the doctor host re-registers,
    // the Academy falls back to `/login`).
    expect(takePendingRegistration("doc@example.com")).toBeNull();
  });
});
