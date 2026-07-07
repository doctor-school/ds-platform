import { Module } from "@nestjs/common";
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
  controllers: [EventsAdminController, EventsPublicController],
  providers: [EventsService, EventsRepository],
  exports: [EventsService],
})
export class EventsModule {}
