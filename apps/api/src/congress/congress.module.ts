import { Module } from "@nestjs/common";
import { loadEnv } from "../config/env.schema.js";
import { AuthModule } from "../auth/auth.module.js";
import { CongressSignUpController } from "./congress-signup.controller.js";
import { CongressSignUpService } from "./congress-signup.service.js";
import {
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
 */
@Module({
  imports: [AuthModule],
  controllers: [CongressSignUpController],
  providers: [
    CongressSignUpService,
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
  ],
})
export class CongressModule {}
