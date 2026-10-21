import { afterEach, describe, expect, it, vi } from "vitest";
import { PHONE_SEQUENCE_SIZE, phoneSequence } from "./phone-sequence.js";

describe("#3152 phone sequence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never repeats a number, even when every draw lands in the same millisecond", () => {
    vi.useFakeTimers({ now: new Date("2026-10-21T08:12:07.000Z") });
    const next = phoneSequence("+7999");
    const drawn = Array.from({ length: PHONE_SEQUENCE_SIZE }, () => next());
    expect(new Set(drawn).size).toBe(PHONE_SEQUENCE_SIZE);
  });

  it("draws E.164 numbers: the prefix and seven digits", () => {
    const next = phoneSequence("+7999");
    for (let i = 0; i < 50; i++) expect(next()).toMatch(/^\+7999\d{7}$/);
  });

  it("refuses to draw past its size rather than wrap onto an issued number", () => {
    const next = phoneSequence("+7999");
    for (let i = 0; i < PHONE_SEQUENCE_SIZE; i++) next();
    expect(() => next()).toThrow(/exhausted/);
  });
});
