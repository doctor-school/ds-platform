import { describe, expect, it } from "vitest";
import { directionBookRequest } from "./direction-relation-options";

// The direction book read: new links pick from live directions only, while a
// label of an existing row (023 EARS-26 — the schools list) reads retired ones too.

describe("directionBookRequest", () => {
  it("offers only live directions to a picker", () => {
    expect(directionBookRequest({ includeRetired: false }).filters).toEqual([]);
  });

  it("023 EARS-26: labels read retired directions too, so a school of one keeps its direction", () => {
    expect(directionBookRequest({ includeRetired: true }).filters).toEqual([
      { field: "includeRetired", operator: "eq", value: true },
    ]);
  });
});
