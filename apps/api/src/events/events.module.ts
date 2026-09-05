import { Module } from "@nestjs/common";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { RecordingsModule } from "../recordings/recordings.module.js";
import { EventsAdminController } from "./events.admin.controller.js";
import { EventsPublicController } from "./events.public.controller.js";
import { EventsRepository } from "./events.repository.js";
import { EventsService } from "./events.service.js";
import { LegacyBroadcastsAdminController } from "./legacy-broadcasts.admin.controller.js";
import { RegistrationModule } from "../registration/registration.module.js";
import { RoomModule } from "../room/room.module.js";
import { ParticipationService } from "./participation.service.js";

/**
 * Event module. Hosts both the 007 admin authoring surface (write side) and the
 * 004 public read surface (`EventsPublicController` — the unauthenticated
 * event-page endpoint over a publish-safe projection). Depends on the @Global
 * DatabaseModule (DRIZZLE_DB) and StorageModule (OBJECT_STORAGE); the global
 * AuthzGuard enforces the per-route `@Authz` classification.
 *
 * `TaxonomyModule` is imported for the ONE shared `Idempotency-Key` mechanism —
 * `IdempotencyService` over the single `idempotency_keys` table (012-design §6 /
 * EARS-17). 014 EARS-25's fenced legacy commands consume it exactly as 014's
 * recordings surface does; the 007 module introduces no second implementation.
 * Deliberately NOT `TaxonomyProblemFilter`: 007's admin surface owns its own
 * established response shape, and reshaping live routes is not this slice's call.
 */
@Module({
  // 012 EARS-8 (#1290): the public event page and the upcoming-broadcast
  // listing read their speakers from the taxonomy module's
  // `SpeakerProjectionService` — the ONE canonical merged resolver. The
  // dependency points events → taxonomy and never back: the taxonomy public
  // speaker route resolves its own event key, so there is no cycle.
  // 020 EARS-1 (#1764): the participation policy consumes feature 005's
  // canonical registration fact through `RegistrationService` rather than
  // querying `registrations` a second time here. The dependency points
  // events → registration and never back (005 reads the events table directly,
  // importing no module), so there is no cycle.
  // 020 EARS-7 (#1770): the participation CTA's `presenceCount` is the SAME
  // live distinct-doctor aggregate the 006 room grant carries, read through
  // `PresenceRepository` over the same config-derived window — never a second
  // count query with its own window literal. The dependency points
  // events → room and never back (the room module reads the events table
  // through its own thin repository and imports no event module), so there is
  // no cycle.
  imports: [TaxonomyModule, RecordingsModule, RegistrationModule, RoomModule],
  // 014 EARS-24 (#1741): the «Архивный эфир» creation entry is its own
  // controller because it is the entry to the LEGACY machine, not a variant of
  // `POST /v1/admin/events` (which is the entry to the platform one).
  controllers: [
    EventsAdminController,
    EventsPublicController,
    LegacyBroadcastsAdminController,
  ],
  providers: [EventsService, EventsRepository, ParticipationService],
  // `ParticipationService` and `EventsService` are exported for the DOCTOR
  // storefront's twin routes (020 LD-1): the doctor host mounts thin routes over
  // these same providers, so a second read model or a second CTA resolver
  // cannot come into existence on that side.
  exports: [EventsService, ParticipationService],
})
export class EventsModule {}
