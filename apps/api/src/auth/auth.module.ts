import { Module } from "@nestjs/common";
import { APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { loadEnv } from "../config/env.schema.js";
import { IdpModule } from "./idp/idp.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { UserMirrorService } from "./user-mirror.service.js";
import { ReconcileService } from "./reconcile.service.js";
import { AUTH_WEBHOOK_SECRET } from "./auth.tokens.js";

/**
 * F1 auth module (#85): registration + verification + mirror sync + consent.
 *
 * Registers `ZodValidationPipe` globally so every `createZodDto` body is
 * validated against its `packages/schemas` SSOT (ADR-0002 §3). The IdP port is
 * provided by the `@Global` {@link IdpModule}; bot-protection and authz guards
 * are already global (their modules), so this module only wires the F1 services
 * and the webhook-secret config value.
 */
@Module({
  imports: [IdpModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserMirrorService,
    ReconcileService,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    {
      provide: AUTH_WEBHOOK_SECRET,
      useFactory: (): string | undefined => loadEnv().IDP_WEBHOOK_SECRET,
    },
  ],
})
export class AuthModule {}
