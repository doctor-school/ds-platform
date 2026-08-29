import type { FastifyReply } from "fastify";
import type { IdempotencyOutcome } from "../taxonomy/idempotency.service.js";

/** Restore the exact transport envelope retained by the shared idempotency record. */
export function applySpecialtyChoiceReplay(
  outcome: IdempotencyOutcome,
  reply: FastifyReply,
): outcome is Extract<IdempotencyOutcome, { kind: "replay" }> {
  if (outcome.kind !== "replay") return false;
  void reply.status(outcome.replay.status);
  if (isStoredProblem(outcome.replay.status, outcome.replay.body)) {
    void reply.header("content-type", "application/problem+json");
  }
  if (outcome.replay.etag) void reply.header("etag", outcome.replay.etag);
  if (outcome.replay.location) {
    void reply.header("location", outcome.replay.location);
  }
  return true;
}

/** Problem Details is the only non-success media type this route may replay. */
function isStoredProblem(status: number, body: unknown): boolean {
  if (status < 400 || body === null || typeof body !== "object") return false;
  const problem = body as Record<string, unknown>;
  return (
    problem.status === status &&
    typeof problem.type === "string" &&
    typeof problem.title === "string"
  );
}

export function isSuccessfulReplay(
  outcome: Extract<IdempotencyOutcome, { kind: "replay" }>,
): boolean {
  return outcome.replay.status >= 200 && outcome.replay.status < 300;
}
