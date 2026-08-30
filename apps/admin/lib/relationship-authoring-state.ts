export type RelationshipPickerState =
  | { kind: "loading"; selectDisabled: true }
  | { kind: "error"; selectDisabled: true }
  | { kind: "empty"; selectDisabled: true }
  | { kind: "ready"; selectDisabled: false };

export type RelationshipRowActionState =
  | { kind: "loading"; actionDisabled: true }
  | { kind: "error"; actionDisabled: true }
  | { kind: "occupied"; actionDisabled: true }
  | { kind: "available"; actionDisabled: false };

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

/** Keep an invariant-changing row action and its visible status in one state table. */
export function relationshipRowActionState({
  isLoading,
  isError,
  incumbentRelationId,
  candidateRelationId,
}: {
  isLoading: boolean;
  isError: boolean;
  incumbentRelationId: string | null;
  candidateRelationId: string;
}): RelationshipRowActionState {
  if (isLoading) return { kind: "loading", actionDisabled: true };
  if (isError) return { kind: "error", actionDisabled: true };
  if (!canClaimInvariantSeat(incumbentRelationId, candidateRelationId)) {
    return { kind: "occupied", actionDisabled: true };
  }
  return { kind: "available", actionDisabled: false };
}

/** Retry is an explicit user action, but callers need not await the query result. */
export function retryRelationshipOccupancy(refetch: () => unknown): void {
  void refetch();
}
