import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { type MyEvents, MyEventsQuerySchema } from "@ds/schemas";
import type { ParticipationRoutes } from "../events/participation-cta.resolver.js";
import {
  type RegistrationService,
  UnknownSubjectError,
} from "./registration.service.js";

/**
 * The ONE «Мои события» request handling both hosts' routes run (005 EARS-6;
 * 014 EARS-9; wave-2 entry gate §4.3 D8): `GET /v1/me/events` (the Academy) and
 * `GET /v1/storefront/doctor/me/events` (the doctor storefront) differ only in
 * the route table they pass — the calling host is the controller, as D5 — so
 * the subject check, the closed tab set and the 401 mapping cannot drift
 * between them.
 */
export async function serveMyEvents(
  registration: RegistrationService,
  req: FastifyRequest,
  tab: string | undefined,
  routes: ParticipationRoutes,
): Promise<MyEvents> {
  const sub = (req as { user?: { sub?: string } }).user?.sub;
  // The guard guarantees an authenticated subject; a null sub is defence in
  // depth, never a silent success (EARS-10).
  if (!sub) throw new UnauthorizedException("authentication required");
  // The closed two-tab set is the schema's (014 EARS-9). An absent `?tab=`
  // defaults to `upcoming`, so the bare `/v1/me/events` 005 shipped keeps
  // working; anything else is refused rather than coerced.
  const query = MyEventsQuerySchema.safeParse(tab === undefined ? {} : { tab });
  if (!query.success) {
    throw new BadRequestException("tab must be upcoming or recordings");
  }
  try {
    return await registration.myEvents(sub, query.data.tab, routes);
  } catch (err) {
    // An authenticated subject with no 003 mirror row cannot own registrations
    // — a 401, never a silent empty list (EARS-10).
    if (err instanceof UnknownSubjectError) {
      throw new UnauthorizedException("authentication required");
    }
    throw err;
  }
}
