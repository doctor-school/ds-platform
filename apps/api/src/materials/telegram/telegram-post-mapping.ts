import { FEED_POST_TEXT_MAX } from "@ds/db";
import type {
  TelegramMessage,
  TelegramPhotoSize,
} from "./telegram-update.schema.js";

// 048 EARS-26 (#3994) — one channel post → the card data of a `post` entry,
// or a drop with its reason (048-design §Post mapping). Pure: the writer
// (`telegram.feed-source.ts`) applies the album and edit rules (EARS-27,
// EARS-28). Only the card fields leave this function — never the
// `author_signature`, the entities, the sender or the raw message (EARS-36).

/** The widest photo size the preview takes (EARS-29). */
export const PREVIEW_MAX_WIDTH = 1280;

export type TelegramDropReason =
  "forward" | "unsupported_content" | "service_message" | "empty";

/** The Telegram medium a preview is copied from (EARS-29). */
export interface TelegramPreviewCandidate {
  fileId: string;
  fileUniqueId: string;
}

/**
 * The card data of one post, over the medium its preview comes from: a Bot
 * API file (polled post) or an exported file (the one-off import, EARS-30).
 */
export interface TelegramCardOf<P> {
  messageId: number;
  /** Plain text, possibly empty (a captionless photo or album part). */
  text: string;
  publishedAt: Date;
  mediaGroupId: string | null;
  durationSeconds: number | null;
  preview: P | null;
}

export type TelegramCard = TelegramCardOf<TelegramPreviewCandidate>;

/** The raw content of a post that passed the drop rules of EARS-26. */
export interface TelegramPostContent<P> {
  messageId: number;
  rawText: string;
  publishedAt: Date;
  mediaGroupId: string | null;
  durationSeconds: number | null;
  preview: P | null;
}

/**
 * EARS-26 — the card fields of a post's content: the text cut, and `null`
 * (dropped as `empty`) when the post has neither text nor an image. Shared
 * by the polled-post mapping and the export mapping of EARS-30.
 */
export function cardFromContent<P>(
  content: TelegramPostContent<P>,
): TelegramCardOf<P> | null {
  const text = cutPostText(content.rawText);
  if (text === "" && content.preview === null) return null;
  return {
    messageId: content.messageId,
    text,
    publishedAt: content.publishedAt,
    mediaGroupId: content.mediaGroupId,
    durationSeconds: content.durationSeconds,
    preview: content.preview,
  };
}

export type MappedPost =
  | { kind: "card"; card: TelegramCard }
  | { kind: "drop"; reason: TelegramDropReason };

/** Content no card field carries (048-design §Post mapping). */
const UNSUPPORTED_CONTENT = [
  "poll",
  "sticker",
  "animation",
  "audio",
  "voice",
  "document",
  "video_note",
  "location",
  "venue",
  "contact",
  "dice",
  "game",
  "story",
  "paid_media",
  "giveaway",
  "giveaway_winners",
  "invoice",
] as const;

/** Service fields of a channel message — not a publication. */
const SERVICE_FIELDS = [
  "pinned_message",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "channel_chat_created",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "message_auto_delete_timer_changed",
  "video_chat_scheduled",
  "video_chat_started",
  "video_chat_ended",
  "video_chat_participants_invited",
  "boost_added",
  "chat_background_set",
  "paid_message_price_changed",
  "giveaway_created",
  "giveaway_completed",
] as const;

/**
 * EARS-26 — plain text with whitespace collapsed; over 500 characters, cut at
 * the last word boundary within 500 plus «…». Counted in code points, so a
 * cut never splits a surrogate pair (Postgres `char_length` counts the same).
 */
export function cutPostText(raw: string): string {
  const text = raw.replace(/\s+/gu, " ").trim();
  const chars = Array.from(text);
  if (chars.length <= FEED_POST_TEXT_MAX) return text;
  const head = chars.slice(0, FEED_POST_TEXT_MAX);
  let end = FEED_POST_TEXT_MAX;
  if (chars[FEED_POST_TEXT_MAX] !== " ") {
    const lastSpace = head.lastIndexOf(" ");
    if (lastSpace > 0) end = lastSpace;
  }
  return `${head.slice(0, end).join("").trimEnd()}…`;
}

/** EARS-26 — the documented post form `t.me/<channel>/<id>`. */
export function telegramPermalink(address: string, messageId: number): string {
  return `https://t.me/${address}/${messageId}`;
}

/** EARS-29 — the largest size at most 1280 px wide, else the smallest. */
export function choosePhotoSize(sizes: TelegramPhotoSize[]): TelegramPhotoSize {
  const byWidth = [...sizes].sort((a, b) => a.width - b.width);
  const within = byWidth.filter((s) => s.width <= PREVIEW_MAX_WIDTH);
  return within.at(-1) ?? byWidth[0]!;
}

function has(message: TelegramMessage, key: string): boolean {
  const value = (message as Record<string, unknown>)[key];
  return value !== undefined && value !== null;
}

export function mapChannelPost(message: TelegramMessage): MappedPost {
  if (has(message, "forward_origin"))
    return { kind: "drop", reason: "forward" };
  if (SERVICE_FIELDS.some((k) => has(message, k))) {
    return { kind: "drop", reason: "service_message" };
  }
  if (UNSUPPORTED_CONTENT.some((k) => has(message, k))) {
    return { kind: "drop", reason: "unsupported_content" };
  }
  let preview: TelegramPreviewCandidate | null = null;
  let durationSeconds: number | null = null;
  if (message.photo) {
    const chosen = choosePhotoSize(message.photo);
    preview = { fileId: chosen.file_id, fileUniqueId: chosen.file_unique_id };
  } else if (message.video) {
    durationSeconds = message.video.duration;
    const thumb = message.video.thumbnail;
    if (thumb)
      preview = { fileId: thumb.file_id, fileUniqueId: thumb.file_unique_id };
  }
  const card = cardFromContent({
    messageId: message.message_id,
    rawText: message.text ?? message.caption ?? "",
    publishedAt: new Date(message.date * 1000),
    mediaGroupId: message.media_group_id ?? null,
    durationSeconds,
    preview,
  });
  if (card === null) return { kind: "drop", reason: "empty" };
  return { kind: "card", card };
}
