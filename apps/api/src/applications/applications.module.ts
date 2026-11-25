import { Module } from "@nestjs/common";

import { ApplicationsMeController } from "./applications.me.controller.js";
import { ApplicationsPurge } from "./applications.purge.js";
import { ApplicationsService } from "./applications.service.js";
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
  controllers: [ApplicationsMeController],
  providers: [
    ApplicationsService,
    ApplicationsPurge,
    {
      provide: APPLICATIONS_CLOCK,
      useValue: (() => new Date()) satisfies ApplicationsClock,
    },
  ],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
