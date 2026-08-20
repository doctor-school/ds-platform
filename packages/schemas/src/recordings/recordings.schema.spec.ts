import { describe, expect, it } from "vitest";

import {
  AttachRecordingRequestSchema,
  RECORDING_COMMANDS,
  RECORDING_ERROR_CODES,
  RECORDING_TRANSITIONS,
  UpdateRecordingRequestSchema,
  validRecordingCommands,
} from "./index.js";
// The readiness date is a field of the EVENT write model, so its schema lives
// with the event contracts — asserted here because 014 owns the rule.
import {
  RecordingExpectedBySchema,
  UpdateEventRequestSchema,
} from "../events/events.schema.js";

// 014 EARS-1 / EARS-2 (#1339) — the wire-contract half. These are the bounds the
// admin panel derives its client-side messages from, so a bound asserted here is
// a bound the operator sees BEFORE the round-trip and the server enforces after.
//
// The transition table gets its own assertions because it is the ONE place the
// §3 state machine is written down: the service reads it and the panel renders
// `validCommands` from it, so an edge that drifts here drifts everywhere at once
// — which is exactly why it should be impossible to change silently.

describe("014 event recordings — admin contract (SSOT)", () => {
  const valid = {
    kind: "edited",
    provider: "rutube",
    embedRef: "0123456789abcdef0123456789abcdef",
  };

  it("014 EARS-1: an attach shall accept a well-formed source and default nothing about publication", () => {
    const parsed = AttachRecordingRequestSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    // `status` is server-assigned: the contract carries no way to ask for one.
    expect(Object.keys(parsed.data!)).not.toContain("status");
  });

  it("014 EARS-1: an attach shall refuse a client-supplied status or any other unknown key", () => {
    expect(
      AttachRecordingRequestSchema.safeParse({ ...valid, status: "published" })
        .success,
    ).toBe(false);
    expect(
      AttachRecordingRequestSchema.safeParse({ ...valid, deletedAt: null })
        .success,
    ).toBe(false);
  });

  it("014 EARS-1: an attach shall refuse a reference that cannot belong to its provider — the shared 006 shapes, not a second validator", () => {
    // A rutube id under youtube …
    expect(
      AttachRecordingRequestSchema.safeParse({ ...valid, provider: "youtube" })
        .success,
    ).toBe(false);
    // … a pasted share link for an id-style provider …
    expect(
      AttachRecordingRequestSchema.safeParse({
        ...valid,
        embedRef: "https://rutube.ru/video/0123456789abcdef0123456789abcdef/",
      }).success,
    ).toBe(false);
    // … and an empty reference.
    expect(
      AttachRecordingRequestSchema.safeParse({ ...valid, embedRef: "  " })
        .success,
    ).toBe(false);
  });

  it("014 EARS-1: an attach shall bound the optional poster and duration", () => {
    expect(
      AttachRecordingRequestSchema.safeParse({ ...valid, durationSec: 0 })
        .success,
    ).toBe(false);
    expect(
      AttachRecordingRequestSchema.safeParse({ ...valid, durationSec: 86401 })
        .success,
    ).toBe(false);
    expect(
      AttachRecordingRequestSchema.safeParse({ ...valid, posterRef: "" })
        .success,
    ).toBe(false);
    expect(
      AttachRecordingRequestSchema.safeParse({
        ...valid,
        posterRef: null,
        durationSec: 5400,
      }).success,
    ).toBe(true);
  });

  it("014 EARS-1: a correction shall carry the provider and the reference together or neither, and shall never move a recording between kinds", () => {
    expect(
      UpdateRecordingRequestSchema.safeParse({ durationSec: 60 }).success,
    ).toBe(true);
    // Half a source is not a source: the reference is only meaningful against
    // the provider whose id format it must match.
    expect(
      UpdateRecordingRequestSchema.safeParse({ embedRef: valid.embedRef })
        .success,
    ).toBe(false);
    expect(
      UpdateRecordingRequestSchema.safeParse({ provider: "youtube" }).success,
    ).toBe(false);
    expect(
      UpdateRecordingRequestSchema.safeParse({
        provider: valid.provider,
        embedRef: valid.embedRef,
      }).success,
    ).toBe(true);
    // Re-slotting is a retire plus a fresh attach, never an edit.
    expect(
      UpdateRecordingRequestSchema.safeParse({ kind: "raw" }).success,
    ).toBe(false);
  });

  it("014 EARS-2: the transition table shall hold exactly the §3 edges", () => {
    expect(RECORDING_TRANSITIONS).toEqual({
      publish: { from: ["draft"], to: "published" },
      unpublish: { from: ["published"], to: "draft" },
      retire: { from: ["draft", "published"], to: "retired" },
      restore: { from: ["retired"], to: "draft" },
    });
    expect(RECORDING_COMMANDS).not.toContain("delete");
  });

  it("014 EARS-2: the commands offered from a state shall be exactly the ones the table permits", () => {
    expect(validRecordingCommands("draft")).toEqual(["publish", "retire"]);
    expect(validRecordingCommands("published")).toEqual([
      "unpublish",
      "retire",
    ]);
    // A retired row is restorable, never re-publishable in one hop and never
    // removable: retire is terminal and reversible, and that is the whole set.
    expect(validRecordingCommands("retired")).toEqual(["restore"]);
  });

  it("014 EARS-1: the readiness date shall be a real calendar day, never an instant", () => {
    expect(RecordingExpectedBySchema.safeParse("2026-09-01").success).toBe(
      true,
    );
    expect(
      RecordingExpectedBySchema.safeParse("2026-09-01T10:00:00Z").success,
    ).toBe(false);
    expect(RecordingExpectedBySchema.safeParse("2026-13-01").success).toBe(
      false,
    );
    // An impossible DAY is as wrong as an impossible month, and it is the one a
    // lenient parser silently rolls over into the next month.
    expect(RecordingExpectedBySchema.safeParse("2026-02-31").success).toBe(
      false,
    );
  });

  it("014 EARS-1: the event write model shall refuse a non-existent calendar day, not forward it to the database", () => {
    // The rule is only worth anything WIRED: a bare `^\d{4}-\d{2}-\d{2}$` accepts
    // `2026-13-45`, Postgres then raises on the out-of-range `date`, and the API
    // answers with a 5xx it authored itself (014-design §11, ADR-0002 §9).
    expect(
      UpdateEventRequestSchema.safeParse({ recordingExpectedBy: "2026-13-45" })
        .success,
    ).toBe(false);
    expect(
      UpdateEventRequestSchema.safeParse({ recordingExpectedBy: "2026-02-31" })
        .success,
    ).toBe(false);
    // The two legal values stay legal: a real day, and `null` to clear the promise.
    expect(
      UpdateEventRequestSchema.safeParse({ recordingExpectedBy: "2026-09-01" })
        .success,
    ).toBe(true);
    expect(
      UpdateEventRequestSchema.safeParse({ recordingExpectedBy: null }).success,
    ).toBe(true);
  });

  it("014 EARS-17: the client-visible error set shall carry every refusal the surface can answer with and no 5xx of its own", () => {
    for (const code of [
      "RECORDING_KIND_OCCUPIED",
      "EVENT_NOT_FINISHED",
      "INVALID_TRANSITION",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_KEY_INVALID",
      "PRECONDITION_REQUIRED",
      "PRECONDITION_FAILED",
    ]) {
      expect(RECORDING_ERROR_CODES).toContain(code);
    }
    expect(RECORDING_ERROR_CODES).not.toContain("INTERNAL_ERROR");
  });
});
