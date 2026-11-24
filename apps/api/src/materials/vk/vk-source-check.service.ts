import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { FeedSource } from "@ds/db";
import { FEED_VK_MONTHLY_CALL_WARN, vkAddressGroupId } from "@ds/schemas";
import { FeedEntriesRepository } from "../feed-entries.repository.js";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import {
  VK_API,
  VK_AUTH_FAILED,
  VkApiError,
  vkUnreachable,
  type VkApi,
  type VkGroup,
} from "./vk-api.types.js";
import { VkCallMonthsRepository } from "./vk-call-months.repository.js";
import { VK_CONFIG, type VkConfig } from "./vk-config.js";

// 048 EARS-44 (#4004) — the VK source check (048-design «Source check
// (EARS-44)»): hourly for every switched-on VK source, and at once on add /
// address edit / switch-on (EARS-38, run by `FeedSourcesService` after its
// transaction commits). It reads the community through `groups.getById` (by
// the bound id, else the address) and writes «Работает» or «Ошибка» with ONE
// reason, in the table's order, plus the check time. While the source has no
// bound community id, a community whose `screen_name` equals the address
// ignoring case, or whose id a `club<id>` / `public<id>` address names, binds
// its id — and `vk_last_event_at` to the binding time — in the same write as
// the status, so a new source is bound before any Callback event or import.
// A check changes no entry. VK's own error goes to the log line (method,
// status, error code and outcome only — EARS-51), never to the admin.
//
// It runs at half past every hour, half an hour after the reconcile
// (`vk-wall-reconcile.service.ts`), so «VK не присылает новые записи» reads
// what the last reconcile wrote.

/** The fixed failing reasons of EARS-44 — the admin reads them verbatim. */
export const VK_SOURCE_CHECK_REASONS = {
  notConfigured: "VK не подключён на сервере",
  communityNotFound: "Сообщество не найдено",
  noEvents: "VK не присылает новые записи",
  callBudget: "Лимит вызовов VK почти исчерпан",
  unreachable: "VK недоступен",
} as const;

/** «Адрес сообщества изменился на vk.com/<имя>». */
export function vkAddressChangedReason(screenName: string): string {
  return `Адрес сообщества изменился на vk.com/${screenName}`;
}

export interface VkSourceCheckVerdict {
  status: "ok" | "failing";
  statusReason: string | null;
  bindGroupId: number | null;
}

/** What `groups.getById` says about a source's community. */
export type VkCommunityLookup =
  | { kind: "found"; group: VkGroup }
  | { kind: "not_found" }
  | { kind: "not_configured" }
  | { kind: "unreachable" };

const failing = (
  statusReason: string,
  bindGroupId: number | null = null,
): VkSourceCheckVerdict => ({ status: "failing", statusReason, bindGroupId });

/** Whether the community answers to the address (EARS-44 binding rule). */
export function vkCommunityMatches(group: VkGroup, address: string): boolean {
  return (
    group.screen_name?.toLowerCase() === address ||
    vkAddressGroupId(address) === group.id
  );
}

