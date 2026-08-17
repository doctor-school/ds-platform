import { randomUUID } from "node:crypto";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ProblemDetails, TaxonomyErrorCode } from "@ds/schemas";

// 012-design §5.3 / EARS-16 — every 012 failure is `application/problem+json`
// with RFC 7807 fields plus the two platform fields `errorCode` and `traceId`,
// and NO database key, storage key or hidden lifecycle state.
//
// The mapping lives in ONE table below rather than at each throw site: a handler
// names the stable `errorCode`, and the status is derived. That way the spec's
// §5.3 status⇄code table is a data structure a test can read, not a convention
// spread across twenty `throw new ConflictException(...)` calls where a wrong
// status is invisible.

/** The exact §5.3 status for each stable error code. */
export const TAXONOMY_ERROR_STATUS: Readonly<
  Record<TaxonomyErrorCode, number>
> = {
  VALIDATION_FAILED: 400,
  MEDIA_INVALID: 400,
  MEDIA_INPUT_CONFLICT: 400,
  CURSOR_INVALID: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  ADMIN_SESSION_REQUIRED: 401,
  PLATFORM_ADMIN_REQUIRED: 403,
  RESOURCE_NOT_FOUND: 404,
  RELATIONSHIP_CONFLICT: 409,
  SLUG_CONFLICT: 409,
  SLUG_IMMUTABLE: 409,
  PUBLISH_REQUIREMENTS_NOT_MET: 409,
  PUBLISHED_PROJECT_REQUIRES_CURATOR: 409,
  INVALID_TRANSITION: 409,
  LEGACY_SPEAKER_CONFLICT: 409,
  SPEAKER_POSITION_OCCUPIED: 409,
  CONTENT_REMOVED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  IDEMPOTENCY_REQUEST_IN_PROGRESS: 409,
  PRECONDITION_FAILED: 412,
  LIFECYCLE_IMPACT_STALE: 412,
  UNSUPPORTED_MEDIA_TYPE: 415,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  PRECONDITION_REQUIRED: 428,
  LIFECYCLE_IMPACT_REQUIRED: 428,
  MEDIA_STORAGE_UNAVAILABLE: 503,
};

/** Stable, non-disclosing titles — never echo an id, key or internal state. */
const TAXONOMY_ERROR_TITLE: Readonly<Record<TaxonomyErrorCode, string>> = {
  VALIDATION_FAILED: "Validation failed",
  MEDIA_INVALID: "Media rejected",
  MEDIA_INPUT_CONFLICT: "Ambiguous media input",
  CURSOR_INVALID: "Invalid cursor",
  IDEMPOTENCY_KEY_INVALID: "Invalid Idempotency-Key",
  ADMIN_SESSION_REQUIRED: "Admin session required",
  PLATFORM_ADMIN_REQUIRED: "platform_admin required",
  RESOURCE_NOT_FOUND: "Not found",
  RELATIONSHIP_CONFLICT: "Relationship conflict",
  SLUG_CONFLICT: "Slug already taken",
  SLUG_IMMUTABLE: "Slug is permanently locked",
  PUBLISH_REQUIREMENTS_NOT_MET: "Publication requirements not met",
  PUBLISHED_PROJECT_REQUIRES_CURATOR: "Published project requires a curator",
  INVALID_TRANSITION: "Invalid lifecycle transition",
  LEGACY_SPEAKER_CONFLICT: "Legacy speaker conflict",
  SPEAKER_POSITION_OCCUPIED: "Speaker position occupied",
  CONTENT_REMOVED: "Content was editorially removed",
  IDEMPOTENCY_KEY_REUSED: "Idempotency-Key reused with different input",
  IDEMPOTENCY_REQUEST_IN_PROGRESS: "Request already in progress",
  PRECONDITION_FAILED: "Precondition failed",
  LIFECYCLE_IMPACT_STALE: "Lifecycle impact is stale",
  UNSUPPORTED_MEDIA_TYPE: "Unsupported media type",
  IDEMPOTENCY_KEY_REQUIRED: "Idempotency-Key required",
  PRECONDITION_REQUIRED: "If-Match required",
  LIFECYCLE_IMPACT_REQUIRED: "Lifecycle-Impact-Token required",
  MEDIA_STORAGE_UNAVAILABLE: "Object storage unavailable",
};

/** The RFC 7807 `type` URI namespace — a stable, resolvable docs anchor. */
const PROBLEM_TYPE_BASE = "https://docs.doctor.school/errors";

export interface TaxonomyFieldError {
  path: string;
  message: string;
}

/**
 * The single taxonomy failure type. Carries the stable `errorCode` (the client
 * contract) and optional field-addressed detail; the status and title come from
 * the §5.3 tables above, so a throw site cannot pick a wrong pair.
 */
export class TaxonomyError extends HttpException {
  constructor(
    readonly errorCode: TaxonomyErrorCode,
    readonly detail?: string,
    readonly fieldErrors?: TaxonomyFieldError[],
  ) {
    super(TAXONOMY_ERROR_TITLE[errorCode], TAXONOMY_ERROR_STATUS[errorCode]);
  }
}

/** Build the wire body for a taxonomy failure. */
export function toProblemDetails(
  errorCode: TaxonomyErrorCode,
  traceId: string,
  options: {
    detail?: string | undefined;
    instance?: string | undefined;
    errors?: TaxonomyFieldError[] | undefined;
  } = {},
): ProblemDetails {
  return {
    type: `${PROBLEM_TYPE_BASE}/${errorCode.toLowerCase().replace(/_/g, "-")}`,
    title: TAXONOMY_ERROR_TITLE[errorCode],
    status: TAXONOMY_ERROR_STATUS[errorCode],
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.instance ? { instance: options.instance } : {}),
    errorCode,
    traceId,
    ...(options.errors && options.errors.length > 0
      ? { errors: options.errors }
      : {}),
  };
}

/**
 * Scoped exception filter for the 012 controllers (EARS-16). Deliberately NOT
 * global: 007's admin surface has its own established response shape, and
 * silently reshaping it from a 012 slice would be an unrequested behaviour
 * change on live routes. Applied with `@UseFilters` on the taxonomy controllers,
 * the blast radius is exactly the routes this spec owns.
 *
 * A non-`TaxonomyError` escapee is mapped by status: the 011 guard's own 401/403
 * become the spec's `ADMIN_SESSION_REQUIRED` / `PLATFORM_ADMIN_REQUIRED`, and
 * anything unclassified is logged and returned as an opaque 500 problem — never
 * a stack trace or an ORM message on the wire.
 */
@Catch()
export class TaxonomyProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(TaxonomyProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
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

/**
 * The operational handle on a failure. Prefer the inbound W3C `traceparent`
 * trace-id (so a Tempo span and the client's problem body name the same trace),
 * falling back to a fresh id — never absent, because "which request was that?"
 * is the first question an operator asks.
 */
export function resolveTraceId(req: {
  headers?: Record<string, unknown>;
  id?: unknown;
}): string {
  const traceparent = req.headers?.["traceparent"];
  if (typeof traceparent === "string") {
    const parts = traceparent.split("-");
    if (parts.length >= 3 && parts[1] && /^[0-9a-f]{32}$/.test(parts[1])) {
      return parts[1];
    }
  }
  if (typeof req.id === "string" && req.id.length > 0) return req.id;
  return randomUUID();
}
