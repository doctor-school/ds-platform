-- 046 EARS-26 (#2437): the programme committee joins the event-scoped roles.
-- A committee member is bound to one or more events (one row per event), so the
-- registrar's one-grant-per-user partial index stays registrar-only and a new
-- (user_id, role, event_id) unique index refuses a duplicate binding.
ALTER TABLE "event_role_grants" DROP CONSTRAINT "event_role_grants_role_known";--> statement-breakpoint
CREATE UNIQUE INDEX "event_role_grants_user_role_event_uniq" ON "event_role_grants" USING btree ("user_id","role","event_id");--> statement-breakpoint
ALTER TABLE "event_role_grants" ADD CONSTRAINT "event_role_grants_role_known" CHECK ("event_role_grants"."role" IN ('event-registrar', 'congress-program-committee'));