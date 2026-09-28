import { Module } from "@nestjs/common";
import { CongressModule } from "../congress/congress.module.js";
import { RecordingsModule } from "../recordings/recordings.module.js";
import { AttendanceAdminController } from "./attendance.admin.controller.js";
import { CongressAttendanceService } from "./congress-attendance.service.js";
import { DeskRegistrationAdminController } from "./desk-registration.admin.controller.js";
import { EventRosterAdminController } from "./event-roster.admin.controller.js";
import { EventGrantPolicy } from "../authz/event-grant.policy.js";
import { MyEventsController } from "./my-events.controller.js";
import { RegistrationController } from "./registration.controller.js";
import { RegistrationRepository } from "./registration.repository.js";
import { RegistrationService } from "./registration.service.js";

/**
 * 005 registration module — the `doctor_guest`-authenticated `RegisterForEvent`
 * command, the per-user `EventRegistrationState` read (design §1), and the
 * `MyEvents` «мои события» list (EARS-6). Depends on the @Global DatabaseModule
 * (DRIZZLE_DB); the global `AuthzGuard` enforces the per-route EARS-10
 * `doctor_guest` classification. It reads the `events` (007) and `users` (003)
 * tables read-only — no cross-module provider dependency, so it never edits the
 * 004/007 events surface.
 */
@Module({
  // 014 EARS-9: the «Записи» tab badges each finished registration with feature
  // 014's OWN canonical recording projection (#1340) rather than re-deriving the
  // edited-over-raw rule here — so the badge on a doctor's row and the badge on
  // the public card have one implementation.
  // 044 EARS-35: the desk route enters walk-ins through the congress intake
  // use-case itself (`CongressSignUpService`), never through a copy of it.
  imports: [RecordingsModule, CongressModule],
  // 044 EARS-18: the registrar's roster route is the third controller of this
  // module — the read model it serves is owned here, so the route lives beside
  // it rather than on the 007 `platform_admin` events surface (its own file
  // documents why the two authorization classes stay apart).
  controllers: [
    RegistrationController,
    MyEventsController,
    EventRosterAdminController,
    DeskRegistrationAdminController,
    // 044 EARS-34: the per-day attendance mark, on the same desk-route family.
    AttendanceAdminController,
  ],
  // 044 EARS-38: the event-binding step every desk route runs (stateless; it
  // reads `event_role_grants` through the @Global DRIZZLE_DB).
  providers: [
    RegistrationService,
    RegistrationRepository,
    EventGrantPolicy,
    CongressAttendanceService,
  ],
  exports: [RegistrationService],
})
export class RegistrationModule {}
