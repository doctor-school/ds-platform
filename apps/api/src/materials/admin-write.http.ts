import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CANONICAL_UUID_REGEX,
  IF_MATCH_HEADER,
  parseIfMatchVersion,
} from "@ds/schemas";
import type { ZodError } from "zod";
import { TaxonomyError } from "../taxonomy/index.js";
import type { IdempotencyOutcome } from "../taxonomy/idempotency.service.js";

// 048 — the request-side helpers every «Материалы» admin controller shares
// (materials, feed sources): id shape, the `If-Match` precondition, the Zod
// field-error mapping, the idempotent replay and the acting subject.

/** The admin surface is id-only; a non-UUID token addresses nothing. */
export function requireId(id: string): void {
  if (!CANONICAL_UUID_REGEX.test(id))
    throw new TaxonomyError("RESOURCE_NOT_FOUND");
}

/** Absent `If-Match` is 428; one this API did not issue is 412. */
export function requireVersion(
  req: FastifyRequest,
  what: string,
): { raw: string; version: number } {
  const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
  if (!raw || raw.trim().length === 0) {
    throw new TaxonomyError(
      "PRECONDITION_REQUIRED",
      `${what} must carry the If-Match of the version it was read at`,
    );
  }
  const version = parseIfMatchVersion(raw);
  if (version === null) {
    throw new TaxonomyError(
      "PRECONDITION_FAILED",
      "the If-Match validator is not one this API issued",
    );
  }
  return { raw, version };
}

export function invalid(message: string, error: ZodError): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    message,
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

/** Replay a completed record's stored outcome verbatim. */
export function replayed(
  outcome: IdempotencyOutcome,
  reply: FastifyReply,
): outcome is Extract<IdempotencyOutcome, { kind: "replay" }> {
  if (outcome.kind !== "replay") return false;
  void reply.status(outcome.replay.status);
  if (outcome.replay.etag) void reply.header("etag", outcome.replay.etag);
  if (outcome.replay.location)
    void reply.header("location", outcome.replay.location);
  return true;
}

export function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}
