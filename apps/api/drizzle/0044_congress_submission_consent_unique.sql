-- 046 EARS-16 (#2433): one congress-submission consent row per account and version,
-- enforced by the store. Partial on the purpose: every other consent purpose is
-- unchanged. The purpose ships with 0043 and is unreleased, so no duplicates exist.
CREATE UNIQUE INDEX "consent_records_congress_submission_uniq" ON "consent_records" USING btree ("user_id","version") WHERE "consent_records"."purpose" = 'congress-submission-personal-data';