@Injectable()
export class VkSourceCheck {
  private readonly logger = new Logger("VkSourceCheck");

  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(VK_CONFIG) private readonly config: VkConfig | null,
    @Inject(VK_API) private readonly vk: VkApi,
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
    @Inject(FeedEntriesRepository)
    private readonly entries: FeedEntriesRepository,
    @Inject(VkCallMonthsRepository)
    private readonly calls: VkCallMonthsRepository,
  ) {}

  /** EARS-44 — the hourly check of every switched-on VK source. */
  @Cron("0 30 * * * *")
  async checkAll(): Promise<void> {
    try {
      const ids = await this.sources.enabledVkSourceIds();
      for (const id of ids) await this.check(id);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "vk_source_check_run_failed",
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }

  /**
   * EARS-38 / EARS-44 — check one source and write the verdict. Returns the
   * written row, or undefined when the source is not a switched-on VK source
   * (or changed while it was checked). Never throws.
   */
  async check(id: string): Promise<FeedSource | undefined> {
    try {
      const source = await this.sources.findById(id);
      if (!source || source.platform !== "vk" || !source.enabled) {
        return undefined;
      }
      const verdict = await this.judge(source);
      const row = await this.sources.transaction((tx) =>
        this.sources.writeVkCheck(
          tx,
          source.id,
          source.address,
          { ...verdict, checkedAt: new Date() },
          source.vkGroupId,
        ),
      );
      this.logger.log(
        JSON.stringify({
          event: "vk_source_checked",
          sourceId: source.id,
          status: verdict.status,
          bound: verdict.bindGroupId !== null,
          applied: row !== undefined,
        }),
      );
      return row;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "vk_source_check_failed",
          sourceId: id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      return undefined;
    }
  }

  /**
   * EARS-38 — read a community by its bound id or its address. A refusal of
   * VK's is «not found», except its «authorization failed» (the service key
   * is not accepted), which is the connector not being configured.
   */
  async lookup(
    ref: number | string,
    sourceId: string | null,
  ): Promise<VkCommunityLookup> {
    if (this.config === null) return { kind: "not_configured" };
    try {
      const [group] = await this.vk.groupsGetById(ref);
      if (!group || group.deactivated !== undefined) {
        return { kind: "not_found" };
      }
      return { kind: "found", group };
    } catch (error) {
      if (!(error instanceof VkApiError)) throw error;
      this.note(sourceId, error);
      if (vkUnreachable(error)) return { kind: "unreachable" };
      if (error.errorCode === VK_AUTH_FAILED) return { kind: "not_configured" };
      return { kind: "not_found" };
    }
  }

  /** The verdict of the check table, first failing row wins. */
  private async judge(source: FeedSource): Promise<VkSourceCheckVerdict> {
    const bound = source.vkGroupId;
    const found = await this.lookup(bound ?? source.address, source.id);
    if (found.kind === "not_configured") {
      return failing(VK_SOURCE_CHECK_REASONS.notConfigured);
    }
    if (found.kind === "unreachable") {
      return failing(VK_SOURCE_CHECK_REASONS.unreachable);
    }
    if (found.kind === "not_found") {
      return failing(VK_SOURCE_CHECK_REASONS.communityNotFound);
    }
    const group = found.group;
    let bindGroupId: number | null = null;
    if (bound === null && vkCommunityMatches(group, source.address)) {
      // The add / edit refusal keeps a community on one source; a race of two
      // adds is the only way here, and the unique id leaves it unbound.
      if (await this.sources.vkGroupHeldByOther(group.id, source.id)) {
        return failing(VK_SOURCE_CHECK_REASONS.communityNotFound);
      }
      bindGroupId = group.id;
    }
    const name = group.screen_name?.toLowerCase() ?? null;
    if (name === null) {
      return failing(VK_SOURCE_CHECK_REASONS.communityNotFound, bindGroupId);
    }
    if (name !== source.address) {
      return failing(vkAddressChangedReason(name), bindGroupId);
    }
    // Before the first event the binding time stands in (the bind write sets
    // it); a source bound in this very write cannot have missed one yet.
    if (
      bindGroupId === null &&
      source.vkLastEventAt !== null &&
      (await this.entries.vkCallbackMissedPost(source.id, source.vkLastEventAt))
    ) {
      return failing(VK_SOURCE_CHECK_REASONS.noEvents);
    }
    if ((await this.calls.thisMonth()) >= FEED_VK_MONTHLY_CALL_WARN) {
      return failing(VK_SOURCE_CHECK_REASONS.callBudget, bindGroupId);
    }
    return { status: "ok", statusReason: null, bindGroupId };
  }

  /** EARS-51 — the VK API failure: method, HTTP status, error code, outcome. */
  private note(sourceId: string | null, error: VkApiError): void {
    this.logger.warn(
      JSON.stringify({
        event: "vk_source_check_call_failed",
        sourceId,
        method: error.method,
        httpStatus: error.httpStatus,
        errorCode: error.errorCode,
        outcome: error.outcome,
      }),
    );
  }
}
