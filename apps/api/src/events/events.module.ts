import { Module } from "@nestjs/common";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { EventsAdminController } from "./events.admin.controller.js";
import { EventsPublicController } from "./events.public.controller.js";
import { EventsRepository } from "./events.repository.js";
import { EventsService } from "./events.service.js";

/**
 * Event module. Hosts both the 007 admin authoring surface (write side) and the
 * 004 public read surface (`EventsPublicController` — the unauthenticated
 * event-page endpoint over a publish-safe projection). Depends on the @Global
 * DatabaseModule (DRIZZLE_DB) and StorageModule (OBJECT_STORAGE); the global
 * AuthzGuard enforces the per-route `@Authz` classification.
 */
@Module({
  // 012 EARS-8 (#1290): the public event page and the upcoming-broadcast
  // listing read their speakers from the taxonomy module's
  // `SpeakerProjectionService` — the ONE canonical merged resolver. The
  // dependency points events → taxonomy and never back: the taxonomy public
  // speaker route resolves its own event key, so there is no cycle.
  imports: [TaxonomyModule],
  controllers: [EventsAdminController, EventsPublicController],
  providers: [EventsService, EventsRepository],
  exports: [EventsService],
})
export class EventsModule {}
