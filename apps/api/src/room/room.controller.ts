import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PresenceHeartbeatAck, RoomConfig } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  RegistrationEventNotFoundError,
  UnknownSubjectError,
} from "../registration/registration.service.js";
import {
  NotRegisteredError,
  RoomEventNotFoundError,
  RoomNotLiveError,
  RoomService,
} from "./room.service.js";

/**
 * 006 room surface — the EARS-1 server-side admission gate + the `RoomConfig`
 * grant read (design §2, §7) and the EARS-4 gated heartbeat command (design §5).
 *
 * - `GET /v1/events/:idOrSlug/room` → `RoomConfig` (EARS-1): the server-issued
 *   `RoomAccess` grant, served **only** to a caller the gate admits —
 *   authenticated ∧ registered (005 `EventRoster`) ∧ event `live`. A guest, an
 *   unregistered doctor, or a non-`live` event is refused SERVER-SIDE (401 /
 *   403 / 409) and never receives room content; the three refusals drive the
 *   EARS-6 access branches (auth 003 / register 005 / not-live 004).
 * - `POST /v1/events/:idOrSlug/heartbeat` → `PresenceHeartbeatAck` (EARS-4):
 *   behind the SAME gate, appends one durable append-only presence beat
 *   `(doctor, event, instant)`; an ungated caller (401 / 403 / 409) appends
 *   NOTHING (EARS-8). Presence is server-authoritative — the instant is
 *   server-stamped, never a client-trusted count.
 *
 * Both are the **`policy` auth_check** in the webinar domain (004 added the
 * `public` reads, 005 the `fast-path` `doctor_guest` writes/reads): the
 * registration-and-live gate is a resource-scoped policy evaluation beyond a
 * role fast-path (EARS-8; design §2). The global `AuthzGuard` refuses an
 * unauthenticated caller (401) and any non-`doctor_guest` role (403) before the
 * handler runs — the role is a necessary precondition — and each handler
 * evaluates the resource-scoped condition (registered ∧ live) via
 * {@link RoomService}, refusing server-side. Per-caller ⇒ never shared-cacheable.
 */
@Controller({ path: "events", version: "1" })
export class RoomController {
  constructor(private readonly room: RoomService) {}

  @Get(":idOrSlug/room")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    // Resource-scoped policy: role alone is necessary but not sufficient — the
    // registration-and-live gate is evaluated in RoomService (design §2). No
    // object-level ABAC predicate, so no IPolicyEngine (DSO-27) dependency.
    check: "policy",
    audit: "none",
    tests: ["EARS-1", "EARS-8"],
  })
  config(
    @Param("idOrSlug") idOrSlug: string,
    @Req() req: FastifyRequest,
  ): Promise<RoomConfig> {
    return this.gated(req, (sub) => this.room.roomConfig(idOrSlug, sub));
  }

  @Post(":idOrSlug/heartbeat")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    // Same resource-scoped policy as the config read: the registration-and-live
    // gate is evaluated in RoomService before any beat is appended (design §2,
    // §5). A beat is a low-stakes domain write, not an auth/security event — no
    // AuthAuditLog emission (the durable record IS the presence_beats row).
    check: "policy",
    audit: "none",
    tests: ["EARS-4", "EARS-8"],
  })
  heartbeat(
    @Param("idOrSlug") idOrSlug: string,
    @Req() req: FastifyRequest,
  ): Promise<PresenceHeartbeatAck> {
    return this.gated(req, (sub) => this.room.recordHeartbeat(idOrSlug, sub));
  }

  /**
   * Shared handler shell for the two gated room operations: resolve the
   * authenticated subject (the guard guarantees one; a null `sub` is fail-closed
   * defence in depth → 401, never a silent success, EARS-8), run the operation,
   * and map the domain gate errors to their HTTP refusals identically for both —
   * the config read and the heartbeat append refuse on exactly the same rule.
   */
  private async gated<T>(
    req: FastifyRequest,
    op: (sub: string) => Promise<T>,
  ): Promise<T> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    if (!sub) throw new UnauthorizedException("authentication required");
    try {
      return await op(sub);
    } catch (err) {
      // A missing event is a 404 (indistinguishable from an unknown slug).
      if (
        err instanceof RoomEventNotFoundError ||
        err instanceof RegistrationEventNotFoundError
      ) {
        throw new NotFoundException("event not found");
      }
      // An unregistered caller is refused (403) → portal routes to register (005).
      if (err instanceof NotRegisteredError) {
        throw new ForbiddenException("registration required for this room");
      }
      // A non-`live` event is refused (409) → portal shows the 004 lifecycle state.
      if (err instanceof RoomNotLiveError) {
        throw new ConflictException({
          message: "the room is not open in the event's current state",
          state: err.state,
        });
      }
      // An authenticated subject with no 003 mirror row cannot own a
      // registration — a 401, never a silent admission (EARS-8).
      if (err instanceof UnknownSubjectError) {
        throw new UnauthorizedException("authentication required");
      }
      throw err;
    }
  }
}
