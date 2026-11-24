import { Inject, Injectable, Logger } from "@nestjs/common";
import type { FeedSource } from "@ds/db";
import { FeedEntriesRepository } from "../feed-entries.repository.js";
import type { MaterialsTx } from "../materials.repository.js";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import {
  VkVideoSchema,
  VkWallPostSchema,
  type VkWallPost,
} from "./vk-api.types.js";
import {
  mapVideo,
  mapWallPost,
  type VkPostCard,
  type VkPostDropReason,
  type VkVideoDropReason,
} from "./vk-mapping.js";

// 048 slice 3 (#4004) — the VK feed source: the ONLY writer of VK rows of
// `feed_entries` (048-design «Placement (slice 3)»), through
// `feed-entries.repository.ts`. Every write runs in the transaction that
// holds the source's row lock, so a «Выключить» and a write never
// interleave, and two writers of one source (the Callback, the reconcile, the
// import) never race on the dedup key. A database failure rolls the whole
// write back — nothing partial — and the Callback answers 500 so VK delivers
// again; every write is idempotent on `feed_entry_vk_objects`.

/** The card source line of a VK post (048-design «Data model (slice 3)»). */
export const VK_POST_SOURCE_NAME = "BBM Academy · VK";
/** The card source line of a VK Видео video. */
export const VK_VIDEO_SOURCE_NAME = "BBM Academy · VK Видео";

/** The Callback events the connector processes (EARS-40). */
export const VK_PROCESSED_EVENTS = ["wall_post_new", "video_new"] as const;

export type VkEventDropReason =
  | VkPostDropReason
  | VkVideoDropReason
  | "malformed"
  | "other_event_type"
  | "unlisted"
  | "source_off";

export type VkWriteOutcome =
  | { kind: "dropped"; reason: VkPostDropReason | VkVideoDropReason }
  | { kind: "duplicate" }
  | { kind: "written"; entryId: string }
  | { kind: "updated"; entryId: string };

export type VkEventOutcome =
  | { kind: "dropped"; reason: VkEventDropReason }
  | { kind: "duplicate" }
  | { kind: "written"; entryId: string };

/** The authenticated Callback event the route hands over (EARS-40). */
export interface VkCallbackEvent {
  type: string;
  groupId: number;
  eventId: string | null;
  object: unknown;
  retryCounter: string | null;
}

/** How a post write treats a post that already has an entry. */
type HeldPolicy = "keep" | "rewrite";

@Injectable()
export class VkFeedSource {
  private readonly logger = new Logger("VkIngress");

  constructor(
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
    @Inject(FeedEntriesRepository)
    private readonly entries: FeedEntriesRepository,
  ) {}

  /**
   * EARS-40…EARS-43 — process one authenticated Callback event: matched to
   * the source bound to its community id, written when it is a
   * `wall_post_new` / `video_new` of a switched-on source with a valid
   * object; everything else dropped and logged. Throws on a database
   * failure, writing nothing.
   */
  async receive(event: VkCallbackEvent): Promise<VkEventOutcome> {
    const outcome = await this.sources.transaction(
      async (tx): Promise<VkEventOutcome> => {
        const source = await this.sources.lockVkSourceByGroup(
          tx,
          event.groupId,
        );
        if (!source) return { kind: "dropped", reason: "unlisted" };
        if (!source.enabled) return { kind: "dropped", reason: "source_off" };
        if (!(VK_PROCESSED_EVENTS as readonly string[]).includes(event.type)) {
          return { kind: "dropped", reason: "other_event_type" };
        }
        const groupId = event.groupId;
        let written: VkWriteOutcome;
        if (event.type === "wall_post_new") {
          const post = VkWallPostSchema.safeParse(event.object);
          if (!post.success) return { kind: "dropped", reason: "malformed" };
          written = await this.writePost(tx, source, groupId, post.data, "keep");
        } else {
          const video = VkVideoSchema.safeParse(event.object);
          if (!video.success) return { kind: "dropped", reason: "malformed" };
          written = await this.writeVideo(tx, source, groupId, video.data);
        }
        if (written.kind === "duplicate") return written;
        // EARS-44 — the Callback works: an event of this community arrived.
        await this.sources.markVkEvent(tx, source.id);
        if (written.kind === "dropped") return written;
        return { kind: "written", entryId: written.entryId };
      },
    );
    if (outcome.kind === "dropped") this.logDrop(event, outcome.reason);
    return outcome;
  }

