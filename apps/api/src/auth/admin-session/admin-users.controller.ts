import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { AdminFactorRemovalResponse } from "@ds/schemas";
import { Authz } from "../../authz/index.js";
import { IdpUnavailableError } from "../idp/idp.types.js";
import { RateLimited } from "../rate-limit/index.js";
import { TimingEqualized } from "../timing/index.js";
import {
  AdminSessionService,
  type AdminSessionPrincipal,
} from "./admin-session.service.js";
import { AdminFactorRemovalRequestDto } from "./admin-auth.dto.js";

/**
 * The EARS-7 uniform second-factor refusal, worded **identically** to
 * `AdminAuthController`'s. EARS-13 requires a wrong / missing / expired / replayed
 * caller code to be refused with "no distinct error" from a login-time verify, so
 * the two surfaces must answer with the same status and the same body — a second
 * wording here would be a discriminator a caller can read.
 */
const GENERIC_ADMIN_MFA_FAILURE = "verification failed";

/** The ADR-0001 §7 throttled answer, worded as the global `RateLimitGuard`'s. */
const GENERIC_ADMIN_THROTTLED = "too many requests, please try again later";

/** The IdP-fault answer (#202, #1211): an infra fault is an honest 503, never a 500. */
const GENERIC_ADMIN_UNAVAILABLE = "the service is temporarily unavailable";

/**
 * The one refusal on this route that is allowed its own words: the caller aimed
 * the command at themselves. It discloses nothing — the caller supplied both the
 * target id and the session it is compared against — and an operator who mistypes
 * a subject deserves to know that, rather than being told their code was wrong.
 */
const SELF_REMOVAL_REFUSED =
  "an operator cannot remove their own second factor through this endpoint";

/**
 * 011 EARS-13 — the admin **user-management** surface, whose whole content in this
 * slice is the LD-2 operator recovery: `DELETE /v1/admin/users/:id/mfa`.
 *
 * It is its own controller rather than a sixth route on `AdminAuthController`
 * because the two answer different questions. That one is the caller's own auth
 * arc — primary auth, enrollment, challenge, the state read, logout — and every
 * route on it acts on the caller. This one acts on **another admin's account**,
 * which is why it lives under `/v1/admin/users/:id` and not `/v1/admin/auth`: the
 * path says whose factor is at stake, and a route that removed someone else's
 * credential from an `auth` namespace would read as a self-service action.
 *
 * Why an endpoint at all, rather than an IdP console step: a console-side removal
 * is never observed by `apps/api`, so the `auth.mfa.reset` row EARS-9 mandates
 * could never be written — the audit criterion would be unbuildable (011
 * requirements → LD-2).
 */
@Controller({ path: "admin/users", version: "1" })
export class AdminUsersController {
  constructor(private readonly admin: AdminSessionService) {}

  /**
   * EARS-13 — `RemoveMfaFactor`. Removes the target admin's registered TOTP
   * factor and returns them to forced enrollment (EARS-4).
   *
   * **Classification.** `access: authenticated` + `roles: [platform_admin]` on the
   * raised EARS-11 floor (the admin session hook resolves the principal only from
   * `__Host-ds_admin_session`, and only for an MFA-verified record), with
   * `audit: high-stakes` — the mandatory terminal row is the `auth.mfa.reset` this
   * route exists to produce. As a state-changing admin endpoint it also carries
   * the EARS-10 CSRF double-submit header, enforced in the hook.
   *
   * **`stepUp` is deliberately NOT declared.** The general step-up mechanism has
   * never been built in this repo — `stepUp` is matrix metadata no guard reads —
   * so a `true` there would make the generated endpoint-authz matrix promise a
   * protection nothing enforces, on the most destructive action in the spec. The
   * freshness ADR-0001 §10 asks for is proven route-locally instead, by the
   * caller's own current code in the request body, and the matrix row's
   * `step_up: false` is the honest value (011 design §9). Graduating this route
   * onto the mechanism when its vertical lands is a tracked deferral, not a
   * comment.
   *
   * Every code refusal is the same 401 with the same body the login-time verifies
   * return, under `@TimingEqualized()`, drawing on the same budgets (EARS-7).
   */
  @Delete(":id/mfa")
  @RateLimited()
  @TimingEqualized()
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "high-stakes",
    tests: ["EARS-13"],
  })
  async removeMfaFactor(
    @Param("id") targetSub: string,
    @Body() dto: AdminFactorRemovalRequestDto,
    @Req() req: { user?: AdminSessionPrincipal },
  ): Promise<AdminFactorRemovalResponse> {
    // The hook resolved this, or `AuthzGuard` refused the request before the
    // handler ran; the check is the defensive re-assertion of that invariant,
    // failing closed rather than reading `undefined` as "some admin".
    const caller = req.user;
    if (!caller) throw new UnauthorizedException(GENERIC_ADMIN_MFA_FAILURE);

    let outcome;
    try {
      outcome = await this.admin.removeMfaFactor(caller, targetSub, dto.code);
    } catch (err) {
      // A genuine IdP infra fault — the possession check or the removal RPC —
      // is an honest 503, never a bare 500 (#202, #1211). Mapped here, in the
      // handler, so the terminal error still travels through
      // `TimingEqualizationInterceptor`'s padded branch like the refusal it must
      // be indistinguishable from in timing.
      if (err instanceof IdpUnavailableError) {
        throw new ServiceUnavailableException(GENERIC_ADMIN_UNAVAILABLE);
      }
      throw err;
    }

    if (outcome.status === "self_removal") {
      throw new ForbiddenException(SELF_REMOVAL_REFUSED);
    }
    if (outcome.status === "throttled") {
      throw new HttpException(
        GENERIC_ADMIN_THROTTLED,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (outcome.status !== "removed") {
      throw new UnauthorizedException(GENERIC_ADMIN_MFA_FAILURE);
    }
    // The acknowledgement carries no account detail: the removal is idempotent by
    // design, so a body distinguishing "removed one" from "there was none" would
    // turn recovery into a factor-enrollment oracle over the admin population.
    return { status: "removed" };
  }
}
