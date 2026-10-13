-- 007 EARS-12 / 019 EARS-19 (#2913): «Скрыть число записавшихся» — a per-event
-- display option. While true, every public card read serves signUpCount: null.
-- Back-fill false: every existing event keeps showing its count.
ALTER TABLE "events" ADD COLUMN "hide_sign_up_count" boolean DEFAULT false NOT NULL;