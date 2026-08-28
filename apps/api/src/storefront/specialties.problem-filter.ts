import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  PROBLEM_TYPE_BASE,
  resolveTraceId,
  TaxonomyError,
  toProblemDetails,
} from "../taxonomy/taxonomy.errors.js";
import { SpecialtyError } from "./specialties.errors.js";
import { IdempotencyService } from "../taxonomy/idempotency.service.js";

/**
 * Scoped exception filter for the 017 storefront controllers (017-design §7).
 * Deliberately NOT global, for the same reason the 012 filter is not: reshaping
 * responses on live routes this slice does not own would be an unrequested
 * behaviour change. `@UseFilters` on the storefront controllers keeps the blast
 * radius to the routes 017 owns.
 *
 * Three tiers, in order:
 *
 *  1. `SpecialtyError` — the slice's own taxonomy, wire body built by the error.
 *  2. Any other framework `HttpException` below 500 — a DELIBERATE refusal
 *     (`BadRequestException` on a malformed `q`, EARS-5) that the handler already
 *     classified. It is re-shaped as RFC-7807 with its OWN status and a stable,
 *     non-disclosing title; it is NOT logged at ERROR level. Collapsing these
 *     into the 500 branch would both lie to the client about whose fault it is
 *     and let any anonymous visitor of a `@Public()` route mint ERROR log lines.
 *  3. Everything else (and any 5xx `HttpException`) — logged and returned as an
 *     opaque 500 problem, never a stack trace, an ORM message or a table name.
 */
/**
 * Stable titles for the client-error statuses these routes can actually raise.
 * Deliberately NOT the exception's own message: an English message written at a
 * throw site is not a contract, and echoing it could carry the submitted value.
 */
const CLIENT_ERROR_TITLE: Readonly<Record<number, string>> = {
  400: "Bad request",
  404: "Not found",
  422: "Unprocessable entity",
};

@Catch()
export class SpecialtyProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(SpecialtyProblemFilter.name);

  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const traceId = resolveTraceId(req);

    if (exception instanceof SpecialtyError) {
      const body = exception.toProblemDetails(traceId, req.url);
      if (exception.replayLease) {
        try {
          await this.idempotency.storeTerminalOutcome(exception.replayLease, {
            status: body.status,
            body,
          });
        } catch (error) {
          this.logger.error(
            `could not fence-store specialty refusal for idempotency record ${exception.replayLease.key}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      void reply
        .status(body.status)
        .header("content-type", "application/problem+json")
        .send(body);
      return;
    }

    if (exception instanceof TaxonomyError) {
      const body = toProblemDetails(exception.errorCode, traceId, {
        detail: exception.detail,
        instance: req.url,
        errors: exception.fieldErrors,
      });
      void reply
        .status(body.status)
        .header("content-type", "application/problem+json")
        .send(body);
      return;
    }

    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      const title = CLIENT_ERROR_TITLE[status] ?? "Request cannot be processed";
      void reply
        .status(status)
        .header("content-type", "application/problem+json")
        .send({
          type: `${PROBLEM_TYPE_BASE}/${title.toLowerCase().replace(/\s+/g, "-")}`,
          title,
          status,
          traceId,
          instance: req.url,
        });
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
