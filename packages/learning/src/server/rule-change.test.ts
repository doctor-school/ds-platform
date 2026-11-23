import { describe, expect, it } from "vitest";
import type { LearningEvaluation } from "../evaluator/evaluator.js";
import { LearningLayers } from "../rules/resolver.js";
import { changedSettings, diffEvaluations } from "./rule-change.js";

// 024 EARS-24, EARS-31 (#4012) — the pure halves of a rule change: which
// doctors' statuses the new rules change, which earned items «keep» must hold,
// and the «what changed» of the status reason.

const evaluation = (
  states: Record<
    string,
    LearningEvaluation["states"] extends Map<string, infer S> ? S : never
  >,
): LearningEvaluation => ({
  states: new Map(Object.entries(states)),
  kinds: new Map(),
  current: null,
  clubs: new Map(),
  document: { status: "open" },
});

describe("024 rule change — the recompute's diff", () => {
  it("EARS-31: an item done under the old rules and not under the new ones is one «keep» must hold", () => {
    const diff = diffEvaluations(
      evaluation({ lesson: { status: "done" }, step: { status: "done" } }),
      evaluation({ lesson: { status: "current" }, step: { status: "done" } }),
    );
    expect(diff).toEqual({
      changed: true,
      lostDone: ["lesson"],
      gainedDone: false,
    });
  });

  it("EARS-31: an item turning done counts as a change toward done, never as a lost one", () => {
    const diff = diffEvaluations(
      evaluation({ lesson: { status: "current" } }),
      evaluation({ lesson: { status: "done" } }),
    );
    expect(diff).toEqual({ changed: true, lostDone: [], gainedDone: true });
  });

  it("EARS-31: equal statuses are no change — the doctor is not counted", () => {
    const same = evaluation({
      lesson: { status: "open" },
      course: { status: "current" },
    });
    expect(diffEvaluations(same, same)).toEqual({
      changed: false,
      lostDone: [],
      gainedDone: false,
    });
  });
});

describe("024 rule change — the status reason's «what changed»", () => {
  it("EARS-24: each touched setting of the scope, before → after; null = not set there", () => {
    expect(
      changedSettings(
        { "test.threshold": 50, "test.attempts": 3 },
        { "test.threshold": 80, "test.pauseMin": 0, "test.attempts": 3 },
      ),
    ).toEqual([
      { key: "test.pauseMin", before: null, after: 0 },
      { key: "test.threshold", before: 50, after: 80 },
    ]);
  });

  it("EARS-31: the same values with keys stored in another order are no change", () => {
    expect(
      changedSettings(
        { "lesson.completion": { condition: "n-of", n: 1 } } as never,
        { "lesson.completion": { n: 1, condition: "n-of" } } as never,
      ),
    ).toEqual([]);
    expect(
      changedSettings(
        { lockedVisibility: "hidden", "test.threshold": 50 } as never,
        { "test.threshold": 50, lockedVisibility: "hidden" } as never,
      ),
    ).toEqual([]);
  });
});

describe("024 rule change — the new rules", () => {
  it("EARS-31: `withValues` replaces one scope's own values and leaves the old layers as they were", () => {
    const old = new LearningLayers([
      {
        scopeKind: "course",
        scopeId: "c",
        values: { "test.threshold": 50 },
        preset: "ДПО",
      },
    ]);
    const next = old.withValues("course", "c", { "test.threshold": 80 });
    expect(next.layer("course", "c")).toMatchObject({
      values: { "test.threshold": 80 },
      preset: "ДПО",
    });
    expect(old.layer("course", "c")?.values).toEqual({ "test.threshold": 50 });
    expect(
      next.withValues("lesson", "l", {}).layer("lesson", "l")?.values,
    ).toEqual({});
  });
});
