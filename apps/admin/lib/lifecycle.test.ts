import { describe, expect, it } from "vitest";
import { validTransitions } from "@ds/schemas";
import type { EventLifecycleState } from "@ds/schemas";
import { actionsFor, stateLabelKey } from "./lifecycle";

/**
 * 007 EARS-7 / EARS-9 — the admin lifecycle-action derivation. The admin UI
 * offers ONLY the transitions valid from the current state, and it derives that
 * offer from the SAME closed map (`@ds/schemas` `validTransitions`) the
 * server-side guard enforces — so a UI offer that the API would refuse can never
 * be constructed. These assert the derivation is faithful and the terminal state
 * offers nothing.
 */
describe("007 EARS-7 admin lifecycle action derivation", () => {
  it("EARS-7: maps each legal forward transition to its named command in state order", () => {
    expect(actionsFor(validTransitions("draft")).map((a) => a.command)).toEqual([
      "publish",
    ]);
    expect(
      actionsFor(validTransitions("published")).map((a) => a.command),
    ).toEqual(["open"]);
    expect(actionsFor(validTransitions("live")).map((a) => a.command)).toEqual([
      "close",
    ]);
    expect(actionsFor(validTransitions("ended")).map((a) => a.command)).toEqual([
      "archive",
    ]);
  });

  it("EARS-7: a terminal archived event offers no lifecycle action", () => {
    expect(actionsFor(validTransitions("archived"))).toEqual([]);
  });

  it("EARS-7: each derived action targets exactly the schema-legal next state", () => {
    const states: EventLifecycleState[] = [
      "draft",
      "published",
      "live",
      "ended",
      "archived",
    ];
    for (const from of states) {
      const legal = validTransitions(from);
      const offered = actionsFor(legal).map((a) => a.to);
      // The UI offer is exactly the server's legal set — no extra, no missing.
      expect(offered.sort()).toEqual([...legal].sort());
    }
  });

  it("EARS-9: state label keys resolve under the events.state.* catalog namespace", () => {
    expect(stateLabelKey("live")).toBe("events.state.live");
    expect(stateLabelKey("archived")).toBe("events.state.archived");
  });
});
