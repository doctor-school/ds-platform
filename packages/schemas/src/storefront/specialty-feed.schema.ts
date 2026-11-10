import { z } from "zod";

import { DoctorEventCardSchema } from "../events/doctor-event-card.schema.js";
import { SpecialtyRefSchema } from "../specialties/specialties.schema.js";

/**
 * 018 EARS-1 / LD-1 (#1496) — the specialty feed envelope, and 018 EARS-4
 * (#1499) — its nearest-events read (018-design §7).
 *
 * ## The feed is additive by content type (LD-1)
 *
 * `FEED_BLOCK_ORDER` is the F-018-1 order of EVERY block the feed can ever
 * carry — a server-side constant, identical for every viewer of a specialty,
 * with no ranking input. `blocks` lists only the CONNECTED ones, in that
 * relative order. A type that is not connected has no entry at all: it is not
 * a member of {@link FeedBlockKindSchema} until the Issue that connects it adds
 * it there, so an envelope naming it is REJECTED by this schema rather than
 * rendered as a placeholder. Connecting a type is: add its kind to the enum,
 * add it to `CONNECTED_FEED_BLOCKS`, ship its read (or, for envelope-carried
 * copy such as the EARS-7 value block, its union member) — no other block
 * moves.
 *
 * Every object is `.strict()`: a ranking score, a weighting or a
 * personalisation flag added upstream fails here (EARS-1).
 */

/**
 * The full F-018-1 order (018-design §1, blocks 1–7). Not every entry is
 * connected; this is the position table a connected block takes.
 */
export const FEED_BLOCK_ORDER = [
  "events",
  "schools",
  "lessons",
  "value",
  "adjacent",
  "leaderboard",
  "communities",
] as const;
export type FeedBlockPosition = (typeof FEED_BLOCK_ORDER)[number];

/**
 * The content types connected on the platform today. Release 1 of 018 connects
 * the nearest events (EARS-4) and «Зачем это мне» (EARS-7); the adjacent areas
 * (#1503) join here when they ship, schools/lessons/leaderboard/communities
 * when 023 / 024 / 022 / 027 connect their content.
 */
export const CONNECTED_FEED_BLOCKS = [
  "events",
  "value",
] as const satisfies readonly FeedBlockPosition[];
export const FeedBlockKindSchema = z.enum(CONNECTED_FEED_BLOCKS);
export type FeedBlockKind = z.infer<typeof FeedBlockKindSchema>;

/**
 * The connected kinds filled by a read of their own. A kind outside this list
 * travels inside the envelope (018-design §1: the value block is editorial
 * copy with no independent read and no error state).
 */
export const READ_FEED_BLOCKS = [
  "events",
] as const satisfies readonly FeedBlockKind[];
export type FeedReadBlockKind = (typeof READ_FEED_BLOCKS)[number];

/**
 * A read-backed block: its kind and the read that fills it — the page reads
 * each block on its own (LD-7), so one failing block never takes its siblings
 * down.
 */
export const FeedReadBlockSchema = z
  .object({
    kind: z.enum(READ_FEED_BLOCKS),
    /** The block's own read, relative to the API base (`/v1/storefront/feed/{code}/events`). */
    read: z.string().min(1),
  })
  .strict();
export type FeedReadBlock = z.infer<typeof FeedReadBlockSchema>;

/** 018 EARS-7 — the four things the doctor gets (018-requirements scope). */
export const FEED_VALUE_ITEM_COUNT = 4;

export const FeedValueItemSchema = z
  .object({ title: z.string().min(1), body: z.string().min(1) })
  .strict();
export type FeedValueItem = z.infer<typeof FeedValueItemSchema>;

/**
 * 018 EARS-7 — «Зачем это мне» (018-design `ValueBlock`): the four items and
 * nothing else. Strict on purpose: LD-9 allows no payer, marking or
 * attribution beside the items, so a key carrying one is refused here rather
 * than filtered by the page.
 */
