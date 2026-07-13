import {
  Body,
  Controller,
  Get,
  HttpCode,
  Put,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { MyDisplayName, MyProfile } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { SetDisplayNameRequestDto } from "./me.dto.js";
import { MeService, UnknownSubjectError } from "./me.service.js";

/**
 * 006 self-scoped display-name surface (EARS-14, EARS-16; design §11) — the JIT
 * room-entry «Имя и фамилия» collection and its owner-only read:
 *
 * - `GET /v1/me/display-name` → `MyDisplayName` (EARS-16): the CALLER's own
 *   `{ displayName }` (`null` until collected). The portal reads it to decide the
 *   one-time room-entry prompt and to derive the header-avatar initials.
 * - `PUT /v1/me/display-name` → `SetDisplayName` (EARS-14): writes the trimmed
 *   name to the caller's own `users.display_name`. An empty / whitespace-only
 *   value is a 400 at the boundary (the {@link SetDisplayNameRequestDto} SSOT).
 *
 * - `GET /v1/me/profile` → `MyProfile` (003 EARS-27, design §12): the CALLER's
 *   own account-profile projection (`email`/`emailVerified`/`phone`/
 *   `phoneVerified`/`displayName`) off their `users` mirror row — read-only,
 *   no IdP call. The portal `/account` surface renders it (EARS-28).
 *
 * All routes carry the classification `authenticated` / `doctor_guest` / `fast-path`
 * (EARS-16; ADR-0001 §2): a caller touching only their OWN record needs no policy
 * evaluation — the global `AuthzGuard` refuses an unauthenticated caller (401)
 * and any non-`doctor_guest` role (403) before the handler runs, never a silent
 * success. Identity is ALWAYS the authenticated session `sub` — no endpoint takes
 * a target user id, so no caller can read or write another doctor's name
 * (EARS-16). The read is per-caller ⇒ never shared-cacheable.
 */
@Controller({ path: "me", version: "1" })
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get("display-name")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-16"],
  })
  read(@Req() req: FastifyRequest): Promise<MyDisplayName> {
    return this.run(req, (sub) => this.me.myDisplayName(sub));
  }

  /**
   * 003 account-profile v1 self-read (EARS-27, design §12; GH #770) — the
   * caller's OWN `{ email, emailVerified, phone, phoneVerified, displayName }`
   * projected from their `users` mirror row. Same classification and fail-closed
   * behavior as the sibling reads: self-only by construction (subject = session
   * `sub`, no identifier parameter), read-only on every path, unauthenticated →
   * the same generic 401. Per-caller ⇒ never shared-cacheable.
   */
  @Get("profile")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-27"],
  })
  profile(@Req() req: FastifyRequest): Promise<MyProfile> {
    return this.run(req, (sub) => this.me.myProfile(sub));
  }

  @Put("display-name")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    // A `doctor_guest` self-scoped profile write, not an auth/security event —
    // no AuthAuditLog emission (low-stakes). The display name is not a
    // credential; it never gates access.
    audit: "low-stakes",
    tests: ["EARS-14", "EARS-16"],
  })
  set(
    @Body() dto: SetDisplayNameRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<MyDisplayName> {
    return this.run(req, (sub) => this.me.setDisplayName(sub, dto.displayName));
  }

  /**
   * Shared body: resolve the acting doctor's Zitadel `sub` off the request (the
   * 003 session hook attaches it; the `AuthzGuard` has already refused any
   * unauthenticated caller — a null `sub` is fail-closed defence in depth → 401,
   * never a silent success, EARS-16), run the operation, and map an unresolved
   * subject (no 003 mirror row) to a 401.
   */
  private async run<T>(
    req: FastifyRequest,
    op: (sub: string) => Promise<T>,
  ): Promise<T> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    if (!sub) throw new UnauthorizedException("authentication required");
    try {
      return await op(sub);
    } catch (err) {
      if (err instanceof UnknownSubjectError) {
        throw new UnauthorizedException("authentication required");
      }
      throw err;
    }
  }
}
