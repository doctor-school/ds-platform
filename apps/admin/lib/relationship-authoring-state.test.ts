import { describe, expect, it, vi } from "vitest";

import {
  canClaimInvariantSeat,
  relationshipPickerState,
  relationshipRowActionState,
  retryRelationshipOccupancy,
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

  it("EARS-22: reverse row actions expose authoritative occupancy loading and failure states", () => {
    expect(
      relationshipRowActionState({
        isLoading: true,
        isError: false,
        incumbentRelationId: null,
        candidateRelationId: "candidate-row",
      }),
    ).toEqual({ kind: "loading", actionDisabled: true });
    expect(
      relationshipRowActionState({
        isLoading: false,
        isError: true,
        incumbentRelationId: null,
        candidateRelationId: "candidate-row",
      }),
    ).toEqual({ kind: "error", actionDisabled: true });
    expect(
      relationshipRowActionState({
        isLoading: false,
        isError: false,
        incumbentRelationId: "other-row",
        candidateRelationId: "candidate-row",
      }),
    ).toEqual({ kind: "occupied", actionDisabled: true });
    expect(
      relationshipRowActionState({
        isLoading: false,
        isError: false,
        incumbentRelationId: "candidate-row",
        candidateRelationId: "candidate-row",
      }),
    ).toEqual({ kind: "available", actionDisabled: false });
  });

  it("EARS-22: reverse row occupancy failures can retry the authoritative read", () => {
    const refetch = vi.fn();

    retryRelationshipOccupancy(refetch);

    expect(refetch).toHaveBeenCalledOnce();
  });
});
