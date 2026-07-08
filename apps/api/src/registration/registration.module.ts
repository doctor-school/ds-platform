import { Module } from "@nestjs/common";
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
  controllers: [RegistrationController, MyEventsController],
  providers: [RegistrationService, RegistrationRepository],
  exports: [RegistrationService],
})
export class RegistrationModule {}
