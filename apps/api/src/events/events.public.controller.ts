import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
} from "@nestjs/common";
import type { PublicEventPage } from "@ds/schemas";
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
 * they leave (seam → parent #549). The upcoming-broadcasts listing endpoint is
 * the sibling handler EARS-7 (out of this iteration's scope).
 */
@Controller({ path: "public/events", version: "1" })
export class EventsPublicController {
  constructor(private readonly events: EventsService) {}

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
    tests: ["EARS-1", "EARS-10"],
  })
  async page(@Param("idOrSlug") idOrSlug: string): Promise<PublicEventPage> {
    const found = await this.events.publicEventPage(idOrSlug);
    // A draft/unknown event is not-found — indistinguishable from a bad id, so a
    // hidden draft leaks no "exists but private" oracle (EARS-6, EARS-10).
    if (!found) throw new NotFoundException("event not found");
    return found;
  }
}
