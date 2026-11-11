import { originFixture, barFixture } from "./recording-invariants.fixture.js";
import { expect, it } from "vitest";
import {
  assertOriginReceipt,
  assertLegacyBarReceipt,
  type OriginReceipt,
  type LegacyBarReceipt,
} from "./recording-lifecycle.js";

it("requires the complete own machine, shared hidden, real foreign-command refusals and supported origin PATCH witnesses", () => {
  for (const origin of ["platform", "legacy"] as const) {
    expect(() =>
      assertOriginReceipt(originFixture(origin), origin),
    ).not.toThrow();
    for (const mutate of [
      (r: OriginReceipt) => {
        r.states.pop();
      },
      (r: OriginReceipt) => {
        r.states[0]!.validTransitions.push(
          origin === "platform" ? "in_archive" : "live",
        );
      },
      (r: OriginReceipt) => {
        r.states[0]!.refusals[0]!.answer.status = 200;
      },
      (r: OriginReceipt) => {
        r.states[0]!.refusals.pop();
      },
      (r: OriginReceipt) => {
        r.update.answer.status = 200;
      },
      (r: OriginReceipt) => {
        r.update.answer.body = { message: "multipart/form-data is required" };
      },
      (r: OriginReceipt) => {
        r.update.answer.request.path += "/internal";
      },
      (r: OriginReceipt) => {
        r.update.control.status = 409;
      },
      (r: OriginReceipt) => {
        r.update.after.origin = "forged";
      },
    ]) {
      const receipt = structuredClone(originFixture(origin));
      mutate(receipt);
      expect(() => assertOriginReceipt(receipt, origin)).toThrow();
    }
  }
});

it("requires real browser bars for both legacy states and exact independent labels and transitions", () => {
  expect(() => assertLegacyBarReceipt(barFixture())).not.toThrow();
  for (const mutate of [
    (r: LegacyBarReceipt) => {
      r.states.pop();
    },
    (r: LegacyBarReceipt) => {
      r.states[0]!.labels.push("Выйти в эфир");
    },
    (r: LegacyBarReceipt) => {
      r.states[0]!.validTransitions = ["live"];
    },
    (r: LegacyBarReceipt) => {
      r.states[0]!.transport = "api";
    },
    (r: LegacyBarReceipt) => {
      r.states[0]!.recording.status = "draft";
    },
  ]) {
    const r = barFixture();
    mutate(r);
    expect(() => assertLegacyBarReceipt(r)).toThrow();
  }
});
