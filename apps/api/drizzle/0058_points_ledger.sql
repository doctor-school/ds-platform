-- 025 attention-points engine — the ledger core (#3807; 025-design §2/§3,
-- ADR-0016 §6, ADR-0003 §2.7/§3). drizzle-kit emitted the tables, FKs and
-- indexes; the parts drizzle does not model are hand-written here exactly as
-- `audit_ledger` does in 0003/0004 (ADR-0003 §3.4), and the 0058 snapshot is
-- drizzle's own so `lint:db-drift` reports no drift:
--   * `points_postings` is `PARTITION BY RANGE (occurred_at)` with a fixed
--     monthly buffer 2026-01 .. 2027-12 (`points_postings_yYYYY_mMM`), a DEFAULT
--     safety-net partition, and pg_partman auto-creation from 2028-01 onward;
--   * BEFORE UPDATE OR DELETE triggers refuse every row change of the
--     postings (EARS-27) and of their posting keys (EARS-4);
--   * the 010 row-audit trigger on points_accounts and points_rule_versions;
--   * a BEFORE INSERT trigger checks the posting against its accounts: both
--     legs in one unit, a denomination iff the unit is attention_points.
-- Global dedupe lives in the non-partitioned `points_posting_keys` (EARS-4):
-- a partition-local unique cannot dedupe a March fact replayed in April.
-- New tables only — no existing row is touched.
CREATE TABLE "points_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid,
	"system_code" text,
	"unit" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "points_accounts_subject_unit_unique" UNIQUE("subject_kind","subject_id","unit"),
	CONSTRAINT "points_accounts_system_code_unit_unique" UNIQUE("system_code","unit"),
	CONSTRAINT "points_accounts_subject_kind_check" CHECK ("points_accounts"."subject_kind" IN ('person', 'project_fund', 'organisation', 'system')),
	CONSTRAINT "points_accounts_unit_check" CHECK ("points_accounts"."unit" IN ('attention_points', 'money')),
	CONSTRAINT "points_accounts_system_code_check" CHECK ("points_accounts"."system_code" IS NULL OR "points_accounts"."system_code" IN ('issuance', 'reserve', 'sink', 'advance')),
	CONSTRAINT "points_accounts_subject_shape_check" CHECK (("points_accounts"."subject_kind" = 'system' AND "points_accounts"."system_code" IS NOT NULL AND "points_accounts"."subject_id" IS NULL)
        OR ("points_accounts"."subject_kind" <> 'system' AND "points_accounts"."system_code" IS NULL AND "points_accounts"."subject_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "points_posting_keys" (
	"event_id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text,
	"occurred_month" date NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_posting_keys_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "points_postings" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"leg" text NOT NULL,
	"debit_account_id" uuid NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"denomination" text,
	"amount" integer NOT NULL,
	"action" text,
	"project_id" uuid,
	"output_type" text,
	"output_id" uuid,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"attributed_organisation_id" uuid,
	"attributed_member_id" uuid,
	"reverses_posting_id" uuid,
	"reverses_occurred_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_postings_pkey" PRIMARY KEY("id","occurred_at"),
	CONSTRAINT "points_postings_event_leg_unique" UNIQUE("event_id","leg","occurred_at"),
	CONSTRAINT "points_postings_amount_check" CHECK ("points_postings"."amount" > 0),
	CONSTRAINT "points_postings_denomination_check" CHECK ("points_postings"."denomination" IS NULL OR "points_postings"."denomination" IN ('pul', 'bre', 'con')),
	CONSTRAINT "points_postings_distinct_accounts_check" CHECK ("points_postings"."debit_account_id" <> "points_postings"."credit_account_id"),
	CONSTRAINT "points_postings_reverses_pair_check" CHECK (("points_postings"."reverses_posting_id" IS NULL) = ("points_postings"."reverses_occurred_at" IS NULL))

) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
CREATE TABLE "points_rule_versions" (
	"rule_id" text NOT NULL,
	"version" integer NOT NULL,
	"parameters" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_rule_versions_pkey" PRIMARY KEY("rule_id","version"),
	CONSTRAINT "points_rule_versions_version_check" CHECK ("points_rule_versions"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "points_postings" ADD CONSTRAINT "points_postings_event_id_points_posting_keys_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."points_posting_keys"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_postings" ADD CONSTRAINT "points_postings_debit_account_id_points_accounts_id_fk" FOREIGN KEY ("debit_account_id") REFERENCES "public"."points_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_postings" ADD CONSTRAINT "points_postings_credit_account_id_points_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."points_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_postings" ADD CONSTRAINT "points_postings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_postings" ADD CONSTRAINT "points_postings_attributed_organisation_id_organisations_id_fk" FOREIGN KEY ("attributed_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_postings" ADD CONSTRAINT "points_postings_attributed_member_id_users_id_fk" FOREIGN KEY ("attributed_member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_postings" ADD CONSTRAINT "points_postings_rule_version_fk" FOREIGN KEY ("rule_id","rule_version") REFERENCES "public"."points_rule_versions"("rule_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_postings" ADD CONSTRAINT "points_postings_reverses_fk" FOREIGN KEY ("reverses_posting_id","reverses_occurred_at") REFERENCES "public"."points_postings"("id","occurred_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_rule_versions" ADD CONSTRAINT "points_rule_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_postings_debit_idx" ON "points_postings" USING btree ("debit_account_id","denomination");--> statement-breakpoint
CREATE INDEX "points_postings_credit_idx" ON "points_postings" USING btree ("credit_account_id","denomination");
--> statement-breakpoint
-- Monthly partitions, [start, nextMonth) UTC bounds — the audit_ledger buffer.
CREATE TABLE "points_postings_y2026_m01" PARTITION OF "points_postings" FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m02" PARTITION OF "points_postings" FOR VALUES FROM ('2026-02-01 00:00:00+00') TO ('2026-03-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m03" PARTITION OF "points_postings" FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m04" PARTITION OF "points_postings" FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m05" PARTITION OF "points_postings" FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m06" PARTITION OF "points_postings" FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m07" PARTITION OF "points_postings" FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m08" PARTITION OF "points_postings" FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m09" PARTITION OF "points_postings" FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m10" PARTITION OF "points_postings" FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m11" PARTITION OF "points_postings" FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2026_m12" PARTITION OF "points_postings" FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m01" PARTITION OF "points_postings" FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m02" PARTITION OF "points_postings" FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m03" PARTITION OF "points_postings" FOR VALUES FROM ('2027-03-01 00:00:00+00') TO ('2027-04-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m04" PARTITION OF "points_postings" FOR VALUES FROM ('2027-04-01 00:00:00+00') TO ('2027-05-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m05" PARTITION OF "points_postings" FOR VALUES FROM ('2027-05-01 00:00:00+00') TO ('2027-06-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m06" PARTITION OF "points_postings" FOR VALUES FROM ('2027-06-01 00:00:00+00') TO ('2027-07-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m07" PARTITION OF "points_postings" FOR VALUES FROM ('2027-07-01 00:00:00+00') TO ('2027-08-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m08" PARTITION OF "points_postings" FOR VALUES FROM ('2027-08-01 00:00:00+00') TO ('2027-09-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m09" PARTITION OF "points_postings" FOR VALUES FROM ('2027-09-01 00:00:00+00') TO ('2027-10-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m10" PARTITION OF "points_postings" FOR VALUES FROM ('2027-10-01 00:00:00+00') TO ('2027-11-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m11" PARTITION OF "points_postings" FOR VALUES FROM ('2027-11-01 00:00:00+00') TO ('2027-12-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "points_postings_y2027_m12" PARTITION OF "points_postings" FOR VALUES FROM ('2027-12-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');
--> statement-breakpoint
-- DEFAULT safety net: a posting outside the buffer is never refused for want
-- of a partition.
CREATE TABLE "points_postings_default" PARTITION OF "points_postings" DEFAULT;
--> statement-breakpoint
-- EARS-27 — postings are immutable. On PG17 a BEFORE ROW trigger on the
-- partitioned parent cascades to every partition (present and future).
CREATE OR REPLACE FUNCTION points_postings_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'points_postings is append-only (025 EARS-27): % prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER points_postings_no_mutate
	BEFORE UPDATE OR DELETE ON "points_postings"
	FOR EACH ROW EXECUTE FUNCTION points_postings_append_only();
--> statement-breakpoint
-- Double-entry shape a CHECK cannot see (it spans points_accounts): both legs
-- of a posting are in one unit, and an attention_points posting names its
-- denomination (pul|bre|con, CHECK above) while a money posting names none.
CREATE OR REPLACE FUNCTION points_postings_check_accounts() RETURNS trigger AS $$
DECLARE
	debit_unit text;
	credit_unit text;
BEGIN
	SELECT unit INTO debit_unit FROM points_accounts WHERE id = NEW.debit_account_id;
	SELECT unit INTO credit_unit FROM points_accounts WHERE id = NEW.credit_account_id;
	IF debit_unit IS DISTINCT FROM credit_unit THEN
		RAISE EXCEPTION 'points_postings: debit and credit accounts differ in unit (% vs %)', debit_unit, credit_unit;
	END IF;
	IF debit_unit = 'attention_points' AND NEW.denomination IS NULL THEN
		RAISE EXCEPTION 'points_postings: an attention_points posting requires a denomination';
	END IF;
	IF debit_unit = 'money' AND NEW.denomination IS NOT NULL THEN
		RAISE EXCEPTION 'points_postings: a money posting carries no denomination';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER points_postings_accounts_shape
	BEFORE INSERT ON "points_postings"
	FOR EACH ROW EXECUTE FUNCTION points_postings_check_accounts();
--> statement-breakpoint
-- EARS-4 — a fact's posting key is as permanent as its postings: deleting or
-- rewriting one would let a replay accrue twice.
CREATE OR REPLACE FUNCTION points_posting_keys_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'points_posting_keys is append-only (025 EARS-4): % prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER points_posting_keys_no_mutate
	BEFORE UPDATE OR DELETE ON "points_posting_keys"
	FOR EACH ROW EXECUTE FUNCTION points_posting_keys_append_only();
--> statement-breakpoint
-- ── feature-010 audit attachment (010 EARS-8) ──────────────────────────────
-- Accounts (opened, closed for erasure — EARS-31) and rule versions (EARS-25)
-- are mutable domain state and carry the row audit. The postings and their
-- keys are themselves the append-only ledger and are allowlisted in
-- packages/db/src/audit.ts.
CREATE TRIGGER points_accounts_audit AFTER INSERT OR UPDATE OR DELETE
  ON "points_accounts" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
CREATE TRIGGER points_rule_versions_audit AFTER INSERT OR UPDATE OR DELETE
  ON "points_rule_versions" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
--> statement-breakpoint
-- Auto-creation after the buffer, mirroring 0004: partman owns 2028-01 onward,
-- keeps the manual DEFAULT, never drops a partition (no retention).
SELECT partman.create_parent(
	p_parent_table := 'public.points_postings',
	p_control := 'occurred_at',
	p_interval := '1 month',
	p_type := 'range',
	p_premake := 3,
	p_start_partition := '2028-01-01 00:00:00+00',
	p_default_table := false,
	p_automatic_maintenance := 'on'
);
--> statement-breakpoint
UPDATE partman.part_config
SET infinite_time_partitions = true
WHERE parent_table = 'public.points_postings';
