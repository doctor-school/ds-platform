import {
  type ArgumentsHost,
  Catch,
  HttpException,
  Inject,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AdminApplicationErrorCode } from "@ds/schemas";

import { IdempotencyService } from "../taxonomy/idempotency.service.js";
import { TaxonomyProblemFilter } from "../taxonomy/index.js";
import {
  PROBLEM_TYPE_BASE,
  type ReplayLeaseRef,
  resolveTraceId,
} from "../taxonomy/taxonomy.errors.js";

const TITLE: Record<AdminApplicationErrorCode, string> = {
  APPLICATION_TRANSITION_NOT_ALLOWED: "Status transition not allowed",
  ALREADY_ERASED: "Personal data already erased",
};

/**
 * 033 EARS-15 / EARS-20 — the admin queue's own `409` refusals. Both are
 * decided under the application's row lock after the idempotency record was
 * taken, so they are deterministic outcomes of that key: the filter
 * fence-stores them and an exact retry replays the same body.
 */
export class ApplicationAdminError extends HttpException {
  replayLease?: ReplayLeaseRef;

  constructor(
    readonly errorCode: AdminApplicationErrorCode,
    readonly detail: string,
  ) {
    super(TITLE[errorCode], 409);
  }

  toProblemDetails(traceId: string, instance: string) {
    return {
      type: `${PROBLEM_TYPE_BASE}/${this.errorCode.toLowerCase().replace(/_/g, "-")}`,
      title: TITLE[this.errorCode],
      status: 409,
      detail: this.detail,
      instance,
      errorCode: this.errorCode,
      traceId,
    };
  }
}

/**
 * Scoped RFC 7807 filter for `/v1/admin/applications*`: an
 * `ApplicationAdminError` answers with its own code (stored for replay under
 * its lease); everything else — the 011 admin-session / authority refusals,
 * validation, `404`, `412`, `428` — takes the shared 012 admin path, so the
 * admin surface keeps one problem shape (the 025 `PointsProblemFilter`
 * precedent).
 */
@Catch()
export class ApplicationAdminProblemFilter extends TaxonomyProblemFilter {
  private readonly log = new Logger(ApplicationAdminProblemFilter.name);

  constructor(
    @Inject(IdempotencyService) private readonly keys: IdempotencyService,
  ) {
    super(keys);
  }

  override async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    if (!(exception instanceof ApplicationAdminError))
      return super.catch(exception, host);
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const body = exception.toProblemDetails(resolveTraceId(req), req.url);
    if (exception.replayLease) {
      try {
        await this.keys.storeTerminalOutcome(exception.replayLease, {
          status: body.status,
          body,
        });
      } catch (error) {
        this.log.error(
          `could not fence-store application refusal for idempotency record ${exception.replayLease.key}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    void reply
      .status(body.status)
      .header("content-type", "application/problem+json")
      .send(body);
  }
}