export const FeedValueBlockSchema = z
  .object({
    kind: z.literal("value"),
    items: z.array(FeedValueItemSchema).length(FEED_VALUE_ITEM_COUNT),
  })
  .strict();
export type FeedValueBlock = z.infer<typeof FeedValueBlockSchema>;
/** The editorial content of the value block, as its source supplies it. */
export type FeedValueContent = Omit<FeedValueBlock, "kind">;

/** One connected block of the feed, discriminated by its kind. */
export const FeedBlockSchema = z.discriminatedUnion("kind", [
  FeedReadBlockSchema,
  FeedValueBlockSchema,
]);
export type FeedBlock = z.infer<typeof FeedBlockSchema>;

/** The F-018-1 constant of LD-1 — «Б, сначала прийти». */
export const SPECIALTY_FEED_ORDER = "events-first" as const;

export const SpecialtyFeedSchema = z
  .object({
    specialty: SpecialtyRefSchema,
    blocks: z.array(FeedBlockSchema),
    order: z.literal(SPECIALTY_FEED_ORDER),
    /**
     * Who is reading. The session only changes card state and `viewer` — never
     * which blocks exist or their order (018-design §7). The leaderboard
     * consent flag joins with the leaderboard block (EARS-9, 022's consent),
     * not before: it has no source until then.
     */
    viewer: z.object({ loggedIn: z.boolean() }).strict(),
  })
  .strict();
export type SpecialtyFeed = z.infer<typeof SpecialtyFeedSchema>;

/**
 * How many nearest events the block shows. The block is a front door into
 * 019's events feed, not a second events feed (EARS-4): «Все события по
 * специальности →» carries the reader on.
 */
export const FEED_EVENTS_LIMIT = 3;

/**
 * 018 EARS-4 — the nearest events of a specialty. Each item is 019's ONE event
 * card payload (`DoctorEventCardSchema`, the `PublicEventSummary` of 019's
 * Event Model): `signUpCount` is `null` for an event whose «Скрыть число
 * записавшихся» option is on (019 EARS-19), `format` is the card's delivery
 * mode (an offline meet-up is the `offline` format of the same card), and
 * `nmo` is an attribute of the event only.
 */
export const FeedEventsSchema = z
  .object({
    items: z.array(DoctorEventCardSchema).max(FEED_EVENTS_LIMIT),
    /** The 019 events feed scoped to this specialty. */
    allEventsHref: z.string().min(1),
  })
  .strict();
export type FeedEvents = z.infer<typeof FeedEventsSchema>;

/** The block reads of the envelope, by kind — one place mints the path. */
export function specialtyFeedBlockRead(
  specialtyCode: string,
  kind: FeedReadBlockKind,
): string {
  return `/v1/storefront/feed/${encodeURIComponent(specialtyCode)}/${kind}`;
}

/**
 * The connected blocks of a specialty's feed, in the F-018-1 relative order.
 * Read-backed kinds get their read; the envelope-carried kinds take the
 * content their caller supplies, so this stays the one place the order lives.
 */
export function specialtyFeedBlocks(
  specialtyCode: string,
  content: { value: FeedValueContent },
): FeedBlock[] {
  return FEED_BLOCK_ORDER.filter((kind): kind is FeedBlockKind =>
    (CONNECTED_FEED_BLOCKS as readonly string[]).includes(kind),
  ).map((kind): FeedBlock => {
    switch (kind) {
      case "value":
        return { kind, items: content.value.items };
      case "events":
        return { kind, read: specialtyFeedBlockRead(specialtyCode, kind) };
    }
  });
}

/** The 019 events feed narrowed to one specialty — the EARS-4 link-out. */
export function specialtyEventsHref(specialtyCode: string): string {
  return `/events?specialty=${encodeURIComponent(specialtyCode)}`;
}

/** The doctor-host path of a specialty's feed. */
export function specialtyFeedPath(specialtyCode: string): string {
  return `/feed/${encodeURIComponent(specialtyCode)}`;
}
