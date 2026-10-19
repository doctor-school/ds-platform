import { Logger, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { APP_PIPE } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ZodValidationPipe } from "nestjs-zod";
import { loadEnv } from "../config/env.schema.js";
import { IdpModule } from "./idp/idp.module.js";
import { MailerModule } from "../mailer/mailer.module.js";
import { SessionModule } from "./session/session.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { ReconcileService } from "./reconcile.service.js";
import { PhoneController } from "./phone/phone.controller.js";
import { PhoneConfirmationService } from "./phone/phone-confirmation.service.js";
import { DrizzlePhoneMirror, PHONE_MIRROR } from "./phone/phone-mirror.js";
import { ReconcileScheduler } from "./reconcile.scheduler.js";
import {
  AUTH_WEBHOOK_SECRET,
  RECONCILE_SWEEP_INTERVAL_MS,
} from "./auth.tokens.js";
import { SmsBudgetService } from "./sms-budget/sms-budget.service.js";
import {
  InMemoryLoginHandoffStore,
  LOGIN_HANDOFF_STORE,
  RedisLoginHandoffStore,
  type HandoffRedisLike,
  type LoginHandoffStore,
} from "./login-handoff/login-handoff.store.js";
import {
  resolveSmsBudgetThresholds,
  SMS_BUDGET_CLOCK,
  SMS_BUDGET_THRESHOLDS,
  type Clock,
  type SmsBudgetThresholds,
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
  controllers: [AuthController, PhoneController],
  providers: [
    AuthService,
    // UserMirrorService moved to SessionModule (EARS-26, #709): the session
    // auth hook is now its earliest consumer (read-path self-heal), and this
    // module resolves the exported single instance via its SessionModule import.
    ReconcileService,
    ReconcileScheduler,
    // 003 EARS-47…52 (#2449): confirming a phone from `/account`.
    PhoneConfirmationService,
    { provide: PHONE_MIRROR, useClass: DrizzlePhoneMirror },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    {
      provide: AUTH_WEBHOOK_SECRET,
      useFactory: (): string | undefined => loadEnv().IDP_WEBHOOK_SECRET,
    },
    {
      provide: RECONCILE_SWEEP_INTERVAL_MS,
      useFactory: (): number => loadEnv().RECONCILE_SWEEP_INTERVAL_MS,
    },
    // EARS-14 SMS toll-fraud budget. Thresholds are the EARS-14 defaults, each
    // ceiling env-overridable for a one-IP test stand (#3047, `SMS_BUDGET_*`);
    // a malformed / ≤0 / non-integer var is ignored with one loud warn and the
    // default kept for that field — never an unlimited budget, never a boot
    // crash (see `resolveSmsBudgetThresholds`). The e2e rebinds the token to
    // drive the breaker boundary. The clock is `Date.now`, rebound to a fake in
    // the unit spec for deterministic window-reset testing.
    SmsBudgetService,
    {
      provide: SMS_BUDGET_THRESHOLDS,
      useFactory: (): SmsBudgetThresholds => {
        const logger = new Logger(SmsBudgetService.name);
        return resolveSmsBudgetThresholds(loadEnv(), ({ envVar, rawValue }) =>
          logger.warn(
            `${envVar}=${JSON.stringify(rawValue)} is not a positive integer; ignoring the override and keeping the EARS-14 default for that ceiling.`,
          ),
        );
      },
    },
    { provide: SMS_BUDGET_CLOCK, useValue: (() => Date.now()) satisfies Clock },
    // 003 EARS-44 / 044 EARS-39: the Congress hand-off reference store — Redis
    // when configured (the reference must survive across API instances and
    // restarts for its 24 h), the in-memory binding otherwise (dev-stand / CI
    // default, like the other Redis-backed stores). Exported: the Congress
    // sign-up mints, the login door redeems.
    {
      provide: LOGIN_HANDOFF_STORE,
      useFactory: (): LoginHandoffStore => {
        const env = loadEnv();
        if (env.REDIS_URL) {
          const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
          const logger = new Logger("LoginHandoffStore");
          redis.on("error", (e: Error) =>
            logger.error(`redis connection error: ${e.message}`),
          );
          return new RedisLoginHandoffStore(
            redis as unknown as HandoffRedisLike,
          );
        }
        return new InMemoryLoginHandoffStore();
      },
    },
  ],
  // 021 EARS-4 (#1540): the doctor storefront's `RegisterDoctor` command is a
  // thin host projection over THIS engine — it adds the access-condition
  // precondition and delegates credential creation, the verification code and
  // the consent commit here rather than re-implementing any of them. Exporting
  // the service is what makes that reuse possible; without it the only way to
  // stand a storefront door up would be a second registration path.
  exports: [AuthService, LOGIN_HANDOFF_STORE],
})
export class AuthModule {}
