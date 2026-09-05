import { HttpException } from "@nestjs/common";
import { TaxonomyError } from "../taxonomy/taxonomy.errors.js";

/**
 * Run the 012 idempotency protocol preamble and re-shape its `TaxonomyError`
 * refusals onto the 007 admin surface's `{ code, message }` body — same status,
 * same stable code, this surface's envelope. The alternative (applying
 * `TaxonomyProblemFilter` to `EventsModule`'s controllers) would silently
 * reshape live sibling routes, which that filter's own doc rules out and
 * `EventsModule`'s header comment records as a deliberate non-choice.
 *
 * It lives in its own file rather than inside one controller because BOTH admin
 * surfaces of the 007/014 events module run the same preamble — the fenced
 * lifecycle commands (`EventsAdminController.fencedTransition`) and the legacy
 * broadcast create (`LegacyBroadcastsAdminController.create`) — and a second
 * copy of the mapping would let the two envelopes drift apart.
 */
export async function withProtocolRefusalShape<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof TaxonomyError) {
      throw new HttpException(
        { code: err.errorCode, message: err.detail ?? err.message },
        err.getStatus(),
      );
    }
    throw err;
  }
}
