-- 006 EARS-19 / 007 EARS-13 (#2911): «Показывать зрителям число участников» —
-- a per-event setting. While false, a caller whose session carries no staff role
-- receives no live presence count. Back-fill false: the owner's default is hidden.
ALTER TABLE "events" ADD COLUMN "show_presence_count" boolean DEFAULT false NOT NULL;
