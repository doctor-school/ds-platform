import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { MY_EVENTS_TABS, type MyEvents } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { DOCTOR_ROUTES } from "../events/host-routes.js";
import { serveMyEvents } from "../registration/my-events.read.js";
import { RegistrationService } from "../registration/registration.service.js";

/**
 * #1972 (wave-2 entry gate §2.3 rows 24–27, §4.2 `MyEventItem`, §4.3 D8) — the
 * DOCTOR storefront's «Мои события» read.
 *
 * - `GET /v1/storefront/doctor/me/events?tab=upcoming|recordings` → `MyEvents`:
 *   the SAME read as the Academy's `GET /v1/me/events` (005 EARS-6; 014 EARS-9)
 *   — same subject, same closed tab set, same envelope, one shared handler
 *   ({@link serveMyEvents}) — over the doctor host's route table, so a live
 *   row's `roomHref` is this host's own room, `/events/<slug>/room`. The calling
 *   host is the controller, as D5 resolves the live-block href; there is no
 *   host header or query to forge.
 *
 * Authorization mirrors the Academy route exactly (005 EARS-10): `authenticated`
 * / `doctor_guest` / `fast-path` — the global `AuthzGuard` refuses an
 * unauthenticated caller (401) and any other role (403) before the handler runs,
 * and the read returns ONLY the caller's own registrations. Per-user ⇒ private,
 * never shared-cacheable.
 */
@Controller({ path: "storefront/doctor/me", version: "1" })
export class DoctorMyEventsMeController {
  // Explicit `@Inject`: the `endpoint-authz` gate boots this graph under `tsx`,
  // which emits no `design:paramtypes`.
  constructor(
    @Inject(RegistrationService)
    private readonly registration: RegistrationService,
  ) {}

  @Get("events")
  // The tab is OPTIONAL with the closed two-value set, exactly as on the Academy
  // route: one contract, two hosts.
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
    tests: ["EARS-6", "EARS-9", "EARS-10"],
  })
  async list(
    @Req() req: FastifyRequest,
    @Query("tab") tab?: string,
  ): Promise<MyEvents> {
    return serveMyEvents(this.registration, req, tab, DOCTOR_ROUTES);
  }
}
