import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  PROBLEM_TYPE_BASE,
  resolveTraceId,
} from "../taxonomy/taxonomy.errors.js";
import { SpecialtyError } from "./specialties.errors.js";

/**
 * Scoped exception filter for the 017 storefront controllers (017-design §7).
 * Deliberately NOT global, for the same reason the 012 filter is not: reshaping
 * responses on live routes this slice does not own would be an unrequested
 * behaviour change. `@UseFilters` on the storefront controllers keeps the blast
 * radius to the routes 017 owns.
 *
 * A non-`SpecialtyError` escapee is logged and returned as an opaque 500 problem
 * — never a stack trace, an ORM message or a table name on the wire.
 */
@Catch()
export class SpecialtyProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(SpecialtyProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const traceId = resolveTraceId(req);

    if (exception instanceof SpecialtyError) {
      const body = exception.toProblemDetails(traceId, req.url);
      void reply
        .status(body.status)
        .header("content-type", "application/problem+json")
        .send(body);
      return;
    }

    this.logger.error(
      `unclassified storefront specialty failure (traceId=${traceId})`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    void reply
      .status(500)
      .header("content-type", "application/problem+json")
      .send({
        type: `${PROBLEM_TYPE_BASE}/internal`,
        title: "Internal error",
        status: 500,
        traceId,
        instance: req.url,
      });
  }
}
