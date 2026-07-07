import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { EventRegistrationState } from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  EventNotRegistrableError,
  RegistrationEventNotFoundError,
  RegistrationService,
  UnknownSubjectError,
} from "./registration.service.js";

/**
 * 005 registration surface — the write side of webinar registration + the
 * per-user state read (design §5). These are the **first authenticated
 * `doctor_guest`** endpoints in the webinar domain (004 added the public ones):
 *
 * - `POST /v1/events/:idOrSlug/registration` → `RegisterForEvent` (EARS-1): an
 *   authenticated doctor registers for a `published`/`live` event in one action;
 *   the response is the registered `EventRegistrationState` so the event page
 *   flips immediately (no confirmation round-trip).
 * - `GET /v1/events/:idOrSlug/registration` → `EventRegistrationState` (EARS-1
 *   flip / EARS-4): the caller's own `{ registered, registeredAt? }` state.
 *
 * Both carry the EARS-10 classification `authenticated` / `doctor_guest` /
 * `fast-path`: the global `AuthzGuard` refuses an unauthenticated caller (401)
 * and any non-`doctor_guest` role (403) before the handler runs — never a silent
 * success. The per-user read is private (never shared-cacheable) and returns only
 * the caller's own state. Gating reads the single `EventLifecycleState` (007,
 * read-only); a non-`published`/`live` state is a 409, a missing event a 404.
 */
@Controller({ path: "events", version: "1" })
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post(":idOrSlug/registration")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    // A `doctor_guest` domain write, not an auth/security event — no
    // AuthAuditLog emission (low-stakes). The registration's own terminal
    // `audit_ledger` row (design §5) is a separate ADR-0003 §6 obligation landed
    // with the durable-record handler (EARS-8), not this classification field.
    audit: "low-stakes",
    tests: ["EARS-1", "EARS-10"],
  })
  register(
    @Param("idOrSlug") idOrSlug: string,
    @Req() req: FastifyRequest,
  ): Promise<EventRegistrationState> {
    return this.run(idOrSlug, req, (slug, sub) =>
      this.registration.register(slug, sub),
    );
  }

  @Get(":idOrSlug/registration")
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-1", "EARS-10"],
  })
  state(
    @Param("idOrSlug") idOrSlug: string,
    @Req() req: FastifyRequest,
  ): Promise<EventRegistrationState> {
    return this.run(idOrSlug, req, (slug, sub) =>
      this.registration.state(slug, sub),
    );
  }

  /**
   * Shared body: resolve the acting doctor's Zitadel `sub` off the request (the
   * 003 session hook attaches it; the `AuthzGuard` has already refused any
   * unauthenticated caller — EARS-10), run the command/read, and map the domain
   * errors to their HTTP status — a missing event to a 404, a non-registrable
   * state to a 409, an unresolved subject to a 401.
   */
  private async run(
    idOrSlug: string,
    req: FastifyRequest,
    op: (idOrSlug: string, sub: string) => Promise<EventRegistrationState>,
  ): Promise<EventRegistrationState> {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    // The guard guarantees an authenticated subject; a null sub is defence in
    // depth, never a silent success (EARS-10).
    if (!sub) throw new UnauthorizedException("authentication required");
    try {
      return await op(idOrSlug, sub);
    } catch (err) {
      if (err instanceof RegistrationEventNotFoundError) {
        throw new NotFoundException("event not found");
      }
      if (err instanceof EventNotRegistrableError) {
        throw new ConflictException({
          message: "registration is not offered in the event's current state",
          state: err.state,
        });
      }
      if (err instanceof UnknownSubjectError) {
        throw new UnauthorizedException("authentication required");
      }
      throw err;
    }
  }
}
