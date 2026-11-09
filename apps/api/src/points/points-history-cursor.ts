import { z } from "zod";

// 025 EARS-46 — the opaque `nextCursor` of `GET /v1/me/points/postings`: the
// keyset position (`occurred_at`, `id`) of the last item of a page, as
// base64url JSON. `occurred_at` travels as Postgres's own microsecond UTC text
// (not a JS Date, which keeps milliseconds only), so the keyset comparison
// `(occurred_at, id) < (cursor)` never skips or repeats a posting that shares
// a millisecond with the page boundary.

export interface PostingHistoryPosition {
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ` — microsecond UTC, as Postgres stores it. */
  readonly occurredAt: string;
  readonly id: string;
}

const PositionSchema = z.tuple([
  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  z.uuid(),
]);

export function encodePostingCursor(position: PostingHistoryPosition): string {
  return Buffer.from(
    JSON.stringify([position.occurredAt, position.id]),
    "utf8",
  ).toString("base64url");
}

/** The position a cursor names, or null when it is not one this route issued. */
export function decodePostingCursor(
  cursor: string,
): PostingHistoryPosition | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = PositionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const [occurredAt, id] = parsed.data;
  if (Number.isNaN(Date.parse(occurredAt))) return null;
  return { occurredAt, id };
}
