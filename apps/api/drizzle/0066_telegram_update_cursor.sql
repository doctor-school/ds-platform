CREATE TABLE "telegram_update_cursor" (
	"bot_id" bigint PRIMARY KEY NOT NULL,
	"next_offset" bigint DEFAULT 0 NOT NULL,
	"polled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_update_cursor_bot_id_positive" CHECK ("telegram_update_cursor"."bot_id" > 0),
	CONSTRAINT "telegram_update_cursor_next_offset_nonnegative" CHECK ("telegram_update_cursor"."next_offset" >= 0)
);
