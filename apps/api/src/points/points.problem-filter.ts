import { type ArgumentsHost, Catch } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TaxonomyProblemFilter } from "../taxonomy/index.js";
import { resolveTraceId } from "../taxonomy/taxonomy.errors.js";
import { PointsLedgerError } from "./points.errors.js";

/**
 * Scoped RFC 7807 filter for the 025 admin routes. A `PointsLedgerError`
 * answers with the engine's own body (`points-*` type, `errorCode`, field
 * errors); everything else — the 011 admin-session/authority refusals, a
 * malformed body, an unclassified failure — takes the shared 012 admin path
 * unchanged, so the admin surface keeps one problem shape.
 */
@Catch()
export class PointsProblemFilter extends TaxonomyProblemFilter {
  override async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    if (!(exception instanceof PointsLedgerError)) {
      return super.catch(exception, host);
    }
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const body = exception.toProblemDetails(resolveTraceId(req), req.url);
    void reply
      .status(body.status)
      .header("content-type", "application/problem+json")
      .send(body);
  }
}
