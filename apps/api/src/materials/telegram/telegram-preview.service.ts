import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  OBJECT_STORAGE,
  ObjectAlreadyExistsError,
  type ObjectStorage,
} from "../../storage/index.js";
import {
  MediaCleanupService,
  StillImageNormalizer,
} from "../../taxonomy/index.js";
import {
  FeedEntriesRepository,
  PREVIEW_MAX_ATTEMPTS,
  type TelegramPreviewRow,
} from "../feed-entries.repository.js";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import {
  FilePathSchema,
  TELEGRAM_BOT_API,
  TELEGRAM_FILE_MAX_BYTES,
  TelegramBotApiError,
  type TelegramBotApi,
} from "./telegram-bot-api.types.js";
import { TELEGRAM_CONFIG, type TelegramConfig } from "./telegram-config.js";

// 048 EARS-29 (#3994) — the copy of a Telegram post's preview into OUR object
// storage (048-design «Preview (EARS-29)»). The webhook writes the entry with
// `preview_state = 'pending'` and the chosen medium's `file_id` (the mapping
// picks the photo size or the video thumbnail); this service, AFTER that
// transaction has committed, fetches the file through `getFile` and its
// download link (a fresh `getFile` every attempt — the link lives about an
// hour, the `file_id` stays valid), refuses a file over 20 MB, normalizes it
// with the 012 still-image normalizer and stores the canonical WebP under a
// server-generated key. Only that key reaches the row (`image_ref`, signed at
// the read like an own cover) — never a Telegram file link.
//
// A failure counts the attempt and leaves the entry in the feed without an
// image; the `@Cron` below retries every 10 minutes with the backoff of
// `previewRetryDelayMinutes` until the attempts span 24 hours, then sets
// `failed` — the card keeps its no-image layout. A preview is a per-post
// matter: nothing here touches the source's status (Lead decision 12). The
// service never throws: the webhook's answer never depends on it.

/** The object-storage prefix of copied network-post previews. */
export const FEED_PREVIEW_PREFIX = "feed-previews";

/** How many due previews one scheduled run retries. */
const RETRY_BATCH = 50;

export type PreviewCopyOutcome =
  "done" | "retry" | "failed" | "skipped" | "superseded";

@Injectable()
export class TelegramPreviewService {
  private readonly logger = new Logger("TelegramPreview");

  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(TELEGRAM_CONFIG) private readonly config: TelegramConfig | null,
    @Inject(TELEGRAM_BOT_API) private readonly telegram: TelegramBotApi,
    @Inject(FeedEntriesRepository)
    private readonly entries: FeedEntriesRepository,
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
    @Inject(StillImageNormalizer)
    private readonly normalizer: StillImageNormalizer,
    @Inject(MediaCleanupService) private readonly cleanup: MediaCleanupService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** EARS-29 — one attempt at an entry's pending preview. Never throws. */
  async copy(entryId: string): Promise<PreviewCopyOutcome> {
    try {
      return await this.attempt(entryId);
    } catch (error) {
      // A database failure while settling: the row stays `pending` with its
      // count, so the schedule picks it up again.
      this.log("telegram_preview_error", entryId, errorName(error));
      return "retry";
    }
  }

