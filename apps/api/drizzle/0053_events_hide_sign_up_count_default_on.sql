-- 007 EARS-12 / 019 EARS-19 (#3479): «Скрыть число записавшихся» is on by
-- default — the colleagues' sign-up count is hidden unless an operator turns
-- the option off for that event. The owner's decision covers every existing
-- event too, so the back-fill moves all rows to hidden.
ALTER TABLE "events" ALTER COLUMN "hide_sign_up_count" SET DEFAULT true;--> statement-breakpoint
UPDATE "events" SET "hide_sign_up_count" = true;
