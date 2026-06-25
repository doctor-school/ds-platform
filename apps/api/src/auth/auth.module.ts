import { Module } from "@nestjs/common";
import { APP_PIPE } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ZodValidationPipe } from "nestjs-zod";
import { loadEnv } from "../config/env.schema.js";
import { IdpModule } from "./idp/idp.module.js";
import { MailerModule } from "../mailer/mailer.module.js";
import { SessionModule } from "./session/session.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { UserMirrorService } from "./user-mirror.service.js";
import { ReconcileService } from "./reconcile.service.js";
import { ReconcileScheduler } from "./reconcile.scheduler.js";
import {
  AUTH_WEBHOOK_SECRET,
  RECONCILE_SWEEP_INTERVAL_MS,
} from "./auth.tokens.js";
import { SmsBudgetService } from "./sms-budget/sms-budget.service.js";
import {
  DEFAULT_SMS_BUDGET_THRESHOLDS,
  SMS_BUDGET_CLOCK,
  SMS_BUDGET_THRESHOLDS,
  type Clock,
} from "./sms-budget/sms-budget.types.js";

/**
 * Auth module: F1 (#85) registration + verification + mirror sync + consent, and
 * F2 (#86) password login + BFF session establishment.
 *
 * Registers `ZodValidationPipe` globally so every `createZodDto` body is
 * validated against its `packages/schemas` SSOT (ADR-0002 §3). The IdP port is
 * provided by the `@Global` {@link IdpModule}; {@link SessionModule} provides the
 * session store + establishment + the request-subject auth hook; bot-protection
 * and authz guards are already global (their modules), so this module wires the
 * auth services and the webhook-secret config value.
 */
@Module({
  // `ScheduleModule.forRoot()` provides the SchedulerRegistry the
  // ReconcileScheduler registers its config-driven interval on (#119,
  // design §11 "Reconciliation depth"). It is a no-op until a consumer adds a
  // timer, so it does not change the boot of the rest of the module.
  imports: [IdpModule, SessionModule, MailerModule, ScheduleModule.forRoot()],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserMirrorService,
    ReconcileService,
    ReconcileScheduler,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    {
      provide: AUTH_WEBHOOK_SECRET,
      useFactory: (): string | undefined => loadEnv().IDP_WEBHOOK_SECRET,
    },
    {
      provide: RECONCILE_SWEEP_INTERVAL_MS,
      useFactory: (): number => loadEnv().RECONCILE_SWEEP_INTERVAL_MS,
    },
    // EARS-14 SMS toll-fraud budget. Thresholds are the EARS-14 defaults bound as
    // an injectable value (a deployment can rebind to tighten them; the e2e
    // rebinds to drive the breaker boundary). The clock is `Date.now`, rebound to
    // a fake in the unit spec for deterministic window-reset testing.
    SmsBudgetService,
    { provide: SMS_BUDGET_THRESHOLDS, useValue: DEFAULT_SMS_BUDGET_THRESHOLDS },
    { provide: SMS_BUDGET_CLOCK, useValue: (() => Date.now()) satisfies Clock },
  ],
})
export class AuthModule {}
