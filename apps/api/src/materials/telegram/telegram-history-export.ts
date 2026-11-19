import { z } from "zod";
import {
  cardFromContent,
  type TelegramCardOf,
  type TelegramDropReason,
} from "./telegram-post-mapping.js";

// 048 EARS-30 (#3995) — the pure half of the one-off history import: the
// whole-file validation of the machine-readable JSON of Telegram Desktop's
// «Export chat history» of one channel, and the mapping of an exported
// message onto the SAME card rule as a polled post (EARS-26,
// `cardFromContent`). The export shape is the tdesktop JSON writer's
// (048-design «One-off history import (EARS-30)», each fact with its source
// line): a single-chat export is one object `{ name, type, id, messages }`,
// `type` is `public_channel` / `private_channel` for a channel, `id` is the
// bare channel id (no Bot API `-100` prefix), a message is
// `{ id, type: message | service | unsupported, date_unixtime: "<digits>",
// text, … }`. Only the fields named below are read; nothing of a message but
// the card fields leaves this module (EARS-36).

/** Bot API channel ids are `-(10^12 + bare id)` — the `-100…` form. */
const BOT_API_CHANNEL_OFFSET = 1_000_000_000_000n;

/** EARS-30 — the bound Bot API id an export's bare channel id must equal. */
export function botApiChannelId(bareId: number): bigint {
  return -(BOT_API_CHANNEL_OFFSET + BigInt(bareId));
}

const CHANNEL_TYPES = ["public_channel", "private_channel"] as const;

/** `text`: a plain string, or plain strings and `{ type, text }` pieces. */
const ExportTextSchema = z.union([
  z.string(),
  z.array(z.union([z.string(), z.looseObject({ text: z.string() })])),
]);

/** A file field: a path relative to `result.json`, or a «(File …)» note. */
const ExportFileSchema = z.string();

const ExportMessageSchema = z.discriminatedUnion("type", [
  z.looseObject({
    id: z.number().int().positive(),
    type: z.literal("unsupported"),
  }),
  z.looseObject({
    id: z.number().int().positive(),
    type: z.enum(["message", "service"]),
    date_unixtime: z.string().regex(/^\d+$/u),
    text: ExportTextSchema.optional(),
    photo: ExportFileSchema.optional(),
    file: ExportFileSchema.optional(),
    thumbnail: ExportFileSchema.optional(),
    media_type: z.string().optional(),
    duration_seconds: z.number().int().nonnegative().optional(),
    forwarded_from: z.string().nullable().optional(),
  }),
]);
export type TelegramExportMessage = z.infer<typeof ExportMessageSchema>;

const ChannelExportSchema = z.object({
  type: z.enum(CHANNEL_TYPES),
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  messages: z.array(ExportMessageSchema),
});
export type TelegramChannelExport = z.infer<typeof ChannelExportSchema>;

export type ParsedExport =
  { ok: true; export: TelegramChannelExport } | { ok: false; reason: string };

/**
 * EARS-30 — validate the WHOLE file before anything is written: a file that
 * does not parse, is not a single-channel export or has a message lacking a
 * field the import reads is refused with its reason (never a post text).
 */
export function parseTelegramExport(raw: string): ParsedExport {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "the export file does not parse as JSON" };
  }
  const type =
    typeof json === "object" && json !== null
      ? (json as { type?: unknown }).type
      : undefined;
  if (!CHANNEL_TYPES.includes(type as (typeof CHANNEL_TYPES)[number])) {
    return {
      ok: false,
      reason:
        "not a channel export: the file's type is not public_channel or private_channel",
    };
  }
  const parsed = ChannelExportSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return {
      ok: false,
      reason: `not a valid channel export: ${issue.path.join(".") || "(root)"} — ${issue.code}`,
    };
  }
  return { ok: true, export: parsed.data };
}

/** The exported medium a preview is made from (EARS-29 via EARS-30). */
export type ExportPreviewFile =
  { kind: "file"; path: string } | { kind: "not_exported" };

export type MappedExportMessage =
  | { kind: "card"; card: TelegramCardOf<ExportPreviewFile> }
  | { kind: "media_no_text" }
  | { kind: "drop"; reason: TelegramDropReason };

/** The only `media_type` a card carries; every other is other content. */
const VIDEO_MEDIA_TYPE = "video_file";

/** Content fields of an exported message no card field carries (EARS-26). */
const UNSUPPORTED_CONTENT = [
  "poll",
  "todo_list",
  "contact_information",
  "location_information",
  "live_location_period_seconds",
  "place_name",
  "game_title",
  "invoice_information",
  "giveaway_information",
  "giveaway_results",
  "paid_stars_amount",
  "rich_message",
] as const;

function exportText(
  text: z.infer<typeof ExportTextSchema> | undefined,
): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  return text
    .map((part) => (typeof part === "string" ? part : part.text))
    .join("");
}

/** A file field written as a path, or the writer's «(File …)» skip note. */
function previewFile(value: string): ExportPreviewFile {
  return value.startsWith("(")
    ? { kind: "not_exported" }
    : { kind: "file", path: value };
}

/**
 * EARS-30 — one exported message → a card under EARS-26, a skip of media with
 * no text (Constraints: an album or a captionless photo or video), or a drop
 * with the reason the poller would give.
 */
export function mapExportMessage(
  message: TelegramExportMessage,
): MappedExportMessage {
  if (message.type === "unsupported") {
    return { kind: "drop", reason: "unsupported_content" };
  }
  if (message.type === "service") {
    return { kind: "drop", reason: "service_message" };
  }
  // The writer sets `forwarded_from` (a name, or null for a hidden sender)
  // on every forward.
  if ("forwarded_from" in message && message.forwarded_from !== undefined) {
    return { kind: "drop", reason: "forward" };
  }
  const isVideo = message.media_type === VIDEO_MEDIA_TYPE;
  if (
    (message.media_type !== undefined && !isVideo) ||
    (message.file !== undefined && !isVideo) ||
    UNSUPPORTED_CONTENT.some(
      (k) => (message as Record<string, unknown>)[k] !== undefined,
    )
  ) {
    return { kind: "drop", reason: "unsupported_content" };
  }
  let preview: ExportPreviewFile | null = null;
  if (message.photo !== undefined) preview = previewFile(message.photo);
  else if (isVideo && message.thumbnail !== undefined) {
    preview = previewFile(message.thumbnail);
  }
  const rawText = exportText(message.text);
  const isMedia = message.photo !== undefined || isVideo;
  if (rawText.trim() === "") {
    return isMedia
      ? { kind: "media_no_text" }
      : { kind: "drop", reason: "empty" };
  }
  const card = cardFromContent({
    messageId: message.id,
    rawText,
    publishedAt: new Date(Number(message.date_unixtime) * 1000),
    // The export writes no album id (048-design): a captioned album part
    // imports as its own post.
    mediaGroupId: null,
    durationSeconds: isVideo ? (message.duration_seconds ?? null) : null,
    preview,
  });
  if (card === null) return { kind: "drop", reason: "empty" };
  return { kind: "card", card };
}
