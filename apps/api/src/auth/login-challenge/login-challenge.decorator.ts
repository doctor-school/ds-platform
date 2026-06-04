import { SetMetadata } from "@nestjs/common";
import { LOGIN_CHALLENGED_KEY } from "./login-challenge.types.js";

/**
 * `@LoginChallenged()` — opt the login route into the EARS-17 conditional
 * bot-challenge. The global {@link LoginChallengeGuard} no-ops on any unmarked
 * handler; on the marked login handler it requires a captcha only once the
 * origin has crossed the failure threshold ({@link LoginChallengePolicy}).
 */
export function LoginChallenged(): MethodDecorator & ClassDecorator {
  return SetMetadata(LOGIN_CHALLENGED_KEY, true);
}
