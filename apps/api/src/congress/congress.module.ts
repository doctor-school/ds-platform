import { Module } from "@nestjs/common";
import { loadEnv } from "../config/env.schema.js";
import { AuthModule } from "../auth/auth.module.js";
import { MailerModule } from "../mailer/mailer.module.js";
import { CongressIntakeSettingsAdminController } from "./congress-intake-settings.admin.controller.js";
import { CongressIntakeSettingsService } from "./congress-intake-settings.service.js";
import { CongressSignUpController } from "./congress-signup.controller.js";
import { CongressSignUpService } from "./congress-signup.service.js";
import {
  CongressBirthDateMeController,
  CongressSubmissionsMeController,
} from "./congress-submissions.me.controller.js";
import { CongressSubmissionsService } from "./congress-submissions.service.js";
import { congressCabinetUrl } from "../mailer/notice-emails.js";
import {
  CONGRESS_CABINET_URL,
  CONGRESS_SIGN_UP_CLOCK,
  CONGRESS_SIGN_UP_ENV,
  type CongressSignUpClock,
  type CongressSignUpEnvReader,
} from "./congress-signup.tokens.js";

/**
 * 044 — the public congress sign-up surface (`apps/api/src/congress/README.md`).
 *
 * Imports `AuthModule` because account creation belongs to the auth engine, not
 * to this surface: the intake calls `AuthService.createPasswordlessAccount` and
 * owns no IdP call, no mirror upsert and no role grant of its own.
 *
 * Imports `MailerModule` for the same reason at one remove: 044 EARS-13's
 * confirmation is an ordinary product notice on the shared `Mailer` port, so
 * this module owns WHEN it is sent and the recorded outcome (EARS-11/12),
 * while the mailer owns the transport, the failover and the artifact.
 */
@Module({
  imports: [AuthModule, MailerModule],
  // 046 EARS-1…3: the platform administrator's intake settings per event.
  controllers: [
    CongressSignUpController,
    CongressIntakeSettingsAdminController,
    // 046 EARS-4…17: the author's submissions cabinet.
    CongressSubmissionsMeController,
    CongressBirthDateMeController,
  ],
  providers: [
    CongressSignUpService,
    CongressIntakeSettingsService,
    CongressSubmissionsService,
    {
      provide: CONGRESS_SIGN_UP_CLOCK,
      useValue: (() => new Date()) satisfies CongressSignUpClock,
    },
    {
      // Read per request, not captured at boot: an operator who fills a missing
      // setting in has the intake accepting submissions without a redeploy.
      provide: CONGRESS_SIGN_UP_ENV,
      useValue: (() => loadEnv()) satisfies CongressSignUpEnvReader,
    },
    {
      // 046 «Letters» — resolved once at boot from the REQUIRED
      // `MAILER_DOCTOR_BASE_URL`: the submission letters link here.
      provide: CONGRESS_CABINET_URL,
      useFactory: (): string =>
        congressCabinetUrl(loadEnv().MAILER_DOCTOR_BASE_URL),
    },
  ],
  // 044 EARS-35: the registrar's desk route (`registration/`) enters walk-ins
  // through THIS intake use-case, never through a second one.
  // 044 EARS-34: the desk's attendance mark reads the congress DAYS through
  // this module's own configuration reader, never through a second one.
  exports: [CongressSignUpService, CONGRESS_SIGN_UP_ENV],
})
export class CongressModule {}
