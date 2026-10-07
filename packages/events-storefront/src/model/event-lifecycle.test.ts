import { describe, expect, it } from "vitest";

import { toCanvasStatus } from "./event-lifecycle";

/**
 * 004 EARS-4 — the event-page lifecycle render swap: the page reflects the event
 * state from the single `EventLifecycleState`, never contradicting the machine.
 * This pins the pure state→render mapping — the canvas `status` enum mapping.
 * The single primary participation CTA is server-resolved since 020 EARS-1
 * (slice 3, #1764) and is pinned by the API + the shared block, not here.
 */
describe("004 EARS-4 toCanvasStatus — projection state → canvas status enum", () => {
  it("EARS-4: when the event is published, the system shall render the upcoming status", () => {
    expect(toCanvasStatus("published")).toBe("upcoming");
  });

  it("EARS-4: when the event is live, the system shall render the live status", () => {
    expect(toCanvasStatus("live")).toBe("live");
  });

  it("EARS-4: when the event has ended, the system shall render the ended status", () => {
    expect(toCanvasStatus("ended")).toBe("ended");
  });

  it("EARS-4: when the event is hidden, the mapping shall not contradict the machine (hidden stays hidden, never live/upcoming)", () => {
    expect(toCanvasStatus("hidden")).toBe("hidden");
  });

  it("014 EARS-26: in_archive resolves to the ended canvas status — an archived legacy эфир renders exactly as an ended broadcast", () => {
    // No separate archive artboard exists because there is no separate render:
    // `in_archive` is an ADMIN lifecycle fact (014-design §3.1). A distinct
    // canvas status here would be the second public surface EARS-26 forbids.
    expect(toCanvasStatus("in_archive")).toBe("ended");
  });
});
