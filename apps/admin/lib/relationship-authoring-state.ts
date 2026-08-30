export type RelationshipPickerState =
  | { kind: "loading"; selectDisabled: true }
  | { kind: "error"; selectDisabled: true }
  | { kind: "empty"; selectDisabled: true }
  | { kind: "ready"; selectDisabled: false };

/** One pure state table keeps the picker render and its disabled affordance aligned. */
export function relationshipPickerState({
  isLoading,
  isError,
  optionCount,
}: {
  isLoading: boolean;
  isError: boolean;
  optionCount: number;
}): RelationshipPickerState {
  if (isLoading) return { kind: "loading", selectDisabled: true };
  if (isError) return { kind: "error", selectDisabled: true };
  if (optionCount === 0) return { kind: "empty", selectDisabled: true };
  return { kind: "ready", selectDisabled: false };
}

/** A create has no current row; an edit may keep the seat already held by itself. */
export function canClaimInvariantSeat(
  incumbentRelationId: string | null,
  candidateRelationId?: string,
): boolean {
  return (
    incumbentRelationId === null || incumbentRelationId === candidateRelationId
  );
}
