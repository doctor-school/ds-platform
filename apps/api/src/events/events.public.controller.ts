import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
} from "@nestjs/common";
import type { PublicEventPage, UpcomingBroadcastCard } from "@ds/schemas";
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
   * 004 EARS-7 — the upcoming-broadcasts listing (`GET /v1/public/events`, the
   * `?upcoming` selector). Returns the `UpcomingBroadcastCard[]` projection —
   * `published`/`live` events at or after the air-window cutoff, ordered nearest
   * air date first. Wave-1 ships only this listing (no facets / paging / month /
   * search — named out-of-scope). Public + cacheable like the event page; an
   * empty result is a valid `200 []` (the portal renders the empty-state,
   * EARS-11). Placed before `:idOrSlug` so the bare-path listing is unambiguous.
   */
  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-7", "EARS-10"],
  })
  listUpcoming(): Promise<UpcomingBroadcastCard[]> {
    return this.events.listUpcoming();
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
