import type { FastifyReply, FastifyRequest } from "fastify";
import { IF_MATCH_HEADER, parseIfMatchVersion } from "@ds/schemas";
import type { IdempotencyOutcome } from "./idempotency.service.js";
import { TaxonomyError } from "./taxonomy.errors.js";

// #1483 — the HTTP-boundary conventions the two direction-relation admin
// controllers share, written once. Every rule here is 012-design §5.1's, applied
// unchanged; the file exists because both controllers are the SAME contract over
// two tables, and a second hand-copied `readJsonBody` is how two surfaces drift
// into two different 415 answers.

/** One `VALIDATION_FAILED` shape for both the query and the payload boundary. */
export function validationFailed(
  issues: readonly {
    path: readonly (string | number | symbol)[];
    message: string;
  }[],
  what: "query" | "payload",
): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    what === "query" ? "invalid relationship query" : "invalid relationship payload",
    issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

/**
 * A relationship carries no media slot at all, so anything that is not JSON is
 * 415 — not "an upload in the wrong place" but a shape that could never be
 * satisfied, because there is no file part name to accept.
 */
export function readJsonBody(req: FastifyRequest): unknown {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json")) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      "a relationship carries no media; use application/json",
    );
  }
  return req.body;
}

/**
 * Replay a completed record's stored outcome verbatim (012-design §6): the exact
 * status, body and allow-listed `ETag`/`Location`.
 */
export function replayed(
  outcome: IdempotencyOutcome,
  reply: FastifyReply,
): outcome is Extract<IdempotencyOutcome, { kind: "replay" }> {
  if (outcome.kind !== "replay") return false;
  void reply.status(outcome.replay.status);
  if (outcome.replay.etag) void reply.header("etag", outcome.replay.etag);
  if (outcome.replay.location) {
    void reply.header("location", outcome.replay.location);
  }
  return true;
}

/** The acting admin's subject — the actor half of the record's identity binding. */
export function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}

/**
 * The `If-Match` precondition every write against an existing row carries.
 * Returns the asserted version, or refuses: absent is 428, syntactically
 * unusable is 412 — a validator that asserts nothing cannot pass, and treating
 * it as "no precondition" would silently downgrade the write.
 */
export function requireIfMatchVersion(
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
