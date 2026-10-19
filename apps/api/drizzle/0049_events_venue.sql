-- 044 EARS-13 (#2517): the venue is the event's own field («Место проведения»
-- in the admin event form), not a deployment env key. Nullable free text.
ALTER TABLE "events" ADD COLUMN "venue" text;--> statement-breakpoint
-- The production congress event carries the venue its confirmation email has
-- named since release (the retired env key's value), so production
-- sign-ups never hit the «no venue» refusal after deploy. No-op on any database
-- without that event.
UPDATE "events" SET "venue" = 'Москва, ГК «Милан», ул. Шипиловская, д. 28А' WHERE "id" = 'f637ce37-02e3-4fb8-ae88-56f782729632';