  /** EARS-29 — the scheduled retry of every due pending preview. */
  @Cron("*/10 * * * *")
  async retryDue(): Promise<void> {
    try {
      if (this.config === null) return; // the kill switch: no Bot API call
      const ids = await this.entries.duePreviewIds(RETRY_BATCH);
      for (const id of ids) await this.copy(id);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "telegram_preview_retry_failed",
          error: errorName(error),
        }),
      );
    }
  }

  private async attempt(entryId: string): Promise<PreviewCopyOutcome> {
    if (this.config === null) return "skipped";
    const row = await this.entries.telegramPreview(entryId);
    if (
      !row ||
      row.previewState !== "pending" ||
      !row.previewFileId ||
      !row.previewFileUniqueId
    ) {
      return "skipped";
    }
    let key: string;
    try {
      key = await this.fetchAndStore(row.id, row.previewFileId);
    } catch (error) {
      return this.countFailure(row, error);
    }
    return this.settleDone(row, row.previewFileUniqueId, key);
  }

  /** `getFile` → size bound → download → normalize → PUT; returns the key. */
  private async fetchAndStore(
    entryId: string,
    fileId: string,
  ): Promise<string> {
    const file = await this.telegram.getFile(fileId);
    if (
      file.file_size !== undefined &&
      file.file_size > TELEGRAM_FILE_MAX_BYTES
    ) {
      throw new PreviewRefusedError("too_large");
    }
    const path = FilePathSchema.safeParse(file.file_path);
    if (!path.success) throw new PreviewRefusedError("no_file_path");
    const body = await this.telegram.downloadFile(
      path.data,
      TELEGRAM_FILE_MAX_BYTES,
    );
    const contentType = sniffImageType(body);
    if (contentType === null) throw new PreviewRefusedError("not_an_image");
    const normalized = await this.normalizer.normalize({
      fieldname: "preview",
      filename: "preview",
      contentType,
      body,
    });
    const key = `${FEED_PREVIEW_PREFIX}/${entryId}/${normalized.canonicalSha256}.webp`;
    try {
      await this.storage.put({
        key,
        body: normalized.body,
        contentType: normalized.contentType,
        onlyIfAbsent: true,
      });
    } catch (error) {
      // The same canonical bytes already stored under this entry: reuse them.
      if (!(error instanceof ObjectAlreadyExistsError)) throw error;
    }
    return key;
  }

  /**
   * Set the copy when the entry still waits on the medium it was fetched
   * from. The replaced copy, or this one when an edit moved the entry on
   * meanwhile, becomes a 012 cleanup obligation in the same transaction.
   */
  private async settleDone(
    row: TelegramPreviewRow,
    fileUniqueId: string,
    key: string,
  ): Promise<PreviewCopyOutcome> {
    const outcome = await this.sources.transaction(async (tx) => {
      const locked = await this.entries.lockPendingPreview(
        tx,
        row.id,
        fileUniqueId,
      );
      if (!locked) {
        // An edit moved the entry on (or a concurrent copy settled it): this
        // copy is released unless the row already holds the same bytes.
        const current = await this.entries.telegramPreview(row.id, tx);
        if (current?.imageRef !== key) {
          await this.releaseKey(tx, row.id, key, "clear");
        }
        return "superseded" as const;
      }
      await this.entries.settlePreview(tx, row.id, {
        imageRef: key,
        previewState: "done",
      });
      if (locked.imageRef && locked.imageRef !== key) {
        await this.releaseKey(tx, row.id, locked.imageRef, "replace");
      }
      return "done" as const;
    });
    this.log(
      outcome === "done"
        ? "telegram_preview_copied"
        : "telegram_preview_superseded",
      row.id,
      null,
      row.previewAttempts + 1,
    );
    return outcome;
  }

  private async releaseKey(
    tx: Parameters<Parameters<FeedSourcesRepository["transaction"]>[0]>[0],
    entryId: string,
    objectKey: string,
    cleanupKind: "replace" | "clear",
  ): Promise<void> {
    await this.cleanup.enqueue(tx, {
      cleanupKind,
      entityKind: "feed_entry",
      entityId: entryId,
      slot: "cover",
      objectKey,
    });
  }

  /** Count a failed attempt; the last one sets `failed` (no-image card). */
  private async countFailure(
    row: TelegramPreviewRow,
    error: unknown,
  ): Promise<PreviewCopyOutcome> {
    const attempts = row.previewAttempts + 1;
    const final = attempts >= PREVIEW_MAX_ATTEMPTS;
    const settled = await this.sources.transaction(async (tx) => {
      const locked = await this.entries.lockPendingPreview(
        tx,
        row.id,
        row.previewFileUniqueId!,
      );
      if (!locked) return false;
      await this.entries.settlePreview(tx, row.id, {
        previewAttempts: attempts,
        previewState: final ? "failed" : "pending",
      });
      return true;
    });
    this.log(
      "telegram_preview_failed",
      row.id,
      failureReason(error),
      attempts,
      final,
    );
    if (!settled) return "superseded";
    return final ? "failed" : "retry";
  }

  /** EARS-36 — entry id, reason and attempt only: no link, token or payload. */
  private log(
    event: string,
    entryId: string,
    reason: string | null,
    attempt?: number,
    final?: boolean,
  ): void {
    this.logger.log(
      JSON.stringify({
        event,
        entryId,
        ...(reason === null ? {} : { reason }),
        ...(attempt === undefined ? {} : { attempt }),
        ...(final === undefined ? {} : { final }),
      }),
    );
  }
}

/** A preview this service refuses before or after the download. */
class PreviewRefusedError extends Error {
  constructor(readonly reason: "too_large" | "no_file_path" | "not_an_image") {
    super(`preview refused: ${reason}`);
    this.name = "PreviewRefusedError";
  }
}

/** The container type by magic bytes — the download carries no declared type. */
export function sniffImageType(body: Buffer): string | null {
  if (
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    body.length >= 8 &&
    body
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    body.length >= 12 &&
    body.subarray(0, 4).toString("latin1") === "RIFF" &&
    body.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function failureReason(error: unknown): string {
  if (error instanceof PreviewRefusedError) return error.reason;
  if (error instanceof TelegramBotApiError) {
    return `${error.method}:${error.outcome}`;
  }
  return errorName(error);
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${error.name}:${code}` : error.name;
  }
  return "unknown";
}
