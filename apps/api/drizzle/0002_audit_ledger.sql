CREATE TABLE "audit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"subject_id" text,
	"sid" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_ledger_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
-- Append-only enforcement (ADR-0003 §2.7): UPDATE and DELETE are prohibited at
-- the DB level, not just by ORM convention — a compromised app credential still
-- cannot rewrite history. Corrections are compensating INSERTs. Hand-added atop
-- drizzle-kit output (it never emits triggers); re-apply on regeneration.
CREATE OR REPLACE FUNCTION audit_ledger_append_only() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_ledger is append-only (ADR-0003 §2.7): % prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_ledger_no_mutate
	BEFORE UPDATE OR DELETE ON "audit_ledger"
	FOR EACH ROW EXECUTE FUNCTION audit_ledger_append_only();
