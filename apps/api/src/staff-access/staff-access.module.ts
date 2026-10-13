import { Module } from "@nestjs/common";
import { IdpModule } from "../auth/idp/idp.module.js";
import { SessionModule } from "../auth/session/session.module.js";
import { AdminSessionModule } from "../auth/admin-session/admin-session.module.js";
import { StaffAccessAdminController } from "./staff-access.admin.controller.js";
import { StaffAccessRepository } from "./staff-access.repository.js";
import { StaffAccessService } from "./staff-access.service.js";

/**
 * 047 — «Доступы» (staff access). The IdP calls go through the existing
 * `IdpClient` port; Postgres through the @Global `DRIZZLE_DB`. The admin-session
 * hook, `AuthzGuard` and `AdminAuthorityGuard` (live revalidation + step-up) are
 * global, so this module declares no guard of its own.
 */
@Module({
  imports: [IdpModule, SessionModule, AdminSessionModule],
  controllers: [StaffAccessAdminController],
  providers: [StaffAccessService, StaffAccessRepository],
})
export class StaffAccessModule {}
