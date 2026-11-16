import { Inject, Injectable, Logger } from "@nestjs/common";
import type { FeedSource } from "@ds/db";
import {
  FeedEntriesRepository,
  type TelegramEntryPatch,
  type TelegramEntryRow,
} from "../feed-entries.repository.js";
import type { MaterialsTx } from "../materials.repository.js";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import {
  mapChannelPost,
  telegramPermalink,
  type TelegramCard,
  type TelegramDropReason,
} from "./telegram-post-mapping.js";
import { TelegramUpdateSchema } from "./telegram-update.schema.js";

// 048 slice 2 (#3994) — the Telegram feed source: the ONLY writer of Telegram
// rows of `feed_entries` (048-design §Placement (slice 2)), through
// `feed-entries.repository.ts`. One webhook update is one transaction: the
// source is matched and locked (EARS-25, so a «Выключить» never interleaves),
// its Telegram id bound on the first match, the post mapped (EARS-26) and the
// entry written with the album and edit rules (EARS-27, EARS-28). A database
// failure rolls the whole update back — nothing partial — and the controller
// answers 500 so Telegram delivers it again; every write is idempotent on
// `feed_entry_messages`, so a re-delivery changes nothing.

/** The card's source line (048 Lead decision 7). */
export const TELEGRAM_SOURCE_NAME = "BBM Academy · Telegram";

export type TelegramUpdateDropReason =
  | TelegramDropReason
  | "malformed"
  | "other_update_type"
  | "not_a_channel"
  | "unlisted"
  | "source_off";

export type TelegramReceiveOutcome =
  | { kind: "dropped"; reason: TelegramUpdateDropReason }
  | { kind: "duplicate" }
  | {
      kind: "written";
      entryId: string;
      /**
       * EARS-29 — the entry holds `preview_state = 'pending'` and the
       * `preview_file_id` to copy; `TelegramPreviewService` copies it after
       * the commit.
       */
      previewPending: boolean;
    };

interface WriteResult {
  entryId: string | null;
  previewPending: boolean;
}

@Injectable()
export class TelegramFeedSource {
  private readonly logger = new Logger("TelegramWebhook");

  constructor(
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
    @Inject(FeedEntriesRepository)
    private readonly entries: FeedEntriesRepository,
  ) {}

  /** EARS-25…EARS-28 — process one authenticated webhook body. */
  async receive(body: unknown): Promise<TelegramReceiveOutcome> {
    const parsed = TelegramUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return this.drop(updateIdOf(body), null, null, "malformed");
    }
    const update = parsed.data;
    const post = update.channel_post ?? update.edited_channel_post;
    if (!post) {
      return this.drop(update.update_id, null, null, "other_update_type");
    }
    const isEdit = update.channel_post === undefined;
    const ids = [update.update_id, post.chat.id, post.message_id] as const;
    if (post.chat.type !== "channel") return this.drop(...ids, "not_a_channel");

