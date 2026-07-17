export const AUDIT_CAPTURE_ALLOWLIST: readonly {
  table: string;
  rationale: string;
}[] = [
  // A bare name — empty rationale. The guard must reject this (AC: no bare names).
  { table: "widget_b", rationale: "" },
];
