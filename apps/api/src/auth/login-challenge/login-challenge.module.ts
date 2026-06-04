import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { LoginChallengeGuard } from "./login-challenge.guard.js";
import { LoginChallengePolicy } from "./login-challenge.policy.js";
import {
  DEFAULT_LOGIN_CHALLENGE_CONFIG,
  LOGIN_CHALLENGE_CLOCK,
  LOGIN_CHALLENGE_CONFIG,
  type Clock,
} from "./login-challenge.types.js";

/**
 * Wires the EARS-17 conditional login-challenge (design §10.1):
 *
 * - provides {@link LoginChallengePolicy} (the per-origin failure window) with
 *   the EARS-17 default config and `Date.now`, both injectable so a deployment
 *   tunes them and tests drive the boundary;
 * - registers {@link LoginChallengeGuard} globally so the marked login route is
 *   gated without per-controller `@UseGuards` wiring.
 *
 * `@Global` + exports the policy so the controller can record the login outcome
 * (failure tallies, success clears) into the same instance the guard reads.
 */
@Global()
@Module({
  providers: [
    LoginChallengePolicy,
    {
      provide: LOGIN_CHALLENGE_CONFIG,
      useValue: DEFAULT_LOGIN_CHALLENGE_CONFIG,
    },
    {
      provide: LOGIN_CHALLENGE_CLOCK,
      useValue: (() => Date.now()) satisfies Clock,
    },
    { provide: APP_GUARD, useClass: LoginChallengeGuard },
  ],
  exports: [LoginChallengePolicy],
})
export class LoginChallengeModule {}
