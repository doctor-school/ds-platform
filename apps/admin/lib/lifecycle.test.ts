import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validTransitions } from "@ds/schemas";
import type { EventLifecycleState } from "@ds/schemas";
import {
  REFUSAL_DISMISS_MS,
  actionsFor,
  lifecycleBarContent,
  lifecycleCommandRequest,
  lifecycleErrorOutcome,
  lifecycleSignature,
  stateLabelKey,
} from "./lifecycle";

/**
 * 007 EARS-7 / EARS-9 — the admin lifecycle-action derivation. The admin UI
 * offers ONLY the transitions valid from the current state, and it derives that
 * offer from the SAME closed map (`@ds/schemas` `validTransitions`) the
 * server-side guard enforces — so a UI offer the API would refuse can never be
 * constructed. These assert the derivation is faithful and that the terminal
 * state offers nothing.
 *
 * The bar this module feeds is the `platform` machine's (feature 007); the
 * `legacy` machine 014 EARS-23 added has its own commands and is NOT in
 * {@link actionsFor}'s table yet (slice 2 of #1741), so every `validTransitions`
 * call here passes `"platform"` explicitly — the schema requires the origin and
 * refuses to guess one.
 */
describe("007 EARS-7 admin lifecycle action derivation", () => {
  it("EARS-7: maps each legal forward edge to its named command in state order", () => {
    expect(
      actionsFor("draft", validTransitions("draft", "platform")).map(
        (a) => a.command,
      ),
    ).toEqual(["publish"]);
    expect(
      actionsFor("published", validTransitions("published", "platform")).map(
        (a) => a.command,
      ),
    ).toEqual(["open"]);
    expect(
      actionsFor("live", validTransitions("live", "platform")).map(
        (a) => a.command,
      ),
    ).toEqual(["close"]);
    expect(
      actionsFor("ended", validTransitions("ended", "platform")).map(
        (a) => a.command,
      ),
    ).toEqual(["hide"]);
  });

  it("EARS-7: a terminal hidden event offers no lifecycle action", () => {
    expect(actionsFor("hidden", validTransitions("hidden", "platform"))).toEqual(
      [],
    );
  });

  it("EARS-7: each derived action targets exactly the schema-legal next state", () => {
    const states: EventLifecycleState[] = [
      "draft",
      "published",
      "live",
      "ended",
      "hidden",
    ];
    for (const from of states) {
      const legal = validTransitions(from, "platform");
      const offered = actionsFor(from, legal).map((a) => a.to);
      // The UI offer is exactly the server's legal set — no extra, no missing.
      expect(offered.slice().sort()).toEqual([...legal].sort());
    }
  });

  it("014 EARS-23: `ended` is reachable only from `live` — the published→ended MarkEventEnded fork is gone from the platform machine", () => {
    // The off-platform эфир moved onto its own `legacy` machine (#1741), so a
    // published platform event offers open-room and nothing else, and the only
    // command landing on `ended` is CloseRoom from `live`.
    expect(actionsFor("live", ["ended"])[0]?.command).toBe("close");
    expect(actionsFor("published", ["ended"])).toEqual([]);
  });

  it("014 EARS-23: no lifecycle action names a legacy command — the legacy machine is not on this bar (slice 2)", () => {
    expect(actionsFor("hidden", validTransitions("hidden", "legacy"))).toEqual(
      [],
    );
    expect(
      actionsFor("in_archive", validTransitions("in_archive", "legacy")),
    ).toEqual([]);
  });

  it("EARS-9: state label keys resolve under the events.state.* catalog namespace", () => {
    expect(stateLabelKey("live")).toBe("events.state.live");
    expect(stateLabelKey("hidden")).toBe("events.state.hidden");
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
      "hide",
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

  it("EARS-7: a domain refusal keeps its own sentence AND refetches — the screen may be refusing precisely because the event moved in another window (owner Stage-B finding, 2026-09-01)", () => {
    for (const errorCode of ["INVALID_TRANSITION"]) {
      expect(lifecycleErrorOutcome({ errorCode })).toEqual({
        messageKey: "events.errors.transitionRefused",
        refetch: true,
      });
    }
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

/**
 * #1593 owner Stage-B finding (2026-09-01) — a refusal alert must not outlive the
 * state it describes. Both refusal families refetch, and once that re-read lands
 * the sentence on screen is talking about a version nobody is looking at any
 * more; left alone it sat beside already-corrected badge and actions
 * indefinitely. {@link lifecycleSignature} is the pure half of the dismissal
 * rule: what the alert was raised AGAINST, compared against what is rendered now.
 */
describe("#1593 refusal-alert dismissal", () => {
  const draft = {
    state: "draft" as const,
    validTransitions: ["published"] as const,
    version: 4,
  };

  it("EARS-7: the signature is stable while nothing about the rendered lifecycle moved", () => {
    expect(lifecycleSignature(draft)).toBe(
      lifecycleSignature({ ...draft, validTransitions: ["published"] }),
    );
  });

  it("EARS-7: a bumped version alone moves the signature — the 412 case, where the state and the offered actions are unchanged and only the validator was spent", () => {
    expect(lifecycleSignature({ ...draft, version: 5 })).not.toBe(
      lifecycleSignature(draft),
    );
  });

  it("EARS-7: a moved state moves the signature — the 409 case, where the refetch replaces the badge the operator was looking at", () => {
    expect(
      lifecycleSignature({
        state: "published",
        validTransitions: ["live", "ended"],
        version: 5,
      }),
    ).not.toBe(lifecycleSignature(draft));
  });

  it("EARS-7: a changed action offer moves the signature even at the same state and version", () => {
    expect(lifecycleSignature({ ...draft, validTransitions: [] })).not.toBe(
      lifecycleSignature(draft),
    );
  });

  it("EARS-7: the dismissal delay stays inside the readable 5–8s window the owner asked for", () => {
    expect(REFUSAL_DISMISS_MS).toBeGreaterThanOrEqual(5_000);
    expect(REFUSAL_DISMISS_MS).toBeLessThanOrEqual(8_000);
  });

  it("EARS-7: a refusal is shown even when the re-read left NO transition offered — the screen where the explanation matters most is the one with nothing left to click", () => {
    expect(lifecycleBarContent("Недопустимый переход статуса", [])).toEqual({
      refusal: "Недопустимый переход статуса",
      emptyNotice: true,
    });
  });

  it("EARS-7: with actions offered, the refusal shows and the empty notice does not", () => {
    expect(
      lifecycleBarContent("Недопустимый переход статуса", actionsFor("draft", ["published"])),
    ).toEqual({ refusal: "Недопустимый переход статуса", emptyNotice: false });
  });

  it("EARS-7: a terminal event with no refusal shows the notice alone", () => {
    expect(lifecycleBarContent(null, [])).toEqual({
      refusal: null,
      emptyNotice: true,
    });
  });
});
