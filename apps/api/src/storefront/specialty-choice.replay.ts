import type { FastifyReply } from "fastify";
import type { IdempotencyOutcome } from "../taxonomy/idempotency.service.js";

/** Restore the exact transport envelope retained by the shared idempotency record. */
export function applySpecialtyChoiceReplay(
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

export function isSuccessfulReplay(
  outcome: Extract<IdempotencyOutcome, { kind: "replay" }>,
): boolean {
  return outcome.replay.status >= 200 && outcome.replay.status < 300;
}
