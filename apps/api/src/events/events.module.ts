import { Module } from "@nestjs/common";
import { EventsAdminController } from "./events.admin.controller.js";
import { EventsRepository } from "./events.repository.js";
import { EventsService } from "./events.service.js";

/**
 * 007 event-admin module (the authoring vertical's write side). Depends on the
 * @Global DatabaseModule (DRIZZLE_DB) and StorageModule (OBJECT_STORAGE); the
 * global AuthzGuard enforces the per-route `@Authz` classification.
 */
@Module({
  controllers: [EventsAdminController],
  providers: [EventsService, EventsRepository],
  exports: [EventsService],
})
export class EventsModule {}
