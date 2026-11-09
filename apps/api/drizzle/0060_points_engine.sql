-- 025 attention-points engine — one universal rule engine (#3838; 025-design
-- production amendment F, G, H; EARS-32…44). Forward-only and additive over
-- 0058 and 0059: no 0058/0059 row is touched, the 21 seeded version-1 rows
-- included. drizzle-kit generated the DDL below the guard; the guard, the
-- triggers and the seed are hand-written.
--
--   1. Guard (EARS-44): raise — applying nothing, the migration runs in one
--      transaction — when `points_rule_versions` has any `version > 1`, whose
--      number the seed's version 2 would collide with or supersede. Existing
--      postings do not block: they are immutable, cite their version-1 rule
--      by FK and are never re-evaluated (EARS-42), and the dev and stage
--      databases already hold e2e postings of #3807/#3808.
--   2. `points_rule_versions` gains `kind` (nullable: the 0059 rows stay as
--      stored) and `trigger_fact_types` (GIN); `ADD COLUMN` with a constant
--      default fires no row trigger. The 0059 immutability function is
--      replaced by one that also freezes the two new columns — otherwise an
--      UPDATE of `trigger_fact_types` could re-activate a version.
--   3. `points_facts`, the fact journal (EARS-40), immutable except the
--      ADR-0009 erasure re-pointing of `person_id` under the session flag
--      `app.points_erasure = 'on'`.
--   4. `points_postings` gains (`rule_id`, `credit_account_id`, `occurred_at`)
--      for `countPer` (EARS-36).
--   5. The seed of 025-design G at the epoch, `published_by` NULL: version 2
--      of every mapped 0059 accrual id, version 1 of every new rule and
--      setting id. Nothing for the retired 0059 ids. The rows equal
--      `POINTS_ENGINE_SEED` (packages/schemas/src/points/rules.ts);
--      points-seed-v2.e2e-spec pins the two together.
-- points-engine-guard:begin
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "points_rule_versions" WHERE "version" > 1) THEN
		RAISE EXCEPTION '0060_points_engine: a points_rule_versions version above 1 exists — an admin-published version would be superseded (025 EARS-44)';
	END IF;