    const result = await this.sources.transaction(
      async (tx): Promise<TelegramUpdateDropReason | WriteResult> => {
        const source = await this.sources.lockTelegramSourceForChat(
          tx,
          post.chat.id,
          post.chat.username ?? null,
        );
        if (!source) return "unlisted";
        if (!source.enabled) return "source_off";
        if (source.telegramChatId === null) {
          await this.sources.bindTelegramChatId(tx, source.id, post.chat.id);
        }
        const mapped = mapChannelPost(post);
        if (mapped.kind === "drop") return mapped.reason;
        return this.write(tx, source, mapped.card, isEdit);
      },
    );
    if (typeof result === "string") return this.drop(...ids, result);
    if (result.entryId === null) return { kind: "duplicate" };
    return {
      kind: "written",
      entryId: result.entryId,
      previewPending: result.previewPending,
    };
  }

  private async write(
    tx: MaterialsTx,
    source: FeedSource,
    card: TelegramCard,
    isEdit: boolean,
  ): Promise<WriteResult> {
    const known = await this.entries.telegramEntryByMessage(
      tx,
      source.id,
      card.messageId,
    );
    if (known) {
      // EARS-25 — a repeated delivery changes nothing; EARS-28 — an edit
      // rewrites in place.
      if (!isEdit) return { entryId: null, previewPending: false };
      return this.applyEdit(tx, known, card);
    }
    // EARS-27 — a further part of a known album joins its entry. An edit of
    // a post with no entry is processed as a new post (EARS-28).
    const album = card.mediaGroupId
      ? await this.entries.telegramEntryByMediaGroup(
          tx,
          source.id,
          card.mediaGroupId,
        )
      : undefined;
    if (album) return this.attachPart(tx, source, album, card);

    const entryId = await this.entries.insertTelegramEntry(tx, {
      feedSourceId: source.id,
      sourceRef: `${source.id}:${card.messageId}`,
      title: card.text,
      sourceName: TELEGRAM_SOURCE_NAME,
      href: telegramPermalink(source.address, card.messageId),
      publishedAt: card.publishedAt,
      mediaGroupId: card.mediaGroupId,
      durationSeconds: card.durationSeconds,
      previewFileId: card.preview?.fileId ?? null,
      previewFileUniqueId: card.preview?.fileUniqueId ?? null,
      previewState: card.preview ? "pending" : null,
    });
    await this.entries.attachTelegramMessage(
      tx,
      source.id,
      card.messageId,
      entryId,
    );
    return { entryId, previewPending: card.preview !== null };
  }

  /**
   * EARS-28 — rewrite the text (an album's from its captioned part) and,
   * when the part that gives the preview changed its medium, the preview;
   * `published_at`, `hidden_at` and `source_off` are never touched.
   */
  private async applyEdit(
    tx: MaterialsTx,
    entry: TelegramEntryRow,
    card: TelegramCard,
  ): Promise<WriteResult> {
    const patch: TelegramEntryPatch = {};
    if (card.mediaGroupId === null || card.text !== "") patch.title = card.text;
    const smallest = await this.entries.smallestTelegramMessageId(tx, entry.id);
    let previewPending = false;
    if (smallest === card.messageId) {
      patch.durationSeconds = card.durationSeconds;
      if (
        card.preview &&
        card.preview.fileUniqueId !== entry.previewFileUniqueId
      ) {
        Object.assign(patch, previewPatch(card));
        previewPending = true;
      }
    }
    await this.entries.updateTelegramEntry(tx, entry.id, patch);
    return { entryId: entry.id, previewPending };
  }

  /**
   * EARS-27 — attach an album part: the text from the part that carries a
   * caption; the preview, duration and permalink from the smallest message
   * id; the date the earliest of the parts.
   */
  private async attachPart(
    tx: MaterialsTx,
    source: FeedSource,
    album: TelegramEntryRow,
    card: TelegramCard,
  ): Promise<WriteResult> {
    await this.entries.attachTelegramMessage(
      tx,
      source.id,
      card.messageId,
      album.id,
    );
    const patch: TelegramEntryPatch = {};
    if (album.title === "" && card.text !== "") patch.title = card.text;
    if (card.publishedAt < album.publishedAt)
      patch.publishedAt = card.publishedAt;
    const smallest = await this.entries.smallestTelegramMessageId(tx, album.id);
    let previewPending = false;
    if (smallest === card.messageId) {
      patch.sourceRef = `${source.id}:${card.messageId}`;
      patch.href = telegramPermalink(source.address, card.messageId);
      patch.durationSeconds = card.durationSeconds;
      Object.assign(patch, previewPatch(card));
      previewPending = card.preview !== null;
    }
    await this.entries.updateTelegramEntry(tx, album.id, patch);
    return { entryId: album.id, previewPending };
  }

  /**
   * EARS-25 / EARS-36 — the drop line carries the update id, channel id,
   * message id and reason only: never the text, the author or the payload.
   */
  private drop(
    updateId: number | null,
    chatId: number | null,
    messageId: number | null,
    reason: TelegramUpdateDropReason,
  ): TelegramReceiveOutcome {
    this.logger.log(
      JSON.stringify({
        event: "telegram_update_dropped",
        updateId,
        chatId,
        messageId,
        reason,
      }),
    );
    return { kind: "dropped", reason };
  }
}

/** A new preview candidate awaits its copy (EARS-29); none clears the ids. */
function previewPatch(card: TelegramCard): TelegramEntryPatch {
  return {
    previewFileId: card.preview?.fileId ?? null,
    previewFileUniqueId: card.preview?.fileUniqueId ?? null,
    previewState: card.preview ? "pending" : null,
    previewAttempts: 0,
  };
}

/** The `update_id` of a body, when it has a usable one (for log lines). */
export function updateIdOf(body: unknown): number | null {
  const id =
    typeof body === "object" && body !== null
      ? (body as { update_id?: unknown }).update_id
      : undefined;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}
