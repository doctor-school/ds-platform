ALTER TABLE "registrations" ADD COLUMN "answers" jsonb;--> statement-breakpoint
-- ── 044 EARS-5 — `registrations` becomes PD-bearing, so the edit-audit
--    PD-column registry is regenerated (010-design §5; the TS mirror is
--    `AUDIT_PD_COLUMNS` in packages/db/src/audit.ts, and the parity e2e
--    `apps/api/test/db/universal-edit-audit.e2e-spec.ts` asserts SQL ⇄ TS
--    agreement). The congress answer sheet carries a participant's surname,
--    patronymic, contact phone (as typed and normalised) and email inside one
--    jsonb value: without this entry every edit of a registration would copy
--    that payload into an `audit_ledger` diff in the clear.
--
--    Only `answers` is masked. `user_id`, `event_id`, `registered_at` and the
--    lifecycle columns are the structural facts the ledger exists to answer,
--    and masking them would erase the diff without protecting anything — the
--    same reasoning 012-design §6 applied to the taxonomy join columns.
CREATE OR REPLACE FUNCTION audit_pd_columns(p_table text) RETURNS text[] AS $$
  SELECT CASE p_table
    WHEN 'users' THEN ARRAY['email', 'phone', 'display_name']
    WHEN 'consent_records' THEN ARRAY['user_id']
    WHEN 'registrations' THEN ARRAY['answers']
    ELSE ARRAY[]::text[]
  END;
$$ LANGUAGE sql IMMUTABLE;