END;
$$;
-- points-engine-guard:end
--> statement-breakpoint
CREATE TABLE "points_facts" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"person_id" uuid NOT NULL,
	"ref_kind" text,
	"ref_id" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "points_facts_outcome_check" CHECK ("points_facts"."outcome" IN ('applied', 'duplicate', 'no-effect')),
	CONSTRAINT "points_facts_ref_check" CHECK (("points_facts"."ref_kind" IS NULL) = ("points_facts"."ref_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "points_rule_versions" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "points_rule_versions" ADD COLUMN "trigger_fact_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "points_facts_person_received_idx" ON "points_facts" USING btree ("person_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "points_postings_rule_credit_occurred_idx" ON "points_postings" USING btree ("rule_id","credit_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "points_rule_versions_trigger_fact_types_idx" ON "points_rule_versions" USING gin ("trigger_fact_types");--> statement-breakpoint
ALTER TABLE "points_rule_versions" ADD CONSTRAINT "points_rule_versions_kind_check" CHECK ("points_rule_versions"."kind" IS NULL OR "points_rule_versions"."kind" IN ('rule', 'setting', 'system'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION points_rule_versions_immutable() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'points_rule_versions is append-only (025 EARS-25): DELETE prohibited';
	END IF;
	IF NEW.rule_id IS DISTINCT FROM OLD.rule_id
		OR NEW.version IS DISTINCT FROM OLD.version
		OR NEW.parameters IS DISTINCT FROM OLD.parameters
		OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
		OR NEW.kind IS DISTINCT FROM OLD.kind
		OR NEW.trigger_fact_types IS DISTINCT FROM OLD.trigger_fact_types THEN
		RAISE EXCEPTION 'points_rule_versions is immutable (025 EARS-25): publish a new version instead';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- EARS-40 — the journal is as permanent as the postings it explains. The one
-- carve-out: the ADR-0009 erasure procedure re-points `person_id` (and only
-- it) with `SET LOCAL app.points_erasure = 'on'`.
CREATE OR REPLACE FUNCTION points_facts_append_only() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND current_setting('app.points_erasure', true) = 'on'
		AND (to_jsonb(NEW) - 'person_id') = (to_jsonb(OLD) - 'person_id') THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'points_facts is append-only (025 EARS-40): % prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER points_facts_no_mutate
	BEFORE UPDATE OR DELETE ON "points_facts"
	FOR EACH ROW EXECUTE FUNCTION points_facts_append_only();
--> statement-breakpoint
INSERT INTO "points_rule_versions" ("rule_id", "version", "kind", "trigger_fact_types", "parameters", "effective_from", "published_by") VALUES
	('accrual.registration', 2, 'rule', '{account.registered,phone.verified}'::text[], '{"kind":"rule","label":"Registration grant","trigger":["account.registered","phone.verified"],"condition":{"all":[{"eq":[{"pred":"person.registered"},true]},{"eq":[{"pred":"person.phoneVerified"},true]}]},"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":20,"bre":0,"con":0}},"limits":[{"oncePer":["subject"],"key":"welcome"}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.profile', 2, 'rule', '{profile.verified}'::text[], '{"kind":"rule","label":"Profile grant","trigger":["profile.verified"],"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":30,"bre":2,"con":0}},"limits":[{"oncePer":["subject"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.lesson', 2, 'rule', '{lesson.completed}'::text[], '{"kind":"rule","label":"Lesson award, Pul part, online","trigger":["lesson.completed"],"condition":{"eq":[{"attr":"mode"},"online"]},"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":10,"bre":0,"con":0}},"limits":[{"oncePer":["subject","ref"],"key":"lesson.pul"}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.lesson.any-mode', 1, 'rule', '{lesson.completed}'::text[], '{"kind":"rule","label":"Lesson award, Bre part, any mode","trigger":["lesson.completed"],"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":0,"bre":1,"con":0}},"limits":[{"oncePer":["subject","ref"],"key":"lesson"}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.module', 2, 'rule', '{module.completed}'::text[], '{"kind":"rule","label":"Module award, Pul part, online","trigger":["module.completed"],"condition":{"eq":[{"attr":"mode"},"online"]},"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":20,"bre":0,"con":0}},"limits":[{"oncePer":["subject","ref"],"key":"module.pul"}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.module.any-mode', 1, 'rule', '{module.completed}'::text[], '{"kind":"rule","label":"Module award, Bre and Con part, any mode","trigger":["module.completed"],"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":0,"bre":3,"con":1}},"limits":[{"oncePer":["subject","ref"],"key":"module"}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.participation', 2, 'rule', '{attendance.confirmed}'::text[], '{"kind":"rule","label":"Participation award","trigger":["attendance.confirmed"],"condition":{"gte":[{"attr":"presenceSharePercent"},{"setting":"setting.presence.share"}]},"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":0,"bre":2,"con":1}},"limits":[{"oncePer":["subject","ref"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.question', 2, 'rule', '{event.question-asked}'::text[], '{"kind":"rule","label":"Engagement award, question to the speaker","trigger":["event.question-asked"],"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":0,"bre":1,"con":0}},"limits":[{"oncePer":["subject","ref"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.rating', 2, 'rule', '{event.rated}'::text[], '{"kind":"rule","label":"Engagement award, item rating","trigger":["event.rated"],"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":0,"bre":1,"con":0}},"limits":[{"oncePer":["subject","ref"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.interactive', 2, 'rule', '{event.interactive-answered}'::text[], '{"kind":"rule","label":"Engagement award, interactive answer","trigger":["event.interactive-answered"],"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":0,"bre":1,"con":0}},"limits":[{"oncePer":["subject","ref"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.referral-inviter', 2, 'rule', '{phone.verified,lesson.completed}'::text[], '{"kind":"rule","label":"Referral award, inviter","trigger":["phone.verified","lesson.completed"],"condition":{"all":[{"ne":[{"pred":"person.referrer"},null]},{"eq":[{"pred":"person.phoneVerified"},true]},{"gte":[{"pred":"person.completedLessons"},1]}]},"effect":{"kind":"credit","beneficiary":{"pred":"person.referrer"},"amounts":{"pul":30,"bre":2,"con":0}},"limits":[{"oncePer":["beneficiary","subject"]},{"countPer":{"scope":["beneficiary"],"period":"month","n":5}}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.referral-invitee', 2, 'rule', '{phone.verified,lesson.completed}'::text[], '{"kind":"rule","label":"Referral award, invitee","trigger":["phone.verified","lesson.completed"],"condition":{"all":[{"ne":[{"pred":"person.referrer"},null]},{"eq":[{"pred":"person.phoneVerified"},true]},{"gte":[{"pred":"person.completedLessons"},1]}]},"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":30,"bre":0,"con":0}},"limits":[{"oncePer":["subject"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.starter-bonus', 1, 'rule', '{person.starter-bonus-eligible}'::text[], '{"kind":"rule","label":"Starter bonus for doctors registered before the engine","trigger":["person.starter-bonus-eligible"],"effect":{"kind":"credit","beneficiary":"subject","amounts":{"pul":20,"bre":0,"con":0}},"limits":[{"oncePer":["subject"],"key":"welcome"}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('spend.reserve', 1, 'rule', '{registration.created}'::text[], '{"kind":"rule","label":"Reserve the price of a registration","trigger":["registration.created"],"effect":{"kind":"reserve","allowAdvance":true},"limits":[{"oncePer":["subject","registrationId"]},{"concurrentOpen":{"n":{"setting":"setting.reserve.limitedSeats.max"},"filter":{"limitedSeats":true}}}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('spend.settle', 1, 'rule', '{attendance.confirmed}'::text[], '{"kind":"rule","label":"Settle the hold on attendance","trigger":["attendance.confirmed"],"condition":{"gte":[{"attr":"presenceSharePercent"},{"setting":"setting.presence.share"}]},"effect":{"kind":"settle"},"limits":[{"oncePer":["subject","registrationId"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('spend.release', 1, 'rule', '{registration.cancelled,registration.voided,registration.no-show}'::text[], '{"kind":"rule","label":"Release the hold of a cancelled, voided or no-show registration","trigger":["registration.cancelled","registration.voided","registration.no-show"],"effect":{"kind":"release"},"limits":[{"oncePer":["subject","registrationId"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('spend.debit', 1, 'rule', '{item.access-requested}'::text[], '{"kind":"rule","label":"Debit the price of immediate access","trigger":["item.access-requested"],"effect":{"kind":"debit","amounts":"price"},"limits":[{"oncePer":["subject","ref"]}],"validFrom":null,"validUntil":null,"active":true,"stacking":{"priority":0,"exclusiveGroup":null}}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.presence.share', 1, 'setting', '{}'::text[], '{"kind":"setting","value":30}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.advance.cap', 1, 'setting', '{}'::text[], '{"kind":"setting","value":150}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.noShow.window', 1, 'setting', '{}'::text[], '{"kind":"setting","value":24}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.reserve.limitedSeats.max', 1, 'setting', '{}'::text[], '{"kind":"setting","value":3}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.leaderboard.conWeight', 1, 'setting', '{}'::text[], '{"kind":"setting","value":2}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.leaderboard.breWeight', 1, 'setting', '{}'::text[], '{"kind":"setting","value":1}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.leaderboard.top', 1, 'setting', '{}'::text[], '{"kind":"setting","value":10}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.leaderboard.neighbours', 1, 'setting', '{}'::text[], '{"kind":"setting","value":5}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('setting.effect.maxAmount', 1, 'setting', '{}'::text[], '{"kind":"setting","value":500}'::jsonb, '1970-01-01 00:00:00+00', NULL);
