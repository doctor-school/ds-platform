import { type ArgumentsHost, Catch } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { LearningServerError } from "@ds/learning/server";
import { TaxonomyProblemFilter } from "../taxonomy/index.js";
import {
  markReplayable,
  PROBLEM_TYPE_BASE,
  resolveTraceId,
  TaxonomyError,
  type TaxonomyErrorCode,
} from "../taxonomy/taxonomy.errors.js";
import type { ReplayLeaseRef } from "../taxonomy/idempotency.service.js";

// 024-design §7 — the learning problem shapes. The admin routes speak the 012
// admin problem contract (a `LearningServerError` becomes the `TaxonomyError`
// of the same meaning, marked replayable under the request's idempotency
// lease); the doctor routes add the two learning codes:
// `403 LEARNING_STEP_LOCKED` and `409 LEARNING_ATTEMPT_UNAVAILABLE` (with
// `nextAt`, when the next attempt opens).

const ADMIN_CODE: Record<string, TaxonomyErrorCode> = {
  NOT_FOUND: "RESOURCE_NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  PUBLISH_REQUIREMENTS_NOT_MET: "PUBLISH_REQUIREMENTS_NOT_MET",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  SLUG_CONFLICT: "SLUG_CONFLICT",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
};

/** Run an admin command; a learning refusal becomes its 012 problem (replayable under `lease`). */
export async function adminCommand<T>(
  run: () => Promise<T>,
  lease?: ReplayLeaseRef,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const mapped = toTaxonomyError(err);
    throw lease ? markReplayable(mapped, lease) : mapped;
  }
}

export function toTaxonomyError(err: unknown): unknown {
  if (!(err instanceof LearningServerError)) return err;
  const code = ADMIN_CODE[err.code];
  if (!code) return err;
  return new TaxonomyError(code, err.message, err.issues);
}

const DOCTOR_STATUS: Record<LearningServerError["code"], number> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  PUBLISH_REQUIREMENTS_NOT_MET: 409,
  INVALID_TRANSITION: 409,
  SLUG_CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  LEARNING_STEP_LOCKED: 403,
  LEARNING_ATTEMPT_UNAVAILABLE: 409,
};

/**
 * Scoped RFC 7807 filter for the learning routes: a `LearningServerError`
 * answers with its own code; everything else takes the shared 012 path.
 */
@Catch()
export class LearningProblemFilter extends TaxonomyProblemFilter {
  override async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    if (!(exception instanceof LearningServerError)) {
      return super.catch(exception, host);
    }
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status = DOCTOR_STATUS[exception.code];
    const body = {
      type: `${PROBLEM_TYPE_BASE}/${exception.code.toLowerCase().replace(/_/g, "-")}`,
      title: exception.code,
      status,
      detail: exception.message,
      instance: req.url,
      errorCode: exception.code,
      traceId: resolveTraceId(req),
      ...(exception.issues.length > 0 ? { errors: exception.issues } : {}),
      ...(exception.code === "LEARNING_ATTEMPT_UNAVAILABLE"
        ? { nextAt: exception.nextAt?.toISOString() ?? null }
        : {}),
    };
    void reply
      .status(status)
      .header("content-type", "application/problem+json")
      .send(body);
  }
}
