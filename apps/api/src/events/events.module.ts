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
 *
 * `TaxonomyModule` is imported for the ONE shared `Idempotency-Key` mechanism —
 * `IdempotencyService` over the single `idempotency_keys` table (012-design §6 /
 * EARS-17). 014 EARS-18's `mark-ended` command consumes it exactly as 014's
 * recordings surface does; the 007 module introduces no second implementation.
 * Deliberately NOT `TaxonomyProblemFilter`: 007's admin surface owns its own
 * established response shape, and reshaping live routes is not this slice's call.
 */
@Module({
  imports: [TaxonomyModule],
  controllers: [EventsAdminController, EventsPublicController],
  providers: [EventsService, EventsRepository],
  exports: [EventsService],
})
export class EventsModule {}
