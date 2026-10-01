-- 046 EARS-19 (#2434): the account holder's birth date, asked once in the poster flow
-- and reused across events. Expand-only: a nullable column, no backfill.
ALTER TABLE "users" ADD COLUMN "birth_date" date;
