-- Register the natively RANGE-partitioned audit_ledger (migration 0003) with
-- pg_partman 5.4.3 for monthly partition AUTO-CREATION (#136 narrowed v1 slice,
-- ADR-0003 §3/§6). This is the auto-creation half ONLY — the retention DROP +
-- crypto-shred (5y) is split out to #383 and is intentionally NOT configured
-- here: ADR-0003 §3 keeps the partition drop-mask DISABLED on v1 ("enabled at
-- the first confirmed retention scenario from observability"), so `retention`
-- is left unset and pg_partman never DROPs a partition.
--
-- drizzle-kit does not model pg_partman registration (it is runtime DDL, not
-- table structure) — like the 0003 PARTITION BY DDL this migration is
-- hand-managed (ADR-0003 §3.4) and the 0004 snapshot is reconciled to 0003 so
-- `drizzle:generate` reports no drift.
--
-- Self-sufficient + idempotent: it creates the partman schema + extension
-- itself (IF NOT EXISTS) so it runs identically on CI's fresh DB, on an existing
-- dev-stand volume, and in prod — without depending on init.sql (which only
-- fires on a FRESH cluster). The data-layer Postgres image
-- (ds-platform/postgres:pg17-partman) ships the pg_partman 5.4.3 binary.

-- pg_partman lives in a dedicated `partman` schema (upstream convention),
-- owned by the app role so the BGW (running as `ds`) can maintain it.
CREATE SCHEMA IF NOT EXISTS partman AUTHORIZATION ds;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
--> statement-breakpoint
-- Register the parent for native monthly RANGE auto-creation. Key choices,
-- verified live against pg_partman 5.4.3 on the dev stand:
--
--  * p_default_table := false — migration 0003 already created a manual
--    `audit_ledger_default` (the never-lose-an-audit-write safety net). Letting
--    pg_partman create its OWN default would collide with it; we keep the
--    existing one and tell partman not to make another.
--  * p_start_partition := '2028-01-01' — 0003 pre-created a fixed monthly buffer
--    spanning 2026-01 .. 2027-12 (24 partitions). pg_partman premakes around the
--    start; starting its chain at the buffer's upper bound (2028-01-01) means it
--    never tries to recreate a month that already exists (its `_pYYYYMMDD`
--    naming differs from the manual `_yYYYY_mMM`, so an overlapping premake would
--    otherwise error). The manual buffer is preserved; partman owns everything
--    after it, contiguously.
--  * p_premake := 3 — keep ~2-3 months of empty partitions ahead of the live
--    edge (ADR-0003 §3).
--  * p_automatic_maintenance := 'on' — the BGW (shared_preload_libraries =
--    'pg_partman_bgw', configured per-env in postgresql.conf) extends the chain
--    on its interval; no external cron.
--
-- NOTE: retention is deliberately NOT passed — the v1 drop-mask is disabled
-- (ADR-0003 §3; 5y retention DROP + crypto-shred is #383).
SELECT partman.create_parent(
	p_parent_table := 'public.audit_ledger',
	p_control := 'created_at',
	p_interval := '1 month',
	p_type := 'range',
	p_premake := 3,
	p_start_partition := '2028-01-01 00:00:00+00',
	p_default_table := false,
	p_automatic_maintenance := 'on'
);
--> statement-breakpoint
-- Keep the monthly chain contiguous from the buffer edge forward even across
-- gaps where no rows have arrived yet — so the live edge is always covered by a
-- real (non-DEFAULT) partition, never silently routed to audit_ledger_default.
UPDATE partman.part_config
SET infinite_time_partitions = true
WHERE parent_table = 'public.audit_ledger';
