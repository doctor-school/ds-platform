import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { normalizeFeedSourceAddress } from "@ds/schemas";
import { FeedEntriesRepository } from "../feed-entries.repository.js";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import { TELEGRAM_FILE_MAX_BYTES } from "./telegram-bot-api.types.js";
import { TELEGRAM_SOURCE_NAME } from "./telegram.feed-source.js";
import {
  botApiChannelId,
  mapExportMessage,
  parseTelegramExport,
  type ExportPreviewFile,
} from "./telegram-history-export.js";
import { telegramPermalink } from "./telegram-post-mapping.js";
import { TelegramPreviewService } from "./telegram-preview.service.js";

// 048 EARS-30 (#3995) — the one-off import of a Telegram channel's history
// from the Telegram Desktop JSON export (048-design «One-off history import
// (EARS-30)»). The whole file is validated first and the run refused, with
// nothing written, for a file that does not parse, is not a channel export,
// names another channel than the source's bound id, or a source with no bound
// id. Then each message, in date order, is mapped under EARS-26 (the shared
// `cardFromContent`) and written in its own transaction through
// `feed_entry_messages`: the source row is locked like the poller's (so the
// two never interleave) and a message id already held is skipped — a re-run,
// a polled post and a hidden entry are never touched. The preview
// comes from the exported file, after the entry has committed (EARS-29's
// normalize-and-store half, no Bot API call). Logs carry message ids and
// reasons only, never a text (EARS-36).

export const SOURCE_DELETED_REASON = "the source was deleted during the import";

export const UNBOUND_SOURCE_REASON =
  "the source has no bound Telegram id; run the source check (EARS-31)";

export interface HistoryImportReport {
  read: number;
  written: number;
  skippedExisting: number;
  skippedMediaNoText: number;
  dropped: Record<string, number>;
  previewsFailed: number;
}

/** A refused run: nothing was written; the reason is printed to the operator. */
export class HistoryImportRefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "HistoryImportRefusedError";
  }
}

@Injectable()
export class TelegramHistoryImport {
  private readonly logger = new Logger("TelegramHistoryImport");

  constructor(
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
    @Inject(FeedEntriesRepository)
    private readonly entries: FeedEntriesRepository,
    @Inject(TelegramPreviewService)
    private readonly previews: TelegramPreviewService,
  ) {}

  async run(args: {
    source: string;
    exportPath: string;
  }): Promise<HistoryImportReport> {
    const address = normalizeFeedSourceAddress(args.source);
    if (address === null) {
      throw new HistoryImportRefusedError(
        `not a Telegram channel address: ${args.source}`,
      );
    }
    let raw: string;
    try {
      raw = await readFile(args.exportPath, "utf8");
    } catch {
      throw new HistoryImportRefusedError(
        `the export file cannot be read: ${args.exportPath}`,
      );
    }
    const parsed = parseTelegramExport(raw);
    if (!parsed.ok) throw new HistoryImportRefusedError(parsed.reason);
    const source = await this.sources.findTelegramByAddress(address);
    if (!source) {
      throw new HistoryImportRefusedError(
        `no Telegram source t.me/${address} is listed`,
      );
    }
    if (source.telegramChatId === null) {
      throw new HistoryImportRefusedError(UNBOUND_SOURCE_REASON);
    }
    if (botApiChannelId(parsed.export.id) !== source.telegramChatId) {
      throw new HistoryImportRefusedError(
        "the export is of another channel than the source's bound Telegram id",
      );
    }

    const report: HistoryImportReport = {
      read: parsed.export.messages.length,
      written: 0,
      skippedExisting: 0,
      skippedMediaNoText: 0,
      dropped: {},
      previewsFailed: 0,
    };
    const folder = dirname(resolve(args.exportPath));
    const mapped = parsed.export.messages
      .map(mapExportMessage)
      .sort((a, b) => order(a) - order(b));
    for (const message of mapped) {
      if (message.kind === "media_no_text") {
        report.skippedMediaNoText += 1;
        continue;
      }
      if (message.kind === "drop") {
        report.dropped[message.reason] =
          (report.dropped[message.reason] ?? 0) + 1;
        continue;
      }
      const card = message.card;
      const entryId = await this.sources.transaction(async (tx) => {
        const locked = await this.sources.lockById(tx, source.id);
        if (!locked) throw new Error(SOURCE_DELETED_REASON);
        const held = await this.entries.telegramEntryByMessage(
          tx,
          source.id,
          card.messageId,
        );
        if (held) return null;
        const id = await this.entries.insertTelegramEntry(tx, {
          feedSourceId: source.id,
          sourceRef: `${source.id}:${card.messageId}`,
          title: card.text,
          sourceName: TELEGRAM_SOURCE_NAME,
          href: telegramPermalink(locked.address, card.messageId),
          publishedAt: card.publishedAt,
          mediaGroupId: null,
          durationSeconds: card.durationSeconds,
          previewFileId: null,
          previewFileUniqueId: null,
          previewState: null,
          sourceOff: !locked.enabled,
        });
        await this.entries.attachTelegramMessage(
          tx,
          source.id,
          card.messageId,
          id,
        );
        return id;
      });
      if (entryId === null) {
        report.skippedExisting += 1;
        continue;
      }
      report.written += 1;
      if (card.preview !== null) {
        const ok = await this.preview(folder, entryId, card.preview);
        if (!ok) report.previewsFailed += 1;
      }
    }
    this.logger.log(
      JSON.stringify({
        event: "telegram_history_imported",
        sourceId: source.id,
        ...report,
      }),
    );
    return report;
  }

  /** EARS-29 via EARS-30 — the preview from the exported file, if present. */
  private async preview(
    folder: string,
    entryId: string,
    file: ExportPreviewFile,
  ): Promise<boolean> {
    if (file.kind === "not_exported") {
      this.logPreviewSkip(entryId, "not_exported");
      return false;
    }
    let body: Buffer;
    try {
      // Both sides resolved through links, so a link inside the export folder
      // cannot reach a file outside it.
      const path = await realpath(resolve(folder, file.path));
      const inside = relative(await realpath(folder), path);
      if (
        inside === "" ||
        inside === ".." ||
        inside.startsWith(`..${sep}`) ||
        isAbsolute(inside)
      ) {
        this.logPreviewSkip(entryId, "outside_export");
        return false;
      }
      const info = await stat(path);
      if (!info.isFile() || info.size > TELEGRAM_FILE_MAX_BYTES) {
        this.logPreviewSkip(entryId, "too_large_or_not_a_file");
        return false;
      }
      body = await readFile(path);
    } catch {
      this.logPreviewSkip(entryId, "unreadable");
      return false;
    }
    return this.previews.storeExported(entryId, body);
  }

  private logPreviewSkip(entryId: string, reason: string): void {
    this.logger.log(
      JSON.stringify({
        event: "telegram_preview_import_failed",
        entryId,
        reason,
      }),
    );
  }
}

/**
 * Date order for a card (the sort is stable, so the export's own id order
 * breaks ties); drops and skips, which write nothing, sort first.
 */
function order(message: ReturnType<typeof mapExportMessage>): number {
  return message.kind === "card" ? message.card.publishedAt.getTime() : 0;
}
