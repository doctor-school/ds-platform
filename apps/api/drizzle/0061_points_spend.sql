-- 025 attention-points engine — the spend slice (#3810; 025-design
-- production amendment E, F; EARS-26, EARS-35, EARS-2). Forward-only and
-- additive: no 0058/0059/0060 row is touched. drizzle-kit generated the DDL;
-- the audit triggers are hand-written.
--
--   1. `points_prices` — the price list of any item kind (owner decision 1):
--      mode `open` | `advance` | `threshold`, a Pul price and the
--      `limitedSeats` flag. No row = `open` at price 0.
--   2. `points_reserves` — the hold projection, one row per registration
--      whose `spend.reserve` applied; `held` → `settled` | `released`.
--   3. `points_obligations` — the advance obligation projection, per
--      obligation (the advance writer ships with #3811).
--   4. Every table carries `audit_row_change()` (0013), so a price-list write
--      and every projection transition lands in `audit_ledger` attributed
--      through the request audit context.
--
-- The seeded `spend.*` rules and `setting.*` values are already in 0060; this
-- migration adds no rule row.
CREATE TABLE "points_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_account_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"opened" integer NOT NULL,
	"netted" integer DEFAULT 0 NOT NULL,
	"remaining" integer NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "points_obligations_registration_unique" UNIQUE("registration_id"),
	CONSTRAINT "points_obligations_state_check" CHECK ("points_obligations"."state" IN ('open', 'netted', 'annulled')),
	CONSTRAINT "points_obligations_amounts_check" CHECK ("points_obligations"."opened" > 0 AND "points_obligations"."netted" >= 0 AND "points_obligations"."remaining" >= 0 AND "points_obligations"."netted" <= "points_obligations"."opened")
);
--> statement-breakpoint
CREATE TABLE "points_prices" (
	"item_ref" text PRIMARY KEY NOT NULL,
	"item_kind" text NOT NULL,
	"mode" text NOT NULL,
	"pul_cost" integer NOT NULL,
	"limited_seats" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "points_prices_mode_check" CHECK ("points_prices"."mode" IN ('open', 'advance', 'threshold')),
	CONSTRAINT "points_prices_pul_cost_check" CHECK ("points_prices"."pul_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "points_reserves" (
	"registration_id" uuid PRIMARY KEY NOT NULL,
	"person_account_id" uuid NOT NULL,
	"item_ref" text NOT NULL,
	"price" integer NOT NULL,
	"balance_part" integer NOT NULL,
	"advance_part" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"reserve_event_id" text NOT NULL,
	"close_event_id" text,
	"held_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "points_reserves_state_check" CHECK ("points_reserves"."state" IN ('held', 'settled', 'released')),
	CONSTRAINT "points_reserves_parts_check" CHECK ("points_reserves"."balance_part" >= 0 AND "points_reserves"."advance_part" >= 0 AND "points_reserves"."balance_part" + "points_reserves"."advance_part" = "points_reserves"."price"),
	CONSTRAINT "points_reserves_close_check" CHECK (("points_reserves"."state" = 'held') = ("points_reserves"."close_event_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "points_obligations" ADD CONSTRAINT "points_obligations_person_account_id_points_accounts_id_fk" FOREIGN KEY ("person_account_id") REFERENCES "public"."points_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_obligations" ADD CONSTRAINT "points_obligations_registration_id_points_reserves_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."points_reserves"("registration_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_prices" ADD CONSTRAINT "points_prices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_reserves" ADD CONSTRAINT "points_reserves_person_account_id_points_accounts_id_fk" FOREIGN KEY ("person_account_id") REFERENCES "public"."points_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_obligations_person_state_idx" ON "points_obligations" USING btree ("person_account_id","state");--> statement-breakpoint
CREATE INDEX "points_reserves_person_state_idx" ON "points_reserves" USING btree ("person_account_id","state");--> statement-breakpoint
CREATE TRIGGER points_prices_audit AFTER INSERT OR UPDATE OR DELETE
  ON "points_prices" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER points_reserves_audit AFTER INSERT OR UPDATE OR DELETE
  ON "points_reserves" FOR EACH ROW EXECUTE FUNCTION audit_row_change();--> statement-breakpoint
CREATE TRIGGER points_obligations_audit AFTER INSERT OR UPDATE OR DELETE
  ON "points_obligations" FOR EACH ROW EXECUTE FUNCTION audit_row_change();
