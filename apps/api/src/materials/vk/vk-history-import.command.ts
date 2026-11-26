import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  FEED_VK_MONTHLY_CALL_WARN,
  normalizeVkSourceAddress,
} from "@ds/schemas";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import {
  VK_API,
  VK_WALL_PAGE,
  VkWallPostSchema,
  type VkApi,
} from "./vk-api.types.js";
import { VkCallMonthsRepository } from "./vk-call-months.repository.js";
import { VK_CONFIG, type VkConfig } from "./vk-config.js";
import { VkFeedSource } from "./vk.feed-source.js";

// 048 EARS-46 (#4005) — the one-off import of a VK community's wall history
// (048-design «One-off history import (EARS-46)»). A source that is not a
// listed VK source, has no bound community id, or a server with VK switched
// off is refused before any call, with nothing written. Otherwise the wall is
// read by `wall.get` pages of 100 (`owner_id` = −group id, `filter` = owner,
// `offset` 0, 100, …) until a short page, and each post is written through
// the connector's own writer (`VkFeedSource.writePost`, EARS-41 mapping +
// EARS-43 dedup on `feed_entry_vk_objects`) in its own transaction under the
// source's row lock, with the `keep` policy: a post already held — a re-run,
// a Callback-delivered post, a hidden entry — is skipped, never overwritten.
// Before each page the month's call count is read: the import stops, keeping
// what it wrote, before a call would take it past 8 000 (EARS-44's warning
// line), so the reconcile and the check keep their budget; a re-run next
// month completes the wall. Standalone videos are not imported (`video.get`
// is gated — the known limit). Logs carry ids and counts only, never a text
// (EARS-51).

export const VK_UNBOUND_SOURCE_REASON =
  "the source has no bound VK community id; run the source check (EARS-44)";

export const VK_CALL_BUDGET_REASON = `the month's VK calls would pass ${FEED_VK_MONTHLY_CALL_WARN}; run the import again next month`;

export const VK_NOT_CONFIGURED_REASON =
  "VK is not configured on the server (VK_SERVICE_KEY, VK_CALLBACK_SECRET, VK_CALLBACK_CONFIRMATION)";

export const VK_SOURCE_CHANGED_REASON =
  "the source was deleted or re-addressed to another community during the import";

export interface VkHistoryImportReport {
  /** Wall items read (every item of every page, pinned and invalid included). */
  read: number;
  written: number;
  skippedExisting: number;
  dropped: Record<string, number>;
  /** `wall.get` calls this run made. */
  callsUsed: number;
  /** Why the run stopped before the end of the wall, or null when it read it all. */
  stopped: string | null;
}

/** A refused run: nothing was written; the reason is printed to the operator. */
export class VkHistoryImportRefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "VkHistoryImportRefusedError";
  }
}

@Injectable()
export class VkHistoryImport {
  private readonly logger = new Logger("VkHistoryImport");

  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(VK_CONFIG) private readonly config: VkConfig | null,
    @Inject(VK_API) private readonly vk: VkApi,
    @Inject(VkCallMonthsRepository)
    private readonly calls: VkCallMonthsRepository,
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
    @Inject(VkFeedSource) private readonly feed: VkFeedSource,
  ) {}

  async run(args: { source: string }): Promise<VkHistoryImportReport> {
    const address = normalizeVkSourceAddress(args.source);
    if (address === null) {
      throw new VkHistoryImportRefusedError(
        `not a VK community address: ${args.source}`,
      );
    }
    const source = await this.sources.findVkByAddress(address);
    if (!source) {
      throw new VkHistoryImportRefusedError(
        `no VK source vk.com/${address} is listed`,
      );
    }
    const groupId = source.vkGroupId;
    if (groupId === null) {
      throw new VkHistoryImportRefusedError(VK_UNBOUND_SOURCE_REASON);
    }
    if (this.config === null) {
      throw new VkHistoryImportRefusedError(VK_NOT_CONFIGURED_REASON);
    }

    const report: VkHistoryImportReport = {
      read: 0,
      written: 0,
      skippedExisting: 0,
      dropped: {},
      callsUsed: 0,
      stopped: null,
    };
    const drop = (reason: string) => {
      report.dropped[reason] = (report.dropped[reason] ?? 0) + 1;
    };
    for (let offset = 0; ; offset += VK_WALL_PAGE) {
      // EARS-46 — stop before this call would take the month past 8 000.
      if ((await this.calls.thisMonth()) + 1 > FEED_VK_MONTHLY_CALL_WARN) {
        report.stopped = VK_CALL_BUDGET_REASON;
        break;
      }
      report.callsUsed += 1;
      const page = await this.vk.wallGet({
        owner_id: -groupId,
        filter: "owner",
        count: VK_WALL_PAGE,
        offset,
      });
      report.read += page.items.length;
      for (const item of page.items) {
        const post = VkWallPostSchema.safeParse(item);
        if (!post.success) {
          drop("malformed");
          continue;
        }
        const outcome = await this.sources.transaction(async (tx) => {
          const locked = await this.sources.lockById(tx, source.id);
          if (
            !locked ||
            locked.platform !== "vk" ||
            locked.vkGroupId !== groupId
          ) {
            throw new Error(VK_SOURCE_CHANGED_REASON);
          }
          return this.feed.writePost(tx, locked, groupId, post.data, "keep");
        });
        if (outcome.kind === "written") report.written += 1;
        else if (outcome.kind === "dropped") drop(outcome.reason);
        else report.skippedExisting += 1;
      }
      if (
        page.items.length < VK_WALL_PAGE ||
        offset + VK_WALL_PAGE >= page.count
      ) {
        break;
      }
    }
    this.logger.log(
      JSON.stringify({
        event: "vk_history_imported",
        sourceId: source.id,
        groupId,
        ...report,
      }),
    );
    return report;
  }
}
