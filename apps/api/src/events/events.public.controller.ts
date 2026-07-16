import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import {
  MONTH_PARAM,
  type MonthBroadcastEntry,
  type MonthlyEventCount,
  type PublicEventPage,
  type UpcomingBroadcastCard,
  YEAR_PARAM,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { EventsService } from "./events.service.js";

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
 * 404; `published`/`live`/`ended`/`archived` → 200 (an archived link degrades to
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
  constructor(private readonly events: EventsService) {}

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
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-7", "EARS-10", "EARS-15"],
  })
  list(
    @Query("month") month?: string,
  ): Promise<UpcomingBroadcastCard[] | MonthBroadcastEntry[]> {
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
    // EARS-5: an archived direct link resolves to a 200 archived-notice body on
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
}
