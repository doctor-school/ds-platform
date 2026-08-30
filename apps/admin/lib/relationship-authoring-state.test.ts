import { describe, expect, it } from "vitest";

import {
  canClaimInvariantSeat,
  relationshipPickerState,
} from "@/lib/relationship-authoring-state";

describe("reverse relationship authoring state", () => {
  it("EARS-22: derives explicit loading, error, empty and ready picker states", () => {
    expect(
      relationshipPickerState({
        isLoading: true,
        isError: false,
        optionCount: 0,
      }),
    ).toEqual({ kind: "loading", selectDisabled: true });
    expect(
      relationshipPickerState({
        isLoading: false,
        isError: true,
        optionCount: 0,
      }),
    ).toEqual({ kind: "error", selectDisabled: true });
    expect(
      relationshipPickerState({
        isLoading: false,
        isError: false,
        optionCount: 0,
      }),
    ).toEqual({ kind: "empty", selectDisabled: true });
    expect(
      relationshipPickerState({
        isLoading: false,
        isError: false,
        optionCount: 2,
      }),
    ).toEqual({ kind: "ready", selectDisabled: false });
  });

  it("EARS-22: create and row actions use the authoritative incumbent relation id", () => {
    expect(canClaimInvariantSeat(null)).toBe(true);
    expect(canClaimInvariantSeat("incumbent-id")).toBe(false);
    expect(canClaimInvariantSeat("same-row", "same-row")).toBe(true);
    expect(canClaimInvariantSeat("other-row", "candidate-row")).toBe(false);
  });
});
