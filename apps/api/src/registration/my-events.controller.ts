import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { MyEvents } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  RegistrationService,
  UnknownSubjectError,
} from "./registration.service.js";

/**
 * 005 «мои события» read surface (design §4/§5) — the `MyEvents` per-user list.
 *
 * - `GET /v1/me/events` → `MyEvents` (EARS-6): the authenticated doctor's
 *   registered UPCOMING events (`published`/`live`, future or currently airing),
 *   ordered nearest `startsAt` first, each `{ eventId, slug, title, school,
 *   startsAt, state }`. Feeds the «мои события» Предстоящие tab; an empty result
 *   is a valid `[]` (the surface renders the canvas empty-state).
 *
 * A distinct controller from `RegistrationController` only because the route lives
 * under the `/me` path prefix (the caller's own resources), not `/events`. It
 * carries the same EARS-10 classification `authenticated` / `doctor_guest` /
 * `fast-path`: the global `AuthzGuard` refuses an unauthenticated caller (401) and
 * any non-`doctor_guest` role (403) before the handler runs — never a silent
 * success — and the read returns ONLY the caller's own registrations, never
 * another doctor's (EARS-10). Per-user ⇒ private, never shared-cacheable.
 */
@Controller({ path: "me", version: "1" })
export class MyEventsController {
  constructor(private readonly registration: RegistrationService) {}

  @Get("events")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-6", "EARS-10"],
  })
  async list(@Req() req: FastifyRequest): Promise<MyEvents> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    // The guard guarantees an authenticated subject; a null sub is defence in
    // depth, never a silent success (EARS-10).
    if (!sub) throw new UnauthorizedException("authentication required");
    try {
      return await this.registration.myEvents(sub);
    } catch (err) {
      // An authenticated subject with no 003 mirror row cannot own registrations
      // — a 401, never a silent empty list (EARS-10).
      if (err instanceof UnknownSubjectError) {
        throw new UnauthorizedException("authentication required");
      }
      throw err;
    }
  }
}
