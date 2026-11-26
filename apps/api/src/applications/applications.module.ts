import { Module } from "@nestjs/common";

import { MailerModule } from "../mailer/mailer.module.js";
import { TaxonomyModule } from "../taxonomy/taxonomy.module.js";
import { ApplicationNotices } from "./application-notices.js";
import { ApplicationsAdminController } from "./applications.admin.controller.js";
import { ApplicationAdminProblemFilter } from "./applications.admin.errors.js";
import { ApplicationsAdminService } from "./applications.admin.service.js";
import { ApplicationsMeController } from "./applications.me.controller.js";
import { ApplicationsInvestorService } from "./applications.investor.service.js";
import { ApplicationsPartnershipService } from "./applications.partnership.service.js";
import { ApplicationsPublicController } from "./applications.public.controller.js";
import { ApplicationsPurge } from "./applications.purge.js";
import { ApplicationsService } from "./applications.service.js";
import { PartnershipRecordsImport } from "./import-partnership-records.js";
import {
  APPLICATIONS_CLOCK,
  type ApplicationsClock,
} from "./applications.tokens.js";

/**
 * 033 — the shared application queue core (`./README.md`). The admin queue,
 * the notifications and the partnership intake are sibling slices that build
 * on this module's service and tables.
 */
@Module({
  // TaxonomyModule: the 012 admin idempotency service and problem filter (#4030).
  // MailerModule: the 033 EARS-11/12 after-commit sends (#4029).
  imports: [TaxonomyModule, MailerModule],
  controllers: [
    ApplicationsMeController,
    ApplicationsPublicController,
    ApplicationsAdminController,
  ],
  providers: [
    ApplicationsAdminService,
    ApplicationAdminProblemFilter,
    ApplicationNotices,
    ApplicationsService,
    ApplicationsPartnershipService,
    ApplicationsInvestorService,
    PartnershipRecordsImport,
    ApplicationsPurge,
    {
      provide: APPLICATIONS_CLOCK,
      useValue: (() => new Date()) satisfies ApplicationsClock,
    },
  ],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
