// 010 — Universal edit audit: the TS-side mirror of the trigger's data
// registries (010-design §5). The SQL source of truth for masking lives in the
// `audit_pd_columns()` function (migration 0013_universal_edit_audit.sql);
// this mirror is what the coverage guard (EARS-8) and the parity e2e read —
// the e2e asserts SQL ⇄ TS agreement so the two cannot drift silently.

/**
 * PD-column registry (EARS-7, ADR-0009 §2.4): per PD-bearing table, the columns
 * whose values are masked out of audit diffs (`{masked: true}`, no old/new).
 * As-built PD-bearing tables: `users`, `consent_records`; a future table the
 * ADR-0009 retention matrix classifies as PD-bearing is added here AND in a
 * migration regenerating `audit_pd_columns()`.
 *
 * `users.zitadel_sub` is deliberately NOT listed — the opaque Zitadel `sub` is
 * not PD per the as-built ledger contract (010-requirements → Constraints).
 */
export const AUDIT_PD_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ["email", "phone", "display_name"],
  consent_records: ["user_id"],
};

/**
 * Capture allowlist (EARS-8 seed, 010-design §5): schema tables that carry NO
 * audit trigger, each with its recorded rationale. Everything else in the
 * `packages/db` schema is trigger-attached by migration; the EARS-8 coverage
 * guard (#1089) turns CI red for any table in neither set.
 */
export const AUDIT_CAPTURE_ALLOWLIST: readonly {
  table: string;
  rationale: string;
}[] = [
  {
    table: "audit_ledger",
    rationale: "recursion — the ledger cannot audit itself (010-design §5)",
  },
  {
    table: "idempotency_keys",
    rationale:
      "technical request-dedup cache, no domain truth (010-design §5)",
  },
  {
    table: "presence_beats",
    rationale:
      "append-only telemetry stream, itself an event log — auditing would duplicate the stream 1:1 with no WHO/WHAT gain (010-design §5)",
  },
];
