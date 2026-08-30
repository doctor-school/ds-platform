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

/** The selected project's active roster is authoritative for the curator seat. */
export function hasActiveProjectCurator(
  rows: readonly { status: string; role: string }[],
): boolean {
  return rows.some((row) => row.status === "active" && row.role === "curator");
}

/** The selected project's active roster is authoritative for its primary partner. */
export function hasActiveProjectPrimaryPartner(
  rows: readonly { status: string; isPrimary: boolean }[],
): boolean {
  return rows.some((row) => row.status === "active" && row.isPrimary === true);
}
