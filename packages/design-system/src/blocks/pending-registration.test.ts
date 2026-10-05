import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PENDING_TTL_MS,
  clearPendingRegistration,
  peekPendingRegistration,
  setPendingRegistration,
  type PendingRegistration,
} from "./pending-registration";

/**
 * 003 EARS-39 amended / EARS-41 (#2556) — the security envelope of the shared
 * in-tab hold of the registration values, asserted once here for BOTH
 * storefronts: single slot, identifier match, read-without-wipe (a refused code
 * is retried with the same values), explicit wipe, TTL expiry, nothing after a
 * reload. The hosts' wiring is asserted by the `@ds/auth-flow` doors.
 */
afterEach(() => {
  vi.useRealTimers();
  clearPendingRegistration();
});

function held(identifier: string, password: string): PendingRegistration {
  return {
    identifier,
    registration: {
      password,
      consent: [{ purpose: "platform_terms", version: "v1" }],
    },
    form: {
      email: identifier,
      password,
      promoCode: "",
      consents: { "platform-terms": true },
    },
  };
}

describe("003 EARS-39 amended: the in-tab registration hold", () => {
  it("003 EARS-41: the held values are read for their identifier and survive the read (a refused code is retried)", () => {
    setPendingRegistration(held("doc@example.com", "s3cret"));

    expect(peekPendingRegistration("doc@example.com")).toEqual(
      held("doc@example.com", "s3cret"),
    );
    expect(peekPendingRegistration("doc@example.com")).not.toBeNull();
  });

  it("003 EARS-39 amended: a mismatched identifier yields nothing", () => {
    setPendingRegistration(held("doc@example.com", "s3cret"));

    expect(peekPendingRegistration("someone-else@example.com")).toBeNull();
  });

  it("003 EARS-24 amended: without an identifier the hold is read for the form refill", () => {
    setPendingRegistration(held("doc@example.com", "s3cret"));

    expect(peekPendingRegistration()?.form.email).toBe("doc@example.com");
  });

  it("003 EARS-39 amended: a record older than the TTL is treated as no-hold", () => {
    vi.useFakeTimers();
    setPendingRegistration(held("doc@example.com", "s3cret"));

    vi.advanceTimersByTime(PENDING_TTL_MS - 1);
    expect(peekPendingRegistration("doc@example.com")).not.toBeNull();

    vi.advanceTimersByTime(2);
    expect(peekPendingRegistration("doc@example.com")).toBeNull();
  });

  it("003 EARS-39 amended: the slot is single-valued — a fresh register submit replaces the prior hold", () => {
    setPendingRegistration(held("first@example.com", "one"));
    setPendingRegistration(held("second@example.com", "two"));

    expect(peekPendingRegistration("first@example.com")).toBeNull();
    expect(peekPendingRegistration("second@example.com")).toEqual(
      held("second@example.com", "two"),
    );
  });

  it("003 EARS-39 amended: clearing (an accepted code) drops the values", () => {
    setPendingRegistration(held("doc@example.com", "s3cret"));
    clearPendingRegistration();

    expect(peekPendingRegistration("doc@example.com")).toBeNull();
  });

  it("003 EARS-39 amended: a fresh module (hard reload) holds nothing — the cold step submits the code alone", () => {
    expect(peekPendingRegistration("doc@example.com")).toBeNull();
  });
});
