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
 * add it to `CONNECTED_FEED_BLOCKS`, ship its read — no other block moves.
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
 * the nearest events (EARS-4); «Зачем это мне» (#1502) and the adjacent areas
 * (#1503) join here when they ship, schools/lessons/leaderboard/communities
 * when 023 / 024 / 022 / 027 connect their content.
 */
export const CONNECTED_FEED_BLOCKS = [
  "events",
] as const satisfies readonly FeedBlockPosition[];
export const FeedBlockKindSchema = z.enum(CONNECTED_FEED_BLOCKS);
export type FeedBlockKind = z.infer<typeof FeedBlockKindSchema>;

/**
 * One connected block of the feed. It names its kind and the read that fills
 * it — the page reads each block on its own (LD-7), so one failing block never
 * takes its siblings down.
 */
export const FeedBlockSchema = z
  .object({
    kind: FeedBlockKindSchema,
    /** The block's own read, relative to the API base (`/v1/storefront/feed/{code}/events`). */
    read: z.string().min(1),
  })
  .strict();
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
  kind: FeedBlockKind,
): string {
  return `/v1/storefront/feed/${encodeURIComponent(specialtyCode)}/${kind}`;
}

/** The connected blocks of a specialty's feed, in the F-018-1 relative order. */
export function specialtyFeedBlocks(specialtyCode: string): FeedBlock[] {
  return FEED_BLOCK_ORDER.filter((kind): kind is FeedBlockKind =>
    (CONNECTED_FEED_BLOCKS as readonly string[]).includes(kind),
  ).map((kind) => ({
    kind,
    read: specialtyFeedBlockRead(specialtyCode, kind),
  }));
}

/** The 019 events feed narrowed to one specialty — the EARS-4 link-out. */
export function specialtyEventsHref(specialtyCode: string): string {
  return `/events?specialty=${encodeURIComponent(specialtyCode)}`;
}

/** The doctor-host path of a specialty's feed. */
export function specialtyFeedPath(specialtyCode: string): string {
  return `/feed/${encodeURIComponent(specialtyCode)}`;
}
