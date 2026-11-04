import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Req,
  UseFilters,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import type { FeedEvents, SpecialtyFeed } from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { FeedEventsDto, SpecialtyFeedDto } from "./specialty-feed.dto.js";
import { SpecialtyFeedService } from "./specialty-feed.service.js";
import { SpecialtyProblemFilter } from "./specialties.problem-filter.js";

/**
 * 018 EARS-1 (#1496) / EARS-4 (#1499) — the specialty feed reads
 * (018-design §7): the envelope and one read per connected block.
 *
 * Public (ADR-0001): a guest reads the release-1 feed in full (EARS-11). The
 * specialty is the PATH, never the remembered cookie — a feed is a page about
 * a specialty, so the body varies with the URL alone and both reads are
 * cacheable. The envelope's `viewer.loggedIn` is the one per-viewer field, so
 * the envelope is `private`; the events block carries no per-viewer field.
 * Errors leave as RFC 7807 through the family's `SpecialtyProblemFilter`.
 */
@Controller({ path: "storefront/feed", version: "1" })
@UseFilters(SpecialtyProblemFilter)
export class SpecialtyFeedPublicController {
  constructor(
    @Inject(SpecialtyFeedService)
    private readonly feed: SpecialtyFeedService,
  ) {}

  /** `GET /v1/storefront/feed/{specialty}` — the `SpecialtyFeed` envelope. */
  @Get(":specialty")
  @ApiOkResponse({ type: SpecialtyFeedDto })
  @Public()
  @Header("Cache-Control", "private, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-1"],
  })
  envelope(
    @Param("specialty") specialty: string,
    @Req() req: FastifyRequest,
  ): Promise<SpecialtyFeed> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    return this.feed.envelope({ specialty, loggedIn: Boolean(sub) });
  }

  /** `GET /v1/storefront/feed/{specialty}/events` — the nearest-events block. */
  @Get(":specialty/events")
  @ApiOkResponse({ type: FeedEventsDto })
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-4"],
  })
  events(@Param("specialty") specialty: string): Promise<FeedEvents> {
    return this.feed.events({ specialty });
  }
}
