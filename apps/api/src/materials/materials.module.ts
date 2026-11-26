import { Inject, Module, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { FastifyInstance } from "fastify";
import { feedEntries, materials } from "@ds/db";
import { MediaSlotRegistry } from "../taxonomy/index.js";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { FeedEntriesRepository } from "./feed-entries.repository.js";
import {
  FeedEntriesAdminController,
  FeedSourcesAdminController,
} from "./feed-sources.admin.controller.js";
import { FeedSourcesRepository } from "./feed-sources.repository.js";
import { FeedSourcesService } from "./feed-sources.service.js";
import { MaterialsAdminController } from "./materials.admin.controller.js";
import { MaterialsRepository } from "./materials.repository.js";
import { MaterialsService } from "./materials.service.js";
import { PublicFeedController } from "./public-feed.controller.js";
import { PublicMaterialsController } from "./public-materials.controller.js";
import { MaterialsPublicReadsService } from "./public-reads.service.js";
import { OwnMaterialsFeedSource } from "./own-materials.feed-source.js";
import { TelegramBotApiClient } from "./telegram/telegram-bot-api.client.js";
import {
  TELEGRAM_BOT_API,
  type TelegramBotApi,
} from "./telegram/telegram-bot-api.types.js";
import {
  TELEGRAM_CONFIG,
  telegramConfigFromEnv,
  type TelegramConfig,
} from "./telegram/telegram-config.js";
import { TelegramFeedSource } from "./telegram/telegram.feed-source.js";
import { TelegramHistoryImport } from "./telegram/telegram-history-import.command.js";
import { TelegramPreviewService } from "./telegram/telegram-preview.service.js";
import { TelegramSourceCheck } from "./telegram/telegram-source-check.service.js";
import { TelegramUpdateCursorRepository } from "./telegram/telegram-update-cursor.repository.js";
import { TelegramUpdatePoller } from "./telegram/telegram-update-poller.service.js";
import { VkApiClient } from "./vk/vk-api.client.js";
import { VK_API, type VkApi } from "./vk/vk-api.types.js";
import { installVkCallbackJsonParser } from "./vk/vk-callback-body.js";
import { VkCallbackController } from "./vk/vk-callback.controller.js";
import { VkCallMonthsRepository } from "./vk/vk-call-months.repository.js";
import { VK_CONFIG, vkConfigFromEnv, type VkConfig } from "./vk/vk-config.js";
import { VkFeedSource } from "./vk/vk.feed-source.js";
import { VkHistoryImport } from "./vk/vk-history-import.command.js";
import { VkSourceCheck } from "./vk/vk-source-check.service.js";
import { VkWallReconcile } from "./vk/vk-wall-reconcile.service.js";

/**
 * 048 — the materials feed, slice 1 (#3512 opens it with the admin authoring
 * surface; #3513 adds the anonymous feed and material reads); slice 2 adds the
 * «Источники» source list (#3993); slice 3 the VK connector (#4004).
 *
 * `TaxonomyModule` is imported for the SHARED 012 mechanisms, never copied
 * (Lead decision 11): `IdempotencyService` (one `idempotency_keys` record),
 * `TaxonomyProblemFilter` (one RFC 7807 shape and deterministic-refusal store)
 * and the 012 media pipeline the cover rides (`StillImageNormalizer`,
 * `MediaCleanupService`, `MediaSlotRegistry`). `DatabaseModule` is `@Global`,
 * so the repositories' `DRIZZLE_DB` needs no import.
 */
@Module({
  imports: [TaxonomyModule],
  controllers: [
    MaterialsAdminController,
    FeedSourcesAdminController,
    FeedEntriesAdminController,
    PublicFeedController,
    PublicMaterialsController,
    VkCallbackController,
  ],
  providers: [
    MaterialsRepository,
    MaterialsService,
    FeedEntriesRepository,
    FeedSourcesRepository,
    FeedSourcesService,
    OwnMaterialsFeedSource,
    MaterialsPublicReadsService,
    { provide: TELEGRAM_CONFIG, useFactory: () => telegramConfigFromEnv() },
    {
      provide: TELEGRAM_BOT_API,
      inject: [TELEGRAM_CONFIG],
      useFactory: (config: TelegramConfig | null): TelegramBotApi =>
        new TelegramBotApiClient(config?.botToken ?? null),
    },
    TelegramFeedSource,
    TelegramHistoryImport,
    TelegramPreviewService,
    TelegramSourceCheck,
    TelegramUpdateCursorRepository,
    TelegramUpdatePoller,
    { provide: VK_CONFIG, useFactory: () => vkConfigFromEnv() },
    VkCallMonthsRepository,
    {
      provide: VK_API,
      inject: [VK_CONFIG, VkCallMonthsRepository],
      useFactory: (
        config: VkConfig | null,
        counter: VkCallMonthsRepository,
      ): VkApi => new VkApiClient(config?.serviceKey ?? null, counter),
    },
    VkFeedSource,
    VkHistoryImport,
    VkSourceCheck,
    VkWallReconcile,
  ],
})
export class MaterialsModule implements OnModuleInit {
  constructor(
    @Inject(MediaSlotRegistry) private readonly slots: MediaSlotRegistry,
    @Inject(HttpAdapterHost) private readonly http: HttpAdapterHost,
  ) {}

  /**
   * `materials.cover_ref` and `feed_entries.image_ref` (the card's copy of the
   * same cover key) are media slots of both 012 sweeps: registered before any
   * cron runs (crons start after every `onModuleInit`), so neither the cleanup
   * worker nor the upload reconciler ever deletes a cover a row still
   * references (#3572).
   */
  onModuleInit(): void {
    this.slots.register(materials.coverRef, feedEntries.imageRef);
    // EARS-39 — the Callback route refuses an unparsable body with `401`. Nest
    // registers Fastify's body parsers before any `onModuleInit` and Fastify
    // freezes them only at `ready()`, so the swap lands in time; a graph
    // booted without an HTTP server (the endpoint-authz gate) has none.
    const adapter = this.http.httpAdapter as
      { getInstance(): FastifyInstance; getType(): string } | undefined;
    if (adapter?.getType() === "fastify") {
      installVkCallbackJsonParser(adapter.getInstance());
    }
  }
}
