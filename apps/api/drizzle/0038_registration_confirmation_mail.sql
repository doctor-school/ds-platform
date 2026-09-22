CREATE TYPE "public"."confirmation_mail_status" AS ENUM('sent', 'failed');--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "confirmation_mail_status" "confirmation_mail_status";--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "confirmation_mail_at" timestamp with time zone;