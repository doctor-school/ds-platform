import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
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
  USER_EXPERT_CONFLICT: 409,
  SLUG_CONFLICT: 409,
  SLUG_IMMUTABLE: 409,
  PUBLISH_REQUIREMENTS_NOT_MET: 409,
  PUBLISHED_PROJECT_REQUIRES_CURATOR: 409,
  INVALID_TRANSITION: 409,
  SPEAKER_POSITION_OCCUPIED: 409,
  CONTENT_REMOVED: 409,
  RECORDING_KIND_OCCUPIED: 409,
  EVENT_NOT_FINISHED: 409,
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
  USER_EXPERT_CONFLICT: "User already linked to an Expert",
  SLUG_CONFLICT: "Slug already taken",
  SLUG_IMMUTABLE: "Slug is permanently locked",
  PUBLISH_REQUIREMENTS_NOT_MET: "Publication requirements not met",
  PUBLISHED_PROJECT_REQUIRES_CURATOR: "Published project requires a curator",
  INVALID_TRANSITION: "Invalid lifecycle transition",
  SPEAKER_POSITION_OCCUPIED: "Speaker position occupied",
  CONTENT_REMOVED: "Content was editorially removed",
  RECORDING_KIND_OCCUPIED: "Recording kind already occupied",
  EVENT_NOT_FINISHED: "Event is not finished",
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
export const PROBLEM_TYPE_BASE = "https://docs.doctor.school/errors";

export interface TaxonomyFieldError {
  path: string;
  message: string;
}

/**
 * The idempotency record this refusal belongs to. Structural on purpose — keeping
 * `IdempotencyLease` out of this module leaves it dependency-free (the service
 * imports `TaxonomyError`, so importing the service back would be a cycle).
 */
export interface ReplayLeaseRef {
  key: string;
  leaseEpoch: number;
}

/**
 * The DETERMINISTIC post-record outcomes §6 bullet 3 requires to be fenced-stored
 * and replayed: "Every deterministic completion — including 409 and both kinds of
 * 412 — fenced-stores exact status/body plus allowed `ETag`/`Location`".
 *
 * Membership is decided by ONE question: given the same bound input, does this
 * code always come back? A slug already taken, a permanently locked slug, an
 * incomplete published projection, a stale/absent precondition and a refused
 * object-storage PUT (§5.1 names the 503 explicitly) all qualify — and
 * `MEDIA_INVALID` too, because the fingerprint binds the file's SHA-256, so the
 * same bytes are refused identically forever.
 *
 * Deliberately ABSENT:
 *  - pre-record refusals (auth, key shape, request shape) — no record exists yet;
 *  - `RESOURCE_NOT_FOUND` — a row can be created later, so the answer is not
 *    a property of the request;
 *  - `IDEMPOTENCY_*` — those ARE the record protocol, not outcomes of it;
 *  - unclassified DB/provider faults — §6 keeps those takeover-eligible, since
 *    an uncertain commit must not be frozen into a stored verdict.
 */
export const DETERMINISTIC_TERMINAL_ERROR_CODES: ReadonlySet<TaxonomyErrorCode> =
  new Set<TaxonomyErrorCode>([
    // 400 — deterministic over the fingerprinted bytes
    "MEDIA_INVALID",
    // 409 invariants
    "RELATIONSHIP_CONFLICT",
    "USER_EXPERT_CONFLICT",
    "SLUG_CONFLICT",
    "SLUG_IMMUTABLE",
    "PUBLISH_REQUIREMENTS_NOT_MET",
    "PUBLISHED_PROJECT_REQUIRES_CURATOR",
    "INVALID_TRANSITION",
    "SPEAKER_POSITION_OCCUPIED",
    "CONTENT_REMOVED",
    // 409 — 014 recording invariants (014-design §3): both are properties of the
    // bound request against a row state, so an exact retry gets the same refusal.
    "RECORDING_KIND_OCCUPIED",
    "EVENT_NOT_FINISHED",
    // 412 — both kinds
    "PRECONDITION_FAILED",
    "LIFECYCLE_IMPACT_STALE",
    // 503 — §5.1: "completes that idempotency outcome for replay"
    "MEDIA_STORAGE_UNAVAILABLE",
  ]);

/**
 * The single taxonomy failure type. Carries the stable `errorCode` (the client
 * contract) and optional field-addressed detail; the status and title come from
 * the §5.3 tables above, so a throw site cannot pick a wrong pair.
 */
export class TaxonomyError extends HttpException {
  /**
   * Set by a command that already reserved an idempotency record, for a code in
   * {@link DETERMINISTIC_TERMINAL_ERROR_CODES}. The problem filter is what stores
   * the outcome, so the bytes stored are byte-identical to the bytes sent — a
   * second builder would be a second source of truth for "the exact body".
   */
  replayLease?: ReplayLeaseRef;

