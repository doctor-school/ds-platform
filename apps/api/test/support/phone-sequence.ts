import { randomInt } from "node:crypto";

/** How many numbers one sequence hands out before it refuses. */
export const PHONE_SEQUENCE_SIZE = 10_000;

/**
 * Fictional E.164 numbers (`<prefix>` + 7 digits) that never repeat within
 * one sequence: a random 7-digit start, then consecutive numbers. A spec that
 * puts several numbers into one case (confirmed / unconfirmed / unknown) must
 * be able to rely on them being different — a per-call random draw made in
 * the same millisecond cannot promise that (#3152).
 */
export function phoneSequence(prefix: string): () => string {
  const start = randomInt(0, 10_000_000 - PHONE_SEQUENCE_SIZE);
  let issued = 0;
  return () => {
    if (issued >= PHONE_SEQUENCE_SIZE)
      throw new Error(`phone sequence ${prefix} exhausted`);
    return `${prefix}${String(start + issued++).padStart(7, "0")}`;
  };
}
