import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseFilters,
} from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import {
  type DoctorEventsFeed,
  type DoctorEventsMonthGrid,
  type EventPageView,
  type ParticipationCta,
  parseDoctorEventsFeedQuery,
  parseDoctorEventsMonthQuery,
  type RawQueryValue,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { EventsService } from "../events/events.service.js";
import { EventPageViewDto, ParticipationCtaDto } from "../events/events.dto.js";
import type { AroundEventRoutes } from "../events/around-event.resolver.js";
import { resolveAroundEvent } from "../events/around-event.resolver.js";
import type { ParticipationRoutes } from "../events/participation-cta.resolver.js";
import { ParticipationService } from "../events/participation.service.js";
import {
  DoctorEventsFeedDto,
  DoctorEventsMonthGridDto,
} from "./doctor-events.dto.js";
import { DoctorEventsService } from "./doctor-events.service.js";
import { SpecialtyProblemFilter } from "./specialties.problem-filter.js";
import { readSpecialtyChoiceCookie } from "./specialty-choice.cookie.js";

/**
 * 019 EARS-3 (#1518) — `GET /v1/storefront/doctor/events`, the day-grouped,
 * specialty-targeted feed of the doctor storefront (019-design §7) — and
 * EARS-4 (#1519) `GET …/events/month`, the `MonthGrid` projection of that same
 * read. Both live on ONE controller because they are one host projection with
 * two shapes (LD-3): same targeting, same cookie, same cache posture. The month
 * route serves BOTH the grid standing beside the feed (#1516) and the dedicated
 * calendar page (#1520) — one contract, two compositions.
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
/**
 * 020 EARS-1 / LD-1 (#1764) — the DOCTOR host's route table, the only thing this
 * host contributes to the shared participation policy (the policy itself is
 * `apps/api/src/events/participation-cta.resolver.ts`, one implementation for
 * both storefronts).
 *
 * `roomPath` is `null`: the doctor room is the thin route over the shared room
 * UI unit extracted under #1722, which does not exist yet. A registered doctor
 * on a live event therefore still resolves to `enter-room` — the ACTION is a
 * fact of the event and the registration, not of the front-end — with `href:
 * null`, so the host renders the state and no link. EARS-4 requires an
 * impossible affordance to be ABSENT rather than dead; linking into a route that
 * is not mounted would be precisely the dead end it forbids. When #1722 lands,
 * this ONE line changes and nothing else does.
 */
const DOCTOR_ROUTES: ParticipationRoutes = {
  eventPath: (slug) => `/events/${encodeURIComponent(slug)}`,
  registrationEntry: "/register",
  roomPath: null,
};

/**
 * 020 EARS-2 (#1765) — the DOCTOR host's «вокруг события» table, the twin of
 * the Academy one. Every entry is `null` for the same reason: doctor.school
 * serves `/`, `/events`, `/events/:slug` and `/register` and nothing else —
 * no school page, no expert page, no community screen (`#d-school` /
 * `#d-community`, `specs/product/two-site-ia/functional-map-ru.md` L42, L46,
 * L106, L123). A `null` path drops the key, so this page renders plain text
 * where the link will one day be: absent, never dead (EARS-2 / EARS-19).
 */
const DOCTOR_AROUND_ROUTES: AroundEventRoutes = {
  // No public school page on doctor.school yet (#d-school, unbuilt).
  schoolPath: () => null,
  // No public expert page on doctor.school yet (admin CRUD is not a surface).
  expertPath: () => null,
  // No community screen on doctor.school yet (#d-community, unbuilt).
  communityPath: () => null,
};

@Controller({ path: "storefront/doctor/events", version: "1" })
@UseFilters(SpecialtyProblemFilter)
export class DoctorEventsPublicController {
  constructor(
    @Inject(DoctorEventsService)
    private readonly feed: DoctorEventsService,
    // 020 LD-1: the doctor host reads the ONE public event projection and the
    // ONE participation policy of feature 004/020. It owns no read model, no
    // second projection and no storefront-local mapping — if it did, the two
    // hosts could disagree about the same event, which is the whole defect
    // EARS-1 exists to prevent.
    @Inject(EventsService)
    private readonly events: EventsService,
    @Inject(ParticipationService)
    private readonly participation: ParticipationService,
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

  /**
   * `GET /v1/storefront/doctor/events/month` — the `MonthGrid` of EARS-4.
   *
   * There is no `view` query parameter and no `tense`: under F-019-2 Б the grid
   * and the feed render together (no «Неделя / Месяц» switch is built), and
   * release 1 reads «Будущие» only per LD-10. A malformed `month` is a 400
   * Problem Details at the boundary — unlike the feed's `to=`, a month cannot be
   * clamped to something honest, since there is no nearest month a reader could
   * be assumed to have meant.
   */
  @Get("month")
  @ApiQuery({
    name: "month",
    required: false,
    description: "ISO YYYY-MM; defaults to the current МСК month",
  })
  @ApiQuery({ name: "format", required: false, isArray: true, type: String })
  @ApiQuery({ name: "kind", required: false, isArray: true, type: String })
  @ApiQuery({ name: "specialty", required: false, isArray: true, type: String })
  @ApiQuery({ name: "city", required: false, isArray: true, type: String })
  @ApiQuery({ name: "nmo", required: false, type: Boolean })
  @ApiQuery({ name: "free", required: false, type: Boolean })
  @ApiQuery({ name: "q", required: false })
  @ApiOkResponse({ type: DoctorEventsMonthGridDto })
  @Public()
  @Header("Cache-Control", "private, max-age=30")
  @Header("Vary", "Cookie")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-4"],
  })
  month(
    @Query() query: Record<string, RawQueryValue>,
    @Headers("cookie") cookie?: string,
  ): Promise<DoctorEventsMonthGrid> {
    const parsed = parseDoctorEventsMonthQuery(query ?? {});
    if (!parsed.success) {
      throw new BadRequestException("invalid doctor events month query");
    }

    return this.feed.month({
      query: parsed.data,
      specialtyReference: readSpecialtyChoiceCookie(cookie),
    });
  }

  /**
   * 020 EARS-1 (#1764) — `GET /v1/storefront/doctor/events/:idOrSlug`, the
   * doctor storefront's read of ONE event.
   *
   * It delegates to feature 004's `EventsService.publicEventPage` and returns
   * its result unchanged: no second read model, no second projection, no
   * storefront-local mapping. That is what makes «the two hosts return
   * content-identical bodies for the same event» a structural property rather
   * than a test that has to be re-proved after every edit — there is exactly one
   * body to return. The storefront IS the envelope (header, nav, copy defaults),
   * and the envelope is the host's, not a field of the read.
   *
   * Public and cacheable on the same terms as the Academy route: the body has no
   * per-viewer variation (the per-viewer part is the sibling `…/participation`
   * read), so a shared cache is safe. Declared AFTER `@Get("month")` so the
   * literal segment keeps winning over this parameter.
   */
  @Get(":idOrSlug")
  @ApiOkResponse({ type: EventPageViewDto })
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-1"],
  })
  async event(@Param("idOrSlug") idOrSlug: string): Promise<EventPageView> {
    const found = await this.events.publicEventPage(idOrSlug);
    // The visibility policy is 004's and is applied in the service: a `draft` or
    // unknown event is not-found on BOTH hosts identically, so the doctor
    // storefront cannot become the oracle the Academy route refuses to be
    // (004 EARS-6).
    if (!found) throw new NotFoundException("event not found");
    // 020 EARS-2: the ONE link policy, handed THIS host's route table. Both
    // hosts resolve every key absent today, so the two bodies stay identical.
    return { ...found, links: resolveAroundEvent(found, DOCTOR_AROUND_ROUTES) };
  }

  /**
   * 020 EARS-1 / LD-2 (#1764) — `GET /v1/storefront/doctor/events/:idOrSlug/participation`,
   * the doctor twin of the Academy participation route. Same
   * {@link ParticipationService}, same policy function, same six actions; the
   * only difference is {@link DOCTOR_ROUTES}, this host's own paths.
   *
   * `@Public()` with an OPTIONAL principal (a guest is told «Участвовать», not
   * 401) and `no-store`, because the answer varies per viewer.
   */
  @Get(":idOrSlug/participation")
  @ApiOkResponse({ type: ParticipationCtaDto })
  @Public()
  @Header("Cache-Control", "private, no-store")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-1"],
  })
  async participationCta(
    @Param("idOrSlug") idOrSlug: string,
    @Req() req: FastifyRequest,
  ): Promise<ParticipationCta> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    const cta = await this.participation.cta(idOrSlug, DOCTOR_ROUTES, sub);
    if (!cta) throw new NotFoundException("event not found");
    return cta;
  }
}
