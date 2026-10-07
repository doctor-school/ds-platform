import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import type { CongressSignUpAccepted } from "@ds/schemas";

import { Authz, Public } from "../authz/index.js";
import { BotProtected } from "../bot-protection/index.js";
import { RateLimited } from "../auth/rate-limit/index.js";
import { CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE } from "../auth/rate-limit/rate-limit.types.js";
import { TimingEqualized } from "../auth/timing/index.js";
import {
  LOGIN_HANDOFF_STORE,
  type LoginHandoffStore,
} from "../auth/login-handoff/login-handoff.store.js";
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
 *   page can never exhaust the auth doors' per-IP windows, nor be exhausted by
 *   them (003 EARS-13; #1646 mechanism, #2294 ceiling).
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
    @Inject(LOGIN_HANDOFF_STORE)
    private readonly handoffs: LoginHandoffStore,
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
    tests: ["EARS-1", "EARS-39"],
  })
  async signUp(
    @Body() dto: CongressSignUpRequestDto,
  ): Promise<CongressSignUpAccepted> {
    // EARS-7: one success state whatever the intake did — the registration id
    // and whether it was new are the desk's to name (EARS-35), never this door's.
    const outcome = await this.signUpService.signUp(dto, { origin: "site" });
    // EARS-39: the sign-in hand-off for «Войти в кабинет» (003 EARS-44). Minted
    // for every accepted submission — new account, existing account, repeat —
    // the same way, so its presence and shape disclose nothing (EARS-7). The
    // reference is opaque random bytes; only its hash is stored; it is never
    // logged. The address is stored exactly as typed here, so the redemption
    // names back the visitor's own spelling and never the stored account's
    // (whose letter case would tell an existing account from a new one). The
    // mint runs after the intake has committed: if the store is down the
    // visitor gets a 500 for a registration that was written — a retry is
    // idempotent (EARS-7), so nothing is lost or duplicated.
    const handoff = await this.handoffs.mint(outcome.accountId, dto.email);
    return { status: "accepted", handoff };
  }
}
