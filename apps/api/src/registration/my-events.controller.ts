import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { MY_EVENTS_TABS, type MyEvents, MyEventsQuerySchema } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  RegistrationService,
  UnknownSubjectError,
} from "./registration.service.js";

/**
 * 005 «мои события» read surface (design §4/§5) — the `MyEvents` per-user list.
 *
 * - `GET /v1/me/events?tab=upcoming|recordings` → `MyEvents` (005 EARS-6;
 *   014 EARS-9, 014-design §8.3): ONE tab of the caller's «Мои события» plus both
 *   tabs' counts. `upcoming` (the default when `?tab=` is absent) is their
 *   registered `published`/`live` events nearest first; `recordings` is their FULL
 *   `ended` history newest first, each row carrying feature 014's source-free
 *   recording projection so a finished event with nothing published is still
 *   listed with the `preparing` badge. `archived` registrations are in neither tab.
 *   An empty `data` is a valid result (the surface renders the canvas empty-state).
 *   An unknown `?tab=` is a 400 — «Сертификаты» is not a tab this surface has, and
 *   answering it with the default would silently pretend otherwise.
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
  // The SDK must see the tab as OPTIONAL with the closed two-value set: a
  // required param would break the bare `/v1/me/events` call 005's consumers
  // still make, and an open `string` would let a fourth tab through the contract.
  @ApiQuery({
    name: "tab",
    required: false,
    enum: [...MY_EVENTS_TABS],
  })
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-6", "EARS-7", "EARS-9", "EARS-10"],
  })
  async list(
    @Req() req: FastifyRequest,
    @Query("tab") tab?: string,
  ): Promise<MyEvents> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    // The guard guarantees an authenticated subject; a null sub is defence in
    // depth, never a silent success (EARS-10).
    if (!sub) throw new UnauthorizedException("authentication required");
    // The closed two-tab set is the schema's (014 EARS-9). An absent `?tab=`
    // defaults to `upcoming`, so the bare `/v1/me/events` 005 shipped keeps
    // working; anything else is refused rather than coerced.
    const query = MyEventsQuerySchema.safeParse(
      tab === undefined ? {} : { tab },
    );
    if (!query.success) {
      throw new BadRequestException("tab must be upcoming or recordings");
    }
    try {
      return await this.registration.myEvents(sub, query.data.tab);
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
