import { describe, expect, it } from "vitest";
import {
  asSerializationAbort,
  TaxonomyError,
  toProblemDetails,
  withSerializationAbortMapping,
} from "../../src/taxonomy/taxonomy.errors.js";

// 012 EARS-6 (#1288) — the §3.1 clause "…or serialization abort returns 412
// `LIFECYCLE_IMPACT_STALE` with zero domain/media/audit mutation; the service
// never auto-retries".
//
// A real `40001` needs two transactions interleaving inside one SERIALIZABLE
// window, which no single-process e2e can force deterministically — so the
// contract is pinned at the layer that OWNS it: the classifier is driven with a
// fabricated pg error (the exact shape `node-postgres` throws, including the
// wrapper drizzle puts around it), and the mapping wrapper is driven end to end
// into the wire body the filter would send.

/** The shape `node-postgres` raises for `could not serialize access …`. */
function pgSerializationFailure(): Error & { code: string } {
  const err = new Error(
    "could not serialize access due to read/write dependencies among transactions",
  ) as Error & { code: string; severity: string };
  err.code = "40001";
  err.severity = "ERROR";
  return err;
}

describe("012 EARS-6: SERIALIZABLE abort mapping", () => {
  it("012 EARS-6.1: classifies a bare driver 40001 as a serialization abort", () => {
    expect(asSerializationAbort(pgSerializationFailure())).toBe(true);
  });

  it("012 EARS-6.2: finds the 40001 along the cause chain drizzle wraps it in", () => {
    const wrapped = new Error("Failed query: update event_projects …", {
      cause: new Error("driver", { cause: pgSerializationFailure() }),
    });
    expect(asSerializationAbort(wrapped)).toBe(true);
  });

  it("012 EARS-6.3: leaves any other SQLSTATE unclassified", () => {
    const unique = new Error("duplicate key") as Error & { code: string };
    unique.code = "23505";
    expect(asSerializationAbort(unique)).toBe(false);
    expect(asSerializationAbort(new Error("plain"))).toBe(false);
    expect(asSerializationAbort(undefined)).toBe(false);
  });

  it("012 EARS-6.4: when the confirmation aborts on serialization, the system shall answer 412 LIFECYCLE_IMPACT_STALE and shall not retry", async () => {
    let attempts = 0;
    const run = async (): Promise<never> => {
      attempts += 1;
      throw new Error("Failed query", { cause: pgSerializationFailure() });
    };

    const thrown = await withSerializationAbortMapping(run).catch(
      (err: unknown) => err,
    );

    expect(attempts).toBe(1); // never auto-retried
    expect(thrown).toBeInstanceOf(TaxonomyError);
    const error = thrown as TaxonomyError;
    expect(error.errorCode).toBe("LIFECYCLE_IMPACT_STALE");
    // The undifferentiated 412 the filter puts on the wire — the SAME body as
    // every other stale mode, so the abort leaks no oracle about the competing
    // transaction.
    const body = toProblemDetails(error.errorCode, "trace-1", {
      detail: error.detail,
    });
    expect(body.status).toBe(412);
    expect(body.errorCode).toBe("LIFECYCLE_IMPACT_STALE");
  });

  it("012 EARS-6.5: propagates a non-serialization failure untouched", async () => {
    const boom = new Error("something else");
    await expect(
      withSerializationAbortMapping(() => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });

  it("012 EARS-6.6: passes a successful confirmation through unchanged", async () => {
    await expect(
      withSerializationAbortMapping(() => Promise.resolve("ok")),
    ).resolves.toBe("ok");
  });
});
