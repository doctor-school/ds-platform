import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validTransitions } from "@ds/schemas";
import type { EventLifecycleState } from "@ds/schemas";
import {
  actionsFor,
  lifecycleCommandRequest,
  lifecycleErrorOutcome,
  stateLabelKey,
} from "./lifecycle";

/**
 * 007 EARS-7 / EARS-9 + 014 EARS-18 — the admin lifecycle-action derivation. The
 * admin UI offers ONLY the transitions valid from the current state, and it
 * derives that offer from the SAME closed map (`@ds/schemas` `validTransitions`)
 * the server-side guard enforces — so a UI offer the API would refuse can never
 * be constructed. These assert the derivation is faithful, that the terminal
 * state offers nothing, and that the two commands sharing the `ended` target are
 * told apart by the ORIGIN state (the 014 EARS-18 redesign).
 */
describe("007 EARS-7 admin lifecycle action derivation", () => {
  it("EARS-7: maps each legal forward edge to its named command in state order", () => {
    expect(
      actionsFor("draft", validTransitions("draft")).map((a) => a.command),
    ).toEqual(["publish"]);
    expect(
      actionsFor("live", validTransitions("live")).map((a) => a.command),
    ).toEqual(["close"]);
    expect(
      actionsFor("ended", validTransitions("ended")).map((a) => a.command),
    ).toEqual(["archive"]);
  });

  it("EARS-7: a terminal archived event offers no lifecycle action", () => {
    expect(actionsFor("archived", validTransitions("archived"))).toEqual([]);
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
      const offered = actionsFor(from, legal).map((a) => a.to);
      // The UI offer is exactly the server's legal set — no extra, no missing.
      expect(offered.slice().sort()).toEqual([...legal].sort());
    }
  });

  it("014 EARS-18: a published event offers open-room plus mark-ended, in that order", () => {
    expect(
      actionsFor("published", validTransitions("published")).map(
        (a) => a.command,
      ),
    ).toEqual(["open", "mark-ended"]);
  });

  it("014 EARS-18: the shared `ended` target resolves by ORIGIN — close from live, mark-ended from published", () => {
    // Same target state, two different commands: the pair is the key, so the
    // off-platform event can never fire CloseRoom and vice versa.
    expect(actionsFor("live", ["ended"])[0]?.command).toBe("close");
    expect(actionsFor("published", ["ended"])[0]?.command).toBe("mark-ended");
  });

  it("014 EARS-18: mark-ended is offered ONLY when the server kept `ended` in validTransitions", () => {
    // The server drops `ended` from a published event whose scheduled end is
    // still in the future or whose room was ever opened; the UI adds no second
    // copy of that rule, so it simply offers nothing.
    expect(
      actionsFor("published", ["live"]).map((a) => a.command),
    ).toEqual(["open"]);
  });

  it("014 EARS-18: the mark-ended button carries the off-platform label key", () => {
    const action = actionsFor("published", ["ended"])[0];
    expect(action?.labelKey).toBe("events.action.markEnded");
    expect(action?.testId).toBe("action-mark-ended");
  });

  it("EARS-9: state label keys resolve under the events.state.* catalog namespace", () => {
    expect(stateLabelKey("live")).toBe("events.state.live");
    expect(stateLabelKey("archived")).toBe("events.state.archived");
  });
});

/**
 * 007 EARS-7 / 014 EARS-17 — the lifecycle command REQUEST the action bar fires.
 * Since #1593 every named command is conditional: the data provider attaches
 * `If-Match: W/"<version>"` only when the call carries `meta.version`, and the
 * server refuses a command without a validator `428 PRECONDITION_REQUIRED`. The
 * version therefore belongs to the request contract, not to the button's
 * rendering — so it is asserted here, in the same pure tier as the action
 * derivation, rather than only through the manual browser flow.
 */
describe("007 EARS-7 lifecycle command request", () => {
  it("EARS-7: every offered command carries the rendered version as mutation meta", () => {
    const detail = { id: "evt-1", version: 7 };
    for (const command of [
      "publish",
      "open",
      "close",
      "archive",
      "mark-ended",
    ] as const) {
      const request = lifecycleCommandRequest(detail, command);
      expect(request).toEqual({
        url: `/v1/admin/events/evt-1/${command}`,
        method: "post",
        values: {},
        meta: { version: 7 },
      });
    }
  });

  it("EARS-7: the request reflects the version it was built from, never a default", () => {
    expect(lifecycleCommandRequest({ id: "evt-2", version: 1 }, "publish").meta)
      .toEqual({ version: 1 });
    expect(lifecycleCommandRequest({ id: "evt-2", version: 42 }, "publish").meta)
      .toEqual({ version: 42 });
  });
});

/**
 * 007 EARS-7 / #1593 — how the action bar EXPLAINS and RECOVERS from a refusal.
 *
 * A conditional command has two refusal families the operator must be able to
 * tell apart: the transition itself is illegal (409 — nothing to retry), and the
 * screen is simply behind the row (412/428 — the same click succeeds once the
 * page re-reads the event). The second one is not an error the operator caused,
 * so it gets the shipped `errors.stale` sentence every other admin surface uses
 * AND a refetch, so the retry is one click and not a manual browser reload with
 * the spent validator resent in between.
 */
describe("#1593 lifecycle refusal outcome", () => {
  it("EARS-7: a stale validator explains the stale read and refetches the event", () => {
    for (const errorCode of ["PRECONDITION_FAILED", "PRECONDITION_REQUIRED"]) {
      expect(lifecycleErrorOutcome({ errorCode })).toEqual({
        messageKey: "events.errors.stale",
        refetch: true,
      });
    }
  });

  it("EARS-7: an illegal transition keeps the refusal sentence and does NOT refetch", () => {
    expect(lifecycleErrorOutcome({ errorCode: "INVALID_TRANSITION" })).toEqual({
      messageKey: "events.errors.transitionRefused",
      refetch: false,
    });
  });

  it("EARS-7: an unmapped or bodiless failure stays the generic refusal, no refetch", () => {
    expect(lifecycleErrorOutcome(undefined)).toEqual({
      messageKey: "events.errors.transitionRefused",
      refetch: false,
    });
    expect(lifecycleErrorOutcome({ errorCode: "SOMETHING_NEW" })).toEqual({
      messageKey: "events.errors.transitionRefused",
      refetch: false,
    });
  });

  it("EARS-7: both refusal sentences exist in the shipped RU catalogue", () => {
    const messages = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../messages/ru.json", import.meta.url)),
        "utf8",
      ),
    ) as { events: { errors: Record<string, string> } };
    expect(typeof messages.events.errors.stale).toBe("string");
    expect(typeof messages.events.errors.transitionRefused).toBe("string");
  });
});
