import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiQuery,
  getSchemaPath,
} from "@nestjs/swagger";
import {
  MONTH_PARAM,
  type MonthBroadcastEntry,
  type MonthlyEventCount,
  type ParticipationCta,
  type PublicEventPage,
  type PublicEventListingPage,
  PublicEventListingQuerySchema,
  type UpcomingBroadcastCard,
  YEAR_PARAM,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { EventsService } from "./events.service.js";
import { InvalidEventListingCursorError } from "./events.service.js";
import {
  MonthBroadcastListDto,
  ParticipationCtaDto,
  PublicEventListingPageDto,
  UpcomingBroadcastListDto,
} from "./events.dto.js";
import type { ParticipationRoutes } from "./participation-cta.resolver.js";
import { ParticipationService } from "./participation.service.js";

/**
 * 020 EARS-1 / LD-1 (#1764) — the ACADEMY host's route table, the only thing
 * this host contributes to the shared participation policy. These are the paths
 * `academy.doctor.school` actually serves today: the event page under
 * `/webinars/<slug>` (004), the shipped 003 registration entry `/register` the
 * guest «Участвовать" handoff already routes through, and the 006 room at
 * `/webinars/<slug>/room`. The policy itself lives in
 * `participation-cta.resolver.ts` and is identical for both hosts.
 */
const ACADEMY_ROUTES: ParticipationRoutes = {
  eventPath: (slug) => `/webinars/${encodeURIComponent(slug)}`,
  registrationEntry: "/register",
  roomPath: (slug) => `/webinars/${encodeURIComponent(slug)}/room`,
};

/**
 * 004 public event read surface — the read side of the webinar aggregate (004
 * design §4). `GET /v1/public/events/:idOrSlug` is the first **public**
 * (unauthenticated) classified endpoint in the webinar domain: a
 * sponsor-distributed link resolves to the full publish-safe `PublicEventPage`
 * server-side for ANY recipient, with no cookie required and no per-session
 * variation — a guest and a logged-in principal receive byte-for-byte the same
 * body (EARS-1). `@Public()` tells the 003 authentication layer to skip the
 * subject requirement; `@Authz({ access: "public" })` is the SSOT the global
 * guard, the completeness gate, and the matrix all read (EARS-10).
 *
 * Visibility policy lives in the service (004 design §2): `draft`/unknown →
 * 404; `published`/`live`/`ended`/`hidden` → 200 (a hidden link degrades to
 * a public notice body, never a dead 404 — EARS-5). Event authoring and the
 * lifecycle transitions that move the state are feature 007; 004 reads the state
 * they leave (seam → parent #549).
 *
 * Two routes: the single event page (`GET /v1/public/events/:idOrSlug`, EARS-1)
 * and the upcoming-broadcasts listing (`GET /v1/public/events`, EARS-7) — the
 * portal's `/webinars` listing reads the latter. Both are classified public with
 * the identical publish-safe posture (EARS-10).
 */
@Controller({ path: "public/events", version: "1" })
export class EventsPublicController {
  constructor(
    private readonly events: EventsService,
    private readonly participation: ParticipationService,
  ) {}

  /**
   * 004 EARS-7 + EARS-15 — the bare-path public read (`GET /v1/public/events`).
   * Two shapes off one route:
   * - no query → the wave-1 upcoming-broadcasts listing (`UpcomingBroadcastCard[]`):
   *   `published`/`live` events at or after the air-window cutoff, nearest air date
   *   first; an empty result is a valid `200 []` (EARS-7/EARS-11).
   * - `?month=YYYY-MM` → the month-grid projection (`MonthBroadcastEntry[]`,
   *   EARS-15): every publish-visible (`published`/`live`/`ended`) event whose
   *   start instant falls in the requested МСК month, INCLUDING the month's
   *   already-past events, ordered nearest first; an empty month is a valid
   *   `200 []`. A malformed `month` is a 400 before any read.
   *
   * Public + cacheable like the event page (no per-session variation). Placed
   * before `:idOrSlug` so the bare-path reads are unambiguous.
   */
  @Get()
  @ApiQuery({ name: "month", required: false })
  @ApiQuery({ name: "timeframe", required: false, enum: ["upcoming", "past"] })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiExtraModels(
    UpcomingBroadcastListDto,
    MonthBroadcastListDto,
    PublicEventListingPageDto,
  )
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(UpcomingBroadcastListDto) },
        { $ref: getSchemaPath(MonthBroadcastListDto) },
        { $ref: getSchemaPath(PublicEventListingPageDto) },
      ],
    },
  })
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-7", "EARS-10", "EARS-11", "EARS-15"],
  })
  list(
    @Query("month") month?: string,
    @Query("timeframe") timeframe?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<
    UpcomingBroadcastCard[] | MonthBroadcastEntry[] | PublicEventListingPage
  > {
    if (timeframe !== undefined) {
      const parsed = PublicEventListingQuerySchema.safeParse({
        timeframe,
        limit,
        cursor,
      });
      if (!parsed.success) {
        throw new BadRequestException("invalid public event listing query");
      }
      return this.events
        .listPublicEvents(parsed.data)
        .catch((error: unknown) => {
          if (error instanceof InvalidEventListingCursorError) {
            throw new BadRequestException(error.message);
          }
          throw error;
        });
    }
    if (month === undefined) return this.events.listUpcoming();
    // EARS-15: the boundary rejects a malformed month structurally (400) before
    // any read — the shape SSOT is `MONTH_PARAM` (@ds/schemas).
    if (!MONTH_PARAM.test(month)) {
      throw new BadRequestException("month must be formatted YYYY-MM");
    }
    return this.events.listMonthBroadcasts(month);
  }

  /**
   * 004 EARS-16 — the month-picker counts (`GET /v1/public/events/month-counts`,
   * the `?year=YYYY` selector). Returns exactly 12 rows `{ month, count }` for the
   * requested year, counting only publish-visible (`published`/`live`/`ended`)
   * events grouped by МСК calendar month; months with no events carry `count: 0`.
   * A missing/malformed `year` is a 400 before any read. Public + cacheable like
   * the sibling reads. MUST be declared BEFORE `:idOrSlug` or the param route
   * would capture the literal `month-counts` segment.
   */
  @Get("month-counts")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-16", "EARS-10"],
  })
  monthCounts(@Query("year") year?: string): Promise<MonthlyEventCount[]> {
    if (year === undefined || !YEAR_PARAM.test(year)) {
      throw new BadRequestException("year must be formatted YYYY");
    }
    return this.events.monthlyEventCounts(year);
  }

  @Get(":idOrSlug")
  @Public()
  // Public and cacheable — no per-user variation, so a shared/edge cache is
  // safe. The short max-age bounds how long a just-transitioned event can look
  // stale against a lifecycle flip (004 design §4).
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    // EARS-5: a hidden direct link resolves to a 200 hidden-notice body on
    // this same route (never a 404/redirect) — its contract is pinned here too.
    tests: ["EARS-1", "EARS-5", "EARS-10"],
  })
  async page(@Param("idOrSlug") idOrSlug: string): Promise<PublicEventPage> {
    const found = await this.events.publicEventPage(idOrSlug);
    // A draft/unknown event is not-found — indistinguishable from a bad id, so a
    // hidden draft leaks no "exists but private" oracle (EARS-6, EARS-10).
    if (!found) throw new NotFoundException("event not found");
    return found;
  }

  /**
   * 020 EARS-1 (#1764) — `GET /v1/public/events/:idOrSlug/participation`, the
   * Academy host's thin route over the ONE participation policy (LD-2). Its
   * doctor twin is `GET /v1/storefront/doctor/events/:idOrSlug/participation`;
   * both call the same {@link ParticipationService} and differ only in the route
   * table they hand it.
   *
   * `@Public()` with an OPTIONAL principal: a guest must be told «Участвовать»
   * rather than 401, and a signed-in doctor must be told «Вы записаны» — the
   * 003 session hook populates the subject when a session rides the request and
   * leaves it absent otherwise, so one route serves both without a second
   * authenticated variant.
   *
   * The answer VARIES per viewer, so unlike the page read it is `no-store`: a
   * shared cache must never hand one doctor's registered state to another
   * visitor. That per-viewer variance is exactly why the CTA is this sibling
   * read rather than a field of the `public, max-age=30` page body, whose
   * guest/principal byte-identity (004 EARS-1) stays intact.
   */
  @Get(":idOrSlug/participation")
  @Public()
  @Header("Cache-Control", "private, no-store")
  @ApiOkResponse({ type: ParticipationCtaDto })
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
    const cta = await this.participation.cta(idOrSlug, ACADEMY_ROUTES, sub);
    // A draft/unknown event is not-found here for the same reason it is on the
    // page read — this route must not become the «exists but private» oracle
    // that read refuses to be (004 EARS-6).
    if (!cta) throw new NotFoundException("event not found");
    return cta;
  }
}
