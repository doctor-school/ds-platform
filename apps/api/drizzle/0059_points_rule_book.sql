-- 025 attention-points engine — the rule book (#3808; 025-design §6, EARS-25,
-- EARS-3). No table changes: `points_rule_versions` exists since 0058, so this
-- is a hand-written migration (drizzle-kit `--custom`) with an unchanged
-- snapshot.
--   * Version 1 of every rule with the PRD defaults (025-product «Earn rules»,
--     «Spending, gating and the advance», «Leaderboard»). The rows equal
--     `POINTS_RULE_DEFAULTS` in packages/schemas/src/points/rules.ts; an e2e
--     test pins the two together. `published_by` is NULL — the platform seeded
--     them, no admin did. `effective_from` is the epoch, not the migration
--     time: version 1 is the rule book the engine was specified with, so a
--     back-dated fact (a mobile offline-sync replay, a producer's late
--     delivery, a backfill of facts that predate this release) evaluates v1
--     instead of finding no active version. No posting exists before this
--     migration, so the epoch rewrites no history.
--   * The `issuance` system account every accrual debits, opened here so the
--     first accrual does not race to open it (the ledger core still opens it
--     on first need, ON CONFLICT DO NOTHING).
--   * EARS-25 «a new immutable version»: a BEFORE UPDATE OR DELETE trigger
--     refuses deleting a version and changing anything but `published_by` (the
--     one column the ADR-0009 erasure procedure may re-point). The 0058 row
--     audit trigger keeps recording every insert.
INSERT INTO "points_rule_versions" ("rule_id", "version", "parameters", "effective_from", "published_by") VALUES
	('accrual.registration', 1, '{"pul":20,"bre":0,"con":0}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.profile', 1, '{"pul":30,"bre":2,"con":0}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.lesson', 1, '{"pul":10,"bre":1,"con":0}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.module', 1, '{"pul":20,"bre":3,"con":1}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.participation', 1, '{"pul":0,"bre":2,"con":1}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.question', 1, '{"pul":0,"bre":1,"con":0}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.rating', 1, '{"pul":0,"bre":1,"con":0}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.interactive', 1, '{"pul":0,"bre":1,"con":0}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.referral-inviter', 1, '{"pul":30,"bre":2,"con":0}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('accrual.referral-invitee', 1, '{"pul":30,"bre":0,"con":0}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('cap.engagement', 1, '{"perEventAndAction":1}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('cap.referral.monthly', 1, '{"perCalendarMonth":5}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('presence.share', 1, '{"percent":30}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('advance.cap', 1, '{"pul":150}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('reserve.limitedSeats.max', 1, '{"max":3}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('noShow.window', 1, '{"hours":24}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('leaderboard.conWeight', 1, '{"weight":2}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('leaderboard.breWeight', 1, '{"weight":1}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('leaderboard.top', 1, '{"size":10}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('leaderboard.neighbours', 1, '{"size":5}'::jsonb, '1970-01-01 00:00:00+00', NULL),
	('manual-correction', 1, '{}'::jsonb, '1970-01-01 00:00:00+00', NULL)
ON CONFLICT ("rule_id", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "points_accounts" ("subject_kind", "system_code", "unit")
VALUES ('system', 'issuance', 'attention_points')
ON CONFLICT ("system_code", "unit") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION points_rule_versions_immutable() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'points_rule_versions is append-only (025 EARS-25): DELETE prohibited';
	END IF;
	IF NEW.rule_id IS DISTINCT FROM OLD.rule_id
		OR NEW.version IS DISTINCT FROM OLD.version
		OR NEW.parameters IS DISTINCT FROM OLD.parameters
		OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'points_rule_versions is immutable (025 EARS-25): publish a new version instead';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER points_rule_versions_no_mutate
	BEFORE UPDATE OR DELETE ON "points_rule_versions"
	FOR EACH ROW EXECUTE FUNCTION points_rule_versions_immutable();
