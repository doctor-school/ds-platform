import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { IdempotencyService } from "./idempotency.service.js";
import {
  PROBLEM_TYPE_BASE,
  resolveTraceId,
  TaxonomyError,
  toProblemDetails,
} from "./taxonomy.errors.js";

/**
 * Scoped exception filter for the 012 controllers (EARS-16). Deliberately NOT
 * global: 007's admin surface has its own established response shape, and
 * silently reshaping it from a 012 slice would be an unrequested behaviour change
 * on live routes. Applied with `@UseFilters` on the taxonomy controllers, the
 * blast radius is exactly the routes this spec owns.
 *
 * It is also the single place a DETERMINISTIC post-record refusal is fenced-stored
 * (§6 bullet 3 / EARS-17). That belongs here rather than at the throw site for one
 * reason: the bytes stored must be the bytes sent. The filter builds the Problem
 * Details exactly once — including its `traceId` and `instance` — stores them, and
 * then writes the same object to the wire, so a replay cannot differ from the
 * original by a regenerated field.
 *
 * A store failure never suppresses the response: it is logged, the record stays
 * `processing`, and the request degrades to §6's takeover-eligible behaviour (a
 * later retry re-runs the command) instead of losing the answer to this caller.
 *
 * A non-`TaxonomyError` escapee is mapped by status: the 011 guard's own 401/403
 * become `ADMIN_SESSION_REQUIRED` / `PLATFORM_ADMIN_REQUIRED`, and anything
 * unclassified is logged and returned as an opaque 500 problem — never a stack
 * trace or an ORM message on the wire.
 */
@Catch()
export class TaxonomyProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(TaxonomyProblemFilter.name);

  constructor(
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const traceId = resolveTraceId(req);
    const instance = req.url;

    if (exception instanceof TaxonomyError) {
      const body = toProblemDetails(exception.errorCode, traceId, {
        detail: exception.detail,
        instance,
        errors: exception.fieldErrors,
      });
      // Fenced-store the deterministic outcome BEFORE answering, so the record
      // and the caller cannot disagree about what happened.
      if (exception.replayLease) {
        try {
          await this.idempotency.storeTerminalOutcome(exception.replayLease, {
            status: body.status,
            body,
          });
        } catch (err) {
          this.logger.error(
            `could not fence-store the ${exception.errorCode} outcome of idempotency record ${exception.replayLease.key}; it stays takeover-eligible`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
      void reply
        .status(body.status)
        .header("content-type", "application/problem+json")
        .send(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const mapped =
        status === 401
          ? "ADMIN_SESSION_REQUIRED"
          : status === 403
            ? "PLATFORM_ADMIN_REQUIRED"
            : status === 404
              ? "RESOURCE_NOT_FOUND"
              : status === 415
                ? "UNSUPPORTED_MEDIA_TYPE"
                : status === 400
                  ? "VALIDATION_FAILED"
                  : null;
      if (mapped) {
        const body = toProblemDetails(mapped, traceId, { instance });
        void reply
          .status(body.status)
          .header("content-type", "application/problem+json")
          .send(body);
        return;
      }
    }

    this.logger.error(
      `unclassified taxonomy failure (traceId=${traceId})`,
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
        instance,
      });
  }
}
