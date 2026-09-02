import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Query,
  UseFilters,
} from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import {
  type DoctorEventsFeed,
  parseDoctorEventsFeedQuery,
  type RawQueryValue,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { DoctorEventsFeedDto } from "./doctor-events.dto.js";
import { DoctorEventsService } from "./doctor-events.service.js";
import { SpecialtyProblemFilter } from "./specialties.problem-filter.js";
import { readSpecialtyChoiceCookie } from "./specialty-choice.cookie.js";

/**
 * 019 EARS-3 (#1518) — `GET /v1/storefront/doctor/events`, the day-grouped,
 * specialty-targeted feed of the doctor storefront (019-design §7).
 *
 * ## Host projection, not a second engine
 *
 * The controller does three things and no more: it decodes the URL with the ONE
 * shared query codec (`parseDoctorEventsFeedQuery` in `@ds/schemas`), it names
 * the viewer's remembered specialty from 017's anonymous-session cookie, and it
 * hands both to {@link DoctorEventsService}. Selection, lifecycle and publish
 * visibility stay with 007's aggregate; targeting stays with 017/018's managed
 * rows. Academy's `/v1/public/events` remains its own host projection over the
 * same owners (019-design §1.1, EARS-15).
 *
 * ## Public and session-optional
 *
 * `@Public()` + `@Authz({ access: "public" })`: EARS-12 requires the feed to be
 * FULLY readable with no account, and only the action on a card to need one. The
 * cookie is read when present and its absence simply yields the untargeted read
 * — it never gates the response and no gated payload is delivered to be hidden
 * client-side. A remembered reference that has since left the managed book is
 * therefore DEGRADED to the untargeted read in {@link DoctorEventsService},
 * not refused; the `SpecialtyProblemFilter` here matches the three sibling
 * storefront controllers, so anything this family does still throw leaves as
 * RFC 7807 `application/problem+json`.
 *
 * The response varies with that cookie, so the cache is `private` — a shared
 * cache must never hand one doctor's targeted feed to another visitor.
 */
@Controller({ path: "storefront/doctor/events", version: "1" })
@UseFilters(SpecialtyProblemFilter)
export class DoctorEventsPublicController {
  constructor(
    @Inject(DoctorEventsService)
    private readonly feed: DoctorEventsService,
  ) {}

  /** `GET /v1/storefront/doctor/events` — the bounded-horizon `DayGroup[]` feed. */
  @Get()
  @ApiQuery({ name: "day", required: false })
  @ApiQuery({ name: "tense", required: false, enum: ["upcoming", "past"] })
  @ApiQuery({ name: "from", required: false })
  @ApiQuery({ name: "to", required: false })
  @ApiQuery({ name: "format", required: false, isArray: true, type: String })
  @ApiQuery({ name: "kind", required: false, isArray: true, type: String })
  @ApiQuery({ name: "specialty", required: false, isArray: true, type: String })
  @ApiQuery({ name: "city", required: false, isArray: true, type: String })
  @ApiQuery({ name: "nmo", required: false, type: Boolean })
  @ApiQuery({ name: "free", required: false, type: Boolean })
  @ApiQuery({ name: "q", required: false })
  @ApiOkResponse({ type: DoctorEventsFeedDto })
  @Public()
  @Header("Cache-Control", "private, max-age=30")
  // The read varies with the specialty cookie, so the browser cache must key on
  // it too — without this a specialty change re-serves the previous targeting
  // from the same URL for up to 30s.
  @Header("Vary", "Cookie")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-3"],
  })
  read(
    @Query() query: Record<string, RawQueryValue>,
    @Headers("cookie") cookie?: string,
  ): Promise<DoctorEventsFeed> {
    const parsed = parseDoctorEventsFeedQuery(query ?? {});
    if (!parsed.success) {
      throw new BadRequestException("invalid doctor events feed query");
    }

    return this.feed.feed({
      query: parsed.data,
      specialtyReference: readSpecialtyChoiceCookie(cookie),
    });
  }
}
