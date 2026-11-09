import { describe, expect, it, vi } from "vitest";
import { PointsLedgerError } from "./points.errors.js";

// 025 EARS-26 — the НМО refusal reads the ONE accreditation fact source,
// `eventEconomyFacts()`, which reports «not НМО» for every event today (no
// accreditation field exists yet), so the branch is unexercisable end to end.
// It is pinned here against a stubbed facts source.
const facts = vi.hoisted(() => ({ nmo: false, pulCost: 0 }));
vi.mock("../events/event-economy-facts.js", () => ({
  eventEconomyFacts: () => facts,
}));

const { PointsPricesService } = await import("./points-prices.service.js");

const EVENT_ID = "6f1c2a52-1b7e-4f43-9b0e-0d4f5a0c8e11";

/** A db stand-in: the event lookup finds the event; the upsert must not run. */
function db() {
  const where = vi.fn(async () => [{ id: EVENT_ID }]);
  return {
    select: () => ({ from: () => ({ where }) }),
    transaction: vi.fn(async () => {
      throw new Error("no write expected");
    }),
  };
}

function service(engine: unknown = {}) {
  return new PointsPricesService(db() as never, engine as never);
}

async function refusal(p: Promise<unknown>): Promise<PointsLedgerError> {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PointsLedgerError);
  return error as PointsLedgerError;
}

describe("025 PointsPricesService (unit)", () => {
  it("EARS-26: an НМО-accredited event is refused any mode but open (points-gating-invalid), nothing written", async () => {
    facts.nmo = true;
    try {
      for (const mode of ["threshold", "advance"] as const) {
        const error = await refusal(
          service().put(
            EVENT_ID,
            { itemKind: "event", mode, pulCost: 50 },
            null,
          ),
        );
        expect(error.errorCode).toBe("POINTS_GATING_INVALID");
        expect(error.fieldErrors).toEqual([
          { path: "mode", message: "an НМО-accredited event is always open" },
        ]);
      }
    } finally {
      facts.nmo = false;
    }
  });

  it("EARS-26: a lesson or a module is refused any mode but open", async () => {
    for (const itemKind of ["lesson", "module"] as const) {
      const error = await refusal(
        service().put("lesson:1", { itemKind, mode: "threshold", pulCost: 50 }, null),
      );
      expect(error.errorCode).toBe("POINTS_GATING_INVALID");
      expect(error.fieldErrors?.[0]?.path).toBe("mode");
    }
  });

  it("EARS-13: a malformed itemRef is refused 400 points-item-ref-invalid before any quote", async () => {
    const quote = vi.fn();
    const error = await refusal(
      service({ quote }).gating("p", "course x"),
    );
    expect(error.errorCode).toBe("POINTS_ITEM_REF_INVALID");
    expect(error.getStatus()).toBe(400);
    expect(quote).not.toHaveBeenCalled();
  });
});
