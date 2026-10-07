import { describe, expect, it } from "vitest";

import { formatEventCount } from "./event-count";

// Wave-2 entry gate §2.1 row 5 — ONE plural rule; the noun is a copy key
// (`copy.eventNoun`, §4.4). The default noun is «событие»; the Academy overrides
// it with «эфир» (019 «Amendment — 2026-10-05»: «Показать N эфиров»).
describe("formatEventCount — one plural rule, the noun from copy", () => {
  it("pluralises 1 / 2 / 5 for the default noun «событие»", () => {
    expect(formatEventCount(1)).toBe("1 событие");
    expect(formatEventCount(2)).toBe("2 события");
    expect(formatEventCount(5)).toBe("5 событий");
  });

  it("pluralises 1 / 2 / 5 for the override «эфир»", () => {
    const noun = { one: "эфир", few: "эфира", many: "эфиров" };
    expect(formatEventCount(1, noun)).toBe("1 эфир");
    expect(formatEventCount(2, noun)).toBe("2 эфира");
    expect(formatEventCount(5, noun)).toBe("5 эфиров");
  });

  it("follows the Russian teens and tens: 11–14 take «many», 21 takes «one», 22 takes «few»", () => {
    expect(formatEventCount(11)).toBe("11 событий");
    expect(formatEventCount(14)).toBe("14 событий");
    expect(formatEventCount(21)).toBe("21 событие");
    expect(formatEventCount(22)).toBe("22 события");
  });
});
