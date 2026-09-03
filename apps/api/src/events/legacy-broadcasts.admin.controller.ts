import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { type EventAdminDetail, taxonomyETag } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import { LegacyBroadcastCreateDto } from "./events.dto.js";
import { EventsService } from "./events.service.js";

/**
 * 014 EARS-24 (#1741) — the «Архивный эфир» creation surface
 * (`POST /v1/admin/legacy-broadcasts`, `platform_admin`).
 *
 * A SEPARATE controller from `EventsAdminController` on purpose, and not merely
 * because the path prefix differs. 014-design §3.1 splits the aggregate into two
 * machines keyed by `events.origin`, and `POST /v1/admin/events` is the entry to
 * the PLATFORM one: an эфир the platform will host, born `draft`, en route to a
 * room. This route is the entry to the LEGACY one: an эфир the platform never
 * hosted, born `hidden`, that will only ever carry a recording. Folding them into
 * one route behind a body flag would make «which machine is this event on?» a
 * client's decision instead of the server's, which is exactly the coupling the
 * origin column exists to remove.
 *
 * The body is JSON (no multipart): a legacy эфир has no program PDF to upload —
 * it already happened.
 */
@Controller({ path: "admin/legacy-broadcasts", version: "1" })
export class LegacyBroadcastsAdminController {
  constructor(private readonly events: EventsService) {}

  /**
   * 014 EARS-24 — create one `legacy` эфир from its title, held-at instant,
   * duration, speakers and the recording it exists to carry. The event and the
   * recording land in ONE transaction (see
   * `EventsRepository.insertLegacyBroadcast`), so an эфир that can never be
   * archived is not a reachable state.
   *
   * `origin` and `state` are SERVER-assigned and are refused at the I/O boundary:
   * `LegacyBroadcastCreateBodySchema` is `.strict()`, so a body carrying either
   * key is a 400 before this handler runs. The эфир is born `hidden` and appears
   * on no public surface until an explicit `ArchiveLegacyBroadcast`.
   *
   * Like 007's `create`, the 201 carries the aggregate AND its `ETag`, so an
   * operator that creates and then immediately archives does not have to re-read
   * the detail just to obtain an `If-Match`.
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // Endpoint-authz AUTH-audit tier (ADR-0001 §2.5/§8): an authenticated admin
    // write, not a lifecycle transition and not an auth security event — the
    // ADR-0003 §6 domain rows are feature 010's capture-trigger obligation,
    // written inside the repository transaction.
    audit: "low-stakes",
    // #1304 default-deny: a brand-new admin mutation revalidates live.
    revalidate: "live",
    tests: ["EARS-24", "EARS-8"],
  })
  async create(
    @Body() body: LegacyBroadcastCreateDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EventAdminDetail> {
    const detail = await this.events.createLegacyBroadcast(body);
    void reply.header("etag", taxonomyETag(detail.version));
    return detail;
  }
}
