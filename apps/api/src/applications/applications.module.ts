import { Module } from "@nestjs/common";

import { ApplicationsMeController } from "./applications.me.controller.js";
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
  controllers: [ApplicationsMeController, ApplicationsPublicController],
  providers: [
    ApplicationsService,
    ApplicationsPartnershipService,
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
