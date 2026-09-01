import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
} from "@nestjs/common";
import type { EventPlayback } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  PlaybackEventNotFoundError,
  RecordingsPlaybackService,
} from "./recordings.playback.service.js";

/**
 * 014 EARS-5 (#1343) — `GET /v1/events/:idOrSlug/recordings`, the authenticated
 * half of the login gate (014-design §5, §10).
 *
 * This is the ONE source-bearing response in feature 014, and the gate that
 * protects it is SERVER-SIDE by construction: an unauthenticated caller is
 * refused by the global `AuthzGuard` with a 401 before this handler runs, so the
 * playable source is never assembled, never serialized and never sent. Hiding a
 * player in CSS, or returning a source the client declines to render, would each
 * be the defect this route exists to make impossible.
 *
 * The classification is `access: authenticated` with the v1 authenticated
 * baseline role and NOTHING else — `check: "fast-path"`, no `objectAttrs`, no
 * resource-scoped policy. That is the whole point of the scenario «any account
 * may watch any published recording»: unlike the 006 room gate next door, this
 * route evaluates no registration, no attendance and no 014-specific role. If a
 * future requirement adds one, it changes here and in the matrix together.
 *
 * It shares the `events` controller path with 005/006 rather than living under
 * `/v1/public/…`: the resource is the event's recordings, and the URL says so.
 * Per-caller ⇒ `no-store`, never shared-cacheable — a CDN holding this body for
 * the next visitor would hand a guest exactly what the gate withheld.
 */
@Controller({ path: "events", version: "1" })
export class RecordingsPlaybackController {
  // Explicit @Inject token — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes` (apps/api/src/taxonomy/README.md).
  constructor(
    @Inject(RecordingsPlaybackService)
    private readonly playback: RecordingsPlaybackService,
  ) {}

  @Get(":idOrSlug/recordings")
  @Header("Cache-Control", "no-store")
  @Authz({
    access: "authenticated",
    // The v1 authenticated baseline (authz.types §ROLES), not a 014 role check:
    // every doctor account carries it, so «signed in» and «may watch» are the
    // same condition — which is exactly what EARS-5 asks for.
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-5"],
  })
  async read(@Param("idOrSlug") idOrSlug: string): Promise<EventPlayback> {
    try {
      return await this.playback.playback(idOrSlug);
    } catch (err) {
      // A draft event and an unknown key are the SAME 404: authenticating must
      // not turn this route into an oracle that confirms a hidden announcement.
      if (err instanceof PlaybackEventNotFoundError) {
        throw new NotFoundException("event not found");
      }
      throw err;
    }
  }
}
