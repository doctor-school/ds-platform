CREATE TABLE "sign_in_host_records" (
	"cookie_id_hash" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"zitadel_session_id" text NOT NULL,
	"session_token" text NOT NULL,
	"fingerprint" text NOT NULL,
	"last_credential_at" timestamp with time zone NOT NULL,
	"last_finalised_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sign_in_host_records_expires_at_idx" ON "sign_in_host_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sign_in_host_records_last_finalised_at_idx" ON "sign_in_host_records" USING btree ("last_finalised_at");