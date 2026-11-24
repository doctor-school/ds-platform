import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { FeedEntriesRepository } from "../feed-entries.repository.js";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import {
  VK_API,
  VK_WALL_PAGE,
  VkApiError,
  VkWallPostSchema,
  type VkApi,
  type VkWallPost,
} from "./vk-api.types.js";
import { VK_CONFIG, type VkConfig } from "./vk-config.js";
import { objectIdOf, VkFeedSource } from "./vk.feed-source.js";

// 048 EARS-45 (#4004) — the hourly wall reconcile (048-design «Reconcile
// (EARS-45)»). VK sends no edit or delete event, so once an hour each
// switched-on, bound VK source reads its newest wall page through `wall.get`
// (`owner_id` = −group id, `filter` = owner, `count` = 100) and, in ONE
// transaction under the source's row lock: rewrites a held post whose text,
// preview or duration changed (keeping its date, hide and switched-off mark),
// writes a post the Callback missed, marks «Удалён в VK» a held post dated
// inside the span of the returned non-pinned posts (the whole wall when it
// returned fewer than 100) and absent from them, and clears the mark of a
// post returned again. A VK error or timeout changes nothing — the source
// check reports it. A `video` entry is never reconciled (`video.get` is
// gated — a known limit).

export interface VkReconcileOutcome {
  read: number;
  written: number;
  updated: number;
  removed: number;
}

@Injectable()
export class VkWallReconcile {
  private readonly logger = new Logger("VkWallReconcile");

  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(VK_CONFIG) private readonly config: VkConfig | null,
    @Inject(VK_API) private readonly vk: VkApi,
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
    @Inject(FeedEntriesRepository)
    private readonly entries: FeedEntriesRepository,
    @Inject(VkFeedSource) private readonly feed: VkFeedSource,
  ) {}

  /** EARS-45 — the hourly reconcile of every switched-on, bound VK source. */
  @Cron(CronExpression.EVERY_HOUR)
  async reconcileAll(): Promise<void> {
    if (this.config === null) return;
    try {
      const ids = await this.sources.enabledVkSourceIds();
      for (const id of ids) await this.reconcile(id);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "vk_reconcile_run_failed",
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }

  /**
   * EARS-45 — reconcile one source. Undefined when the source is not a
   * switched-on, bound VK source, when VK failed (nothing changed) or when
   * the write failed (rolled back). Never throws.
   */
  async reconcile(id: string): Promise<VkReconcileOutcome | undefined> {
    if (this.config === null) return undefined;
    try {
      const source = await this.sources.findById(id);
      const groupId = source?.vkGroupId ?? null;
      if (!source || source.platform !== "vk" || !source.enabled) {
        return undefined;
      }
      if (groupId === null) return undefined;
      let page;
      try {
        page = await this.vk.wallGet({
          owner_id: -groupId,
          filter: "owner",
          count: VK_WALL_PAGE,
        });
      } catch (error) {
        if (!(error instanceof VkApiError)) throw error;
        // EARS-45 — nothing changes; the call's own line is already logged.
        return undefined;
      }
      const posts: VkWallPost[] = [];
      let invalid = 0;
      for (const item of page.items) {
        const parsed = VkWallPostSchema.safeParse(item);
        if (parsed.success) posts.push(parsed.data);
        else invalid += 1;
      }
      const outcome = await this.sources.transaction(async (tx) => {
        // Switched off, or re-addressed (unbound / rebound) meanwhile: skip.
        const locked = await this.sources.lockEnabledVkSource(tx, source.id);
        if (!locked || locked.vkGroupId !== groupId) return undefined;
        const result: VkReconcileOutcome = {
          read: posts.length,
          written: 0,
          updated: 0,
          removed: 0,
        };
        for (const post of posts) {
          const w = await this.feed.writePost(
            tx,
            locked,
            groupId,
            post,
            "rewrite",
          );
          if (w.kind === "written") result.written += 1;
          else if (w.kind === "updated") result.updated += 1;
        }
        // The span the page vouches for: the whole wall below a full page,
        // else from its oldest non-pinned post on.
        const unpinned = posts.filter((p) => p.is_pinned !== true);
        const whole = page.items.length < VK_WALL_PAGE;
        if (!whole && unpinned.length === 0) return result;
        const since = whole
          ? null
          : new Date(Math.min(...unpinned.map((p) => p.date)) * 1000);
        // An item that did not validate still counts as present by its id.
        const returned = new Set(page.items.map(objectIdOf));
        const held = await this.entries.vkHeldPosts(tx, locked.id, since);
        const gone = held
          .filter((h) => h.removedAt === null && !returned.has(h.postId))
          .map((h) => h.entryId);
        await this.entries.setVkRemoved(tx, gone, true);
        result.removed = gone.length;
        return result;
      });
      this.logger.log(
        JSON.stringify({
          event: "vk_reconciled",
          sourceId: source.id,
          applied: outcome !== undefined,
          invalid,
          ...(outcome ?? {}),
        }),
      );
      return outcome;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "vk_reconcile_failed",
          sourceId: id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      return undefined;
    }
  }
}
