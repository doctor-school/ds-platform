export const AUDIT_CAPTURE_ALLOWLIST: readonly {
  table: string;
  rationale: string;
}[] = [
  { table: "audit_ledger", rationale: "recursion — the ledger cannot audit itself" },
  { table: "widget_b", rationale: "append-only telemetry stream — no WHO/WHAT gain" },
];
