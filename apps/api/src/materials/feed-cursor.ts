import { z } from "zod";
import { isEventCursorInstant, TaxonomyError } from "../taxonomy/index.js";
import type { FeedCursorPosition } from "./feed-entries.repository.js";

// 048 — the `(published_at, id)` keyset cursor of every feed-entry list: the
// public feed (EARS-9) and «Публикации» (EARS-32).

/**
 * The instant exactly as Postgres rendered it to the microsecond — the
 * `public-event-cursor.ts` rule, whose grammar check this reuses, so a
 * truncated or hand-mangled instant is a 400, never a repeat or a 500. Opaque
 * by contract (base64url JSON).
 */
const FEED_CURSOR_SHAPE = z
  .object({
    publishedAt: z
      .string()
      .refine(isEventCursorInstant, "not a cursor instant issued by this API"),
    id: z.uuid(),
  })
  .strict();

export function encodeFeedCursor(row: {
  publishedAtCursor: string;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ publishedAt: row.publishedAtCursor, id: row.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeFeedCursor(cursor?: string): FeedCursorPosition | null {
  if (cursor === undefined) return null;
  try {
    const { publishedAt, id } = FEED_CURSOR_SHAPE.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return { instant: publishedAt, id };
  } catch {
    throw new TaxonomyError(
      "CURSOR_INVALID",
      "this cursor was not issued by this API; start from the first page",
    );
  }
}
