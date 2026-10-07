import { Controller, Get, Query, Req } from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { MY_EVENTS_TABS, type MyEvents } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { ACADEMY_ROUTES } from "../events/host-routes.js";
import { serveMyEvents } from "./my-events.read.js";
import { RegistrationService } from "./registration.service.js";

/**
 * 005 «мои события» read surface (design §4/§5) — the `MyEvents` per-user list.
 *
 * - `GET /v1/me/events?tab=upcoming|recordings` → `MyEvents` (005 EARS-6;
 *   014 EARS-9, 014-design §8.3): ONE tab of the caller's «Мои события» plus both
 *   tabs' counts. `upcoming` (the default when `?tab=` is absent) is their
 *   registered `published`/`live` events nearest first; `recordings` is their FULL
 *   `ended` history newest first, each row carrying feature 014's source-free
 *   recording projection so a finished event with nothing published is still
 *   listed with the `preparing` badge. `hidden` registrations are in neither tab.
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
 *
 * This route is the ACADEMY host's read: each row's `roomHref` resolves over
 * {@link ACADEMY_ROUTES} (`/webinars/<slug>/room`). The doctor storefront's
 * twin, `GET /v1/storefront/doctor/me/events`, is the same read over its own
 * route table (wave-2 entry gate §4.3 D8 — the calling host is the controller).
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
    return serveMyEvents(this.registration, req, tab, ACADEMY_ROUTES);
  }
}