  constructor(
    readonly errorCode: TaxonomyErrorCode,
    readonly detail?: string,
    readonly fieldErrors?: TaxonomyFieldError[],
  ) {
    super(TAXONOMY_ERROR_TITLE[errorCode], TAXONOMY_ERROR_STATUS[errorCode]);
  }
}

/**
 * Mark a refusal as a deterministic post-record outcome of `lease`, so the filter
 * fenced-stores it for replay. A code outside the set passes through untouched —
 * the classification lives in one table, never at the throw site.
 */
export function markReplayable<E>(error: E, lease: ReplayLeaseRef): E {
  if (
    error instanceof TaxonomyError &&
    DETERMINISTIC_TERMINAL_ERROR_CODES.has(error.errorCode)
  ) {
    error.replayLease = lease;
  }
  return error;
}

/**
 * Slot-uniqueness indexes whose violation is a §4 REFUSAL, not a bug.
 *
 * The service pre-checks the slot rule under the §2.3 lock set, so in practice
 * these never fire — but an application check can always be beaten by an
 * interleaving the locks do not serialize, and an unmapped `23505` reaches the
 * caller as an opaque 500 for what is a perfectly ordinary 409. This table is the
 * defense-in-depth backstop: the index and the wire contract agree on the answer.
 */
const SLOT_UNIQUE_CONSTRAINTS: ReadonlyMap<string, TaxonomyErrorCode> = new Map(
  [
    ["event_experts_event_position_active_uniq", "SPEAKER_POSITION_OCCUPIED"],
  ] as const,
);

/**
 * Classify a driver failure as a slot conflict, or `null` if it is anything else.
 *
 * Drizzle wraps the driver error, so the `code`/`constraint` pair is looked for
 * along the whole `cause` chain rather than on the thrown object alone; the
 * message is a last-resort source for the index name, because the wrapper's
 * message carries the failed statement and the driver detail while some driver
 * versions omit the structured `constraint` field.
 */
export function asSlotConflict(error: unknown): TaxonomyError | null {
  for (let node: unknown = error, depth = 0; node && depth < 5; depth += 1) {
    const candidate = node as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "23505") {
      const named = [candidate.constraint, candidate.constraint_name].find(
        (value): value is string => typeof value === "string",
      );
      const matched =
        (named && SLOT_UNIQUE_CONSTRAINTS.get(named)) ??
        (typeof candidate.message === "string"
          ? [...SLOT_UNIQUE_CONSTRAINTS].find(([index]) =>
              (candidate.message as string).includes(index),
            )?.[1]
          : undefined);
      if (matched) {
        return new TaxonomyError(
          matched,
          "another visible speaker already holds this position on the event",
        );
      }
      return null;
    }
    node = candidate.cause;
  }
  return null;
}

/**
 * Run a write and re-throw a slot-index violation as its 409. Everything else
 * propagates untouched — an unexpected constraint failure must stay loud.
 */
export async function withSlotConflictMapping<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const conflict = asSlotConflict(error);
    if (conflict) throw conflict;
    throw error;
  }
}

/**
 * Classify a driver failure as a SERIALIZABLE abort (SQLSTATE `40001`), or
 * `null` if it is anything else. Same cause-chain walk as `asSlotConflict`,
 * for the same reason: drizzle wraps the driver error.
 */
export function asSerializationAbort(error: unknown): boolean {
  for (let node: unknown = error, depth = 0; node && depth < 5; depth += 1) {
    const candidate = node as { code?: unknown; cause?: unknown };
    if (candidate.code === "40001") return true;
    node = candidate.cause;
  }
  return false;
}

/**
 * Run a §3.1 confirmation and re-throw a serialization abort as its contracted
 * 412 `LIFECYCLE_IMPACT_STALE` (012-design §3.1/§5.3/§6).
 *
 * A `40001` abort means PostgreSQL could not order this transaction against a
 * concurrent one — the very "someone else moved the ground under your preview"
 * condition the impact gate exists to report, and the rollback guarantees the
 * contracted "zero domain/media/audit mutation". It collapses into the SAME
 * undifferentiated 412 as every other stale mode, so it leaks no oracle about
 * the competing transaction, and the service NEVER auto-retries: the operator
 * re-reads the preview and re-confirms, which is what makes the second answer
 * an informed one. Anything else propagates untouched.
 */
export async function withSerializationAbortMapping<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (asSerializationAbort(error)) {
      throw new TaxonomyError(
        "LIFECYCLE_IMPACT_STALE",
        "another change landed while this was being confirmed; reload the impact preview and confirm again",
      );
    }
    throw error;
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