  /**
   * EARS-41, EARS-43 — write one wall post of a locked source. A post that
   * already has an entry is kept (`keep`: the Callback, the import) or
   * rewritten in place with its date, hide and switched-off mark kept and its
   * removed mark cleared (`rewrite`: the reconcile, EARS-45).
   */
  async writePost(
    tx: MaterialsTx,
    source: FeedSource,
    groupId: number,
    post: VkWallPost,
    held: HeldPolicy,
  ): Promise<VkWriteOutcome> {
    const mapped = mapWallPost(post, groupId);
    if ("dropped" in mapped) return { kind: "dropped", reason: mapped.dropped };
    const card = mapped.card;
    const existing = await this.entries.vkEntryByObject(
      tx,
      source.id,
      "post",
      card.postId,
    );
    if (existing) {
      if (held === "keep") return { kind: "duplicate" };
      const changed =
        existing.title !== card.title ||
        existing.imageUrl !== card.imageUrl ||
        existing.durationSeconds !== card.durationSeconds;
      if (changed) {
        await this.entries.updateVkEntry(tx, existing.id, {
          title: card.title,
          imageUrl: card.imageUrl,
          durationSeconds: card.durationSeconds,
        });
      }
      if (existing.removedAt !== null) {
        await this.entries.setVkRemoved(tx, [existing.id], false);
      }
      await this.absorbVideos(tx, source, card, existing.id, existing.hiddenAt);
      return { kind: "updated", entryId: existing.id };
    }
    const entryId = await this.entries.insertVkEntry(tx, {
      feedSourceId: source.id,
      kind: "post",
      sourceRef: `${source.id}:post:${card.postId}`,
      title: card.title,
      imageUrl: card.imageUrl,
      durationSeconds: card.durationSeconds,
      sourceName: VK_POST_SOURCE_NAME,
      href: card.href,
      publishedAt: card.publishedAt,
      sourceOff: !source.enabled,
    });
    await this.entries.attachVkObject(
      tx,
      source.id,
      "post",
      card.postId,
      entryId,
    );
    await this.absorbVideos(tx, source, card, entryId, null);
    return { kind: "written", entryId };
  }

  /**
   * EARS-42, EARS-43 — write one `video_new` of a locked source; a video
   * already held (as a `video` entry or as an attachment of a post entry)
   * writes nothing.
   */
  async writeVideo(
    tx: MaterialsTx,
    source: FeedSource,
    groupId: number,
    video: Parameters<typeof mapVideo>[0],
  ): Promise<VkWriteOutcome> {
    const mapped = mapVideo(video, groupId);
    if ("dropped" in mapped) return { kind: "dropped", reason: mapped.dropped };
    const card = mapped.card;
    const held = await this.entries.vkEntryByObject(
      tx,
      source.id,
      "video",
      card.videoId,
    );
    if (held) return { kind: "duplicate" };
    const entryId = await this.entries.insertVkEntry(tx, {
      feedSourceId: source.id,
      kind: "video",
      sourceRef: `${source.id}:video:${card.videoId}`,
      title: card.title,
      imageUrl: card.imageUrl,
      durationSeconds: card.durationSeconds,
      sourceName: VK_VIDEO_SOURCE_NAME,
      href: card.href,
      publishedAt: card.publishedAt,
      sourceOff: !source.enabled,
    });
    await this.entries.attachVkObject(
      tx,
      source.id,
      "video",
      card.videoId,
      entryId,
    );
    return { kind: "written", entryId };
  }

  /**
   * EARS-43 — key every own-community video attached to the post to its
   * entry; a video held as a `video` entry is folded into the post, which
   * takes the video's hide when it has none.
   */
  private async absorbVideos(
    tx: MaterialsTx,
    source: FeedSource,
    card: VkPostCard,
    postEntryId: string,
    postHiddenAt: Date | null,
  ): Promise<void> {
    let hiddenAt = postHiddenAt;
    for (const videoId of card.videoIds) {
      const held = await this.entries.vkEntryByObject(
        tx,
        source.id,
        "video",
        videoId,
      );
      if (!held) {
        await this.entries.attachVkObject(
          tx,
          source.id,
          "video",
          videoId,
          postEntryId,
        );
        continue;
      }
      // Held by a post (this one or another): one card already shows it.
      if (held.kind !== "video") continue;
      await this.entries.absorbVkVideoEntry(tx, held.id, postEntryId);
      if (hiddenAt === null && held.hiddenAt !== null) {
        hiddenAt = held.hiddenAt;
        await this.entries.updateVkEntry(tx, postEntryId, { hiddenAt });
      }
    }
  }

  /** EARS-40 — the drop line: ids, type, retry counter and reason only. */
  private logDrop(event: VkCallbackEvent, reason: VkEventDropReason): void {
    this.logger.log(
      JSON.stringify({
        event: "vk_event_dropped",
        eventId: event.eventId,
        type: event.type,
        groupId: event.groupId,
        objectId: objectIdOf(event.object),
        retryCounter: event.retryCounter,
        reason,
      }),
    );
  }
}

/** The VK object id of an event's object, when it carries a numeric one. */
export function objectIdOf(object: unknown): number | null {
  if (typeof object !== "object" || object === null) return null;
  const id = (object as { id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}
