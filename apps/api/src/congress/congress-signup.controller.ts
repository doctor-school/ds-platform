import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import type { CongressSignUpAccepted } from "@ds/schemas";

import { Authz, Public } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { RateLimited } from "../auth/rate-limit/index.js";
import { CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE } from "../auth/rate-limit/rate-limit.types.js";
import { TimingEqualized } from "../auth/timing/index.js";
import { readCongressSignUpTimingFloorMs } from "./congress-signup.config.js";
import { CongressSignUpRequestDto } from "./congress-signup.dto.js";
import { CongressSignUpService } from "./congress-signup.service.js";

/**
 * 044 EARS-1 — the public congress sign-up intake.
 *
 * `POST /v1/congress/sign-up`. Unauthenticated by design (a congress
 * participant has no account yet — creating one is the point), and therefore
 * carrying the same server-side protections the 003 register door carries:
 *
 * - `@BotProtected("congress-sign-up")` — the 003 EARS-17 server half applies
 *   unchanged; 044 defines no provider or challenge logic of its own.
 * - `@RateLimited(CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE)` — its OWN bucket, with
 *   its own 60/15-min per-client-address ceiling. A scoped bucket means this
 *   page can never exhaust the budget register / login / reset share, nor be
 *   exhausted by them (#1646 mechanism, #2294 ceiling).
 * - `@TimingEqualized({ floorMs })` — the existing-account path must not answer
 *   faster than the new-account one; an existence oracle in the timing is an
 *   existence oracle whatever the body says. The floor is this route's OWN
 *   (EARS-7), not the 40 ms auth-door default: both branches here run past that
 *   default, so it would pad neither and the whole work difference — an IdP
 *   create plus a transaction versus an account lookup — would stay on the wire.
 *   It is read per request from server configuration, so raising it after a live
 *   p99 measurement needs no redeploy.
 *
 * `@HttpCode(200)`, not 201: the success body is deliberately identical for the
 * new-account path and the existing-account one, and a 201 would disclose which
 * of the two happened.
 *
 * No CORS configuration is added here or anywhere for this route: the congress
 * site posts through its own origin's proxy, and a cross-origin allowance would
 * widen the intake to every page on the internet.
 */
@Controller({ path: "congress", version: "1" })
export class CongressSignUpController {
  // Explicit @Inject token — the API boots under `tsx`, which emits no
  // `design:paramtypes`.
  constructor(
    @Inject(CongressSignUpService)
    private readonly signUpService: CongressSignUpService,
  ) {}

  /** `POST /v1/congress/sign-up` — the 044 `SignUpForCongress` command. */
  @Post("sign-up")
  @Public()
  @RateLimited(CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE)
  @TimingEqualized({ floorMs: readCongressSignUpTimingFloorMs })
  @BotProtected("congress-sign-up")
  @HttpCode(200)
  @Authz({
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-1"],
  })
  signUp(
    @Body() dto: CongressSignUpRequestDto,
  ): Promise<CongressSignUpAccepted> {
    return this.signUpService.signUp(dto);
  }
}
