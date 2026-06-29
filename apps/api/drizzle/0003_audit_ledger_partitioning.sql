-- Convert audit_ledger to native declarative RANGE partitioning by created_at
-- (#136, ADR-0003 §2.7/§6). Monthly partitions over a fixed 2026-01..2027-12
-- buffer plus a DEFAULT safety-net partition, so an audit write is never lost.
-- drizzle-kit does not emit PARTITION BY — this DDL is hand-managed
-- (ADR-0003 §3.4 explicitly allows human-edited partition DDL); the 0003
-- snapshot is reconciled so `drizzle:generate` reports no drift.
--
-- Composite keys: Postgres requires the partition key (created_at) in every
-- UNIQUE/PRIMARY KEY constraint on a partitioned table, so the PK becomes
-- (id, created_at) and the event_id unique becomes (event_id, created_at).
-- event_id uniqueness is therefore scoped WITHIN a partition (monthly) — see
-- ADR-0003 §2.7 for why that is acceptable for v1.
--
-- Data-safety: the dev DB carries rows from prior e2e runs; production is empty
-- (Phase 0). Standard non-destructive recreate — rename old table aside, build
-- the new partitioned parent + partitions + trigger, copy every row, drop the
-- old. Verified there are NO inbound foreign keys referencing audit_ledger
-- (the only FK in the schema is consent_records.user_id -> users.id), so the
-- recreate breaks nothing.
--
-- pg_partman-driven partition auto-creation + retention DROP remain deferred
-- (#136) — the pgvector/pgvector:pg17 image does not ship pg_partman.

-- Move the existing (unpartitioned) table aside, keeping its data. RENAME TABLE
-- does NOT rename the table's constraints/indexes, so the new table's
-- `audit_ledger_pkey` / `audit_ledger_event_id_unique` would collide with the
-- legacy ones still bearing those names — rename them aside too.
ALTER TABLE "audit_ledger" RENAME TO "audit_ledger_legacy";
--> statement-breakpoint
ALTER TABLE "audit_ledger_legacy" RENAME CONSTRAINT "audit_ledger_pkey" TO "audit_ledger_legacy_pkey";
--> statement-breakpoint
ALTER TABLE "audit_ledger_legacy" RENAME CONSTRAINT "audit_ledger_event_id_unique" TO "audit_ledger_legacy_event_id_unique";
--> statement-breakpoint
-- The append-only trigger from migration 0002 is attached to the legacy table;
-- drop it so the rename does not leave a stale trigger blocking the copy DROP.
DROP TRIGGER IF EXISTS "audit_ledger_no_mutate" ON "audit_ledger_legacy";
--> statement-breakpoint
-- New partitioned parent. Same columns/types/defaults as 0002, but PARTITION BY
-- RANGE (created_at) and composite constraints carrying the partition key.
CREATE TABLE "audit_ledger" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"subject_id" text,
	"sid" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_ledger_pkey" PRIMARY KEY ("id", "created_at"),
	CONSTRAINT "audit_ledger_event_id_unique" UNIQUE ("event_id", "created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
-- Monthly partitions, [start, nextMonth) UTC bounds, named audit_ledger_yYYYY_mMM.
-- Fixed 2026-01 .. 2027-12 buffer (auto-creation is deferred, #136).
CREATE TABLE "audit_ledger_y2026_m01" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m02" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-02-01 00:00:00+00') TO ('2026-03-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m03" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m04" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m05" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m06" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m07" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m08" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m09" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m10" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m11" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2026_m12" PARTITION OF "audit_ledger" FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m01" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m02" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m03" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-03-01 00:00:00+00') TO ('2027-04-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m04" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-04-01 00:00:00+00') TO ('2027-05-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m05" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-05-01 00:00:00+00') TO ('2027-06-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m06" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-06-01 00:00:00+00') TO ('2027-07-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m07" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-07-01 00:00:00+00') TO ('2027-08-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m08" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-08-01 00:00:00+00') TO ('2027-09-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m09" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-09-01 00:00:00+00') TO ('2027-10-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m10" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-10-01 00:00:00+00') TO ('2027-11-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m11" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-11-01 00:00:00+00') TO ('2027-12-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "audit_ledger_y2027_m12" PARTITION OF "audit_ledger" FOR VALUES FROM ('2027-12-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');
--> statement-breakpoint
-- DEFAULT safety net: any created_at outside the pre-created buffer still lands
-- somewhere — an audit write is never refused for want of a partition.
CREATE TABLE "audit_ledger_default" PARTITION OF "audit_ledger" DEFAULT;
--> statement-breakpoint
-- Copy every legacy row into the partitioned table; the partition router places
-- each row by created_at. INSERT (not the trigger-blocked path) is allowed.
INSERT INTO "audit_ledger" ("id", "event_id", "event_type", "subject_id", "sid", "reason", "metadata", "created_at")
SELECT "id", "event_id", "event_type", "subject_id", "sid", "reason", "metadata", "created_at" FROM "audit_ledger_legacy";
--> statement-breakpoint
-- The legacy table has no trigger anymore (dropped above) — drop it outright.
DROP TABLE "audit_ledger_legacy";
--> statement-breakpoint
-- Re-attach the append-only enforcement (ADR-0003 §2.7) to the new partitioned
-- parent. On PG17 a BEFORE ROW trigger on the partitioned parent cascades to
-- every partition, so UPDATE/DELETE against any child row raises. Function body
-- and message are identical to migration 0002.
CREATE OR REPLACE FUNCTION audit_ledger_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_ledger is append-only (ADR-0003 §2.7): % prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_ledger_no_mutate
	BEFORE UPDATE OR DELETE ON "audit_ledger"
	FOR EACH ROW EXECUTE FUNCTION audit_ledger_append_only();
