import { describe, expect, it, vi } from "vitest";
import type { LearningEvaluation } from "../evaluator/evaluator.js";
import { LearningLayers } from "../rules/resolver.js";
import {
  changedSettings,
  diffEvaluations,
  finishRuleChange,
  matchesProjection,
  movedByChange,
  resumeRuleChanges,
} from "./rule-change.js";
import { countingFacts, scopeCovers, type LoadedCourse } from "./repository.js";
import type { LearningServerDeps } from "./deps.js";

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

describe("024 rule change — resuming an interrupted recompute", () => {
  /** A db whose only read is the unfinished changes, oldest first. */
  const depsWith = (ids: string[]) =>
    ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: async () => ids.map((id) => ({ id })),
            }),
          }),
        }),
      },
    }) as unknown as LearningServerDeps;

  it("EARS-31: every change left with recomputed_at NULL is recomputed, oldest first", async () => {
    const recompute = vi.fn(async () => {});
    const resumed = await resumeRuleChanges(depsWith(["a", "b"]), recompute);
    expect(recompute.mock.calls.map((c) => c[1])).toEqual(["a", "b"]);
    expect(resumed).toBe(2);
  });

  it("EARS-31: one change failing to recompute does not keep the others unfinished; it stays for the next resume", async () => {
    const recompute = vi.fn(async (_deps: unknown, id: string) => {
      if (id === "a") throw new Error("boom");
    });
    const failed: string[] = [];
    const resumed = await resumeRuleChanges(
      depsWith(["a", "b"]),
      recompute,
      (id) => failed.push(id),
    );
    expect(recompute.mock.calls.map((c) => c[1])).toEqual(["a", "b"]);
    expect(resumed).toBe(1);
    expect(failed).toEqual(["a"]);
  });
});

describe("024 rule change — the recompute after a committed save", () => {
  it("EARS-31: a recompute failing after the save committed does not fail the save; the change is left for the resume", async () => {
    const failed: string[] = [];
    await expect(
      finishRuleChange(
        {} as LearningServerDeps,
        "c1",
        async () => {
          throw new Error("connection reset");
        },
        (id) => failed.push(id),
        async () => {},
      ),
    ).resolves.toBe(false);
    expect(failed).toEqual(["c1"]);
  });

  it("EARS-31: a transient recompute failure is retried before the change is left for the resume", async () => {
    const failed: string[] = [];
    let calls = 0;
    await expect(
      finishRuleChange(
        {} as LearningServerDeps,
        "c3",
        async () => {
          calls += 1;
          if (calls === 1) throw new Error("connection reset");
        },
        (id) => failed.push(id),
        async () => {},
      ),
    ).resolves.toBe(true);
    expect(calls).toBe(2);
    expect(failed).toEqual([]);
  });

  it("EARS-31: a recompute that keeps failing is tried a bounded number of times, then left for the resume", async () => {
    const failed: string[] = [];
    const recompute = vi.fn(async () => {
      throw new Error("connection reset");
    });
    await expect(
      finishRuleChange(
        {} as LearningServerDeps,
        "c4",
        recompute,
        (id) => failed.push(id),
        async () => {},
      ),
    ).resolves.toBe(false);
    expect(recompute).toHaveBeenCalledTimes(3);
    expect(failed).toEqual(["c4"]);
  });

  it("EARS-31: a finished recompute reports the change finished", async () => {
    const recompute = vi.fn(async () => {});
    await expect(
      finishRuleChange({} as LearningServerDeps, "c2", recompute),
    ).resolves.toBe(true);
    expect(recompute).toHaveBeenCalledWith({}, "c2");
  });
});

// ── EARS-31 — a later «require again» re-judges an earlier kept credit ──────

const tree = {
  row: { id: "course", schoolId: "school" },
  modules: [{ id: "module" }, { id: "module-2" }],
  lessons: [
    { id: "lesson", moduleId: "module" },
    { id: "lesson-2", moduleId: "module-2" },
  ],
  steps: [
    { id: "step", lessonId: "lesson" },
    { id: "step-2", lessonId: "lesson-2" },
  ],
} as unknown as LoadedCourse;

const kept = (itemId: string, at: string) => ({
  fact: { kind: "completion-kept" as const, itemId },
  occurredAt: new Date(at),
});

describe("024 rule change — which kept credits count", () => {
  it("EARS-31: a kept credit stops counting once a LATER «require again» change covers its item", () => {
    const records = [kept("lesson", "2026-11-01T00:00:00Z")];
    const later = [
      {
        kind: "course" as const,
        scopeId: "course",
        at: new Date("2026-11-02T00:00:00Z"),
      },
    ];
    expect(countingFacts(records, tree, later)).toEqual([]);
  });

  it("EARS-31: an earlier «require again» change, or one on another branch of the tree, leaves the credit counting", () => {
    const records = [kept("lesson", "2026-11-02T00:00:00Z")];
    expect(
      countingFacts(records, tree, [
        {
          kind: "course",
          scopeId: "course",
          at: new Date("2026-11-01T00:00:00Z"),
        },
        {
          kind: "lesson",
          scopeId: "lesson-2",
          at: new Date("2026-11-03T00:00:00Z"),
        },
        {
          kind: "school",
          scopeId: "other-school",
          at: new Date("2026-11-03T00:00:00Z"),
        },
      ]),
    ).toEqual([records[0]!.fact]);
  });

  it("EARS-31: a change covers an item it holds and an item that holds it; other facts always count", () => {
    expect(
      scopeCovers(tree, { kind: "platform", scopeId: "platform" }, "step"),
    ).toBe(true);
    expect(
      scopeCovers(tree, { kind: "school", scopeId: "school" }, "lesson"),
    ).toBe(true);
    expect(
      scopeCovers(tree, { kind: "module", scopeId: "module" }, "step"),
    ).toBe(true);
    expect(scopeCovers(tree, { kind: "step", scopeId: "step" }, "course")).toBe(
      true,
    );
    expect(
      scopeCovers(tree, { kind: "step", scopeId: "step-2" }, "lesson"),
    ).toBe(false);
    const opened = {
      fact: { kind: "opened" as const, stepId: "step" },
      occurredAt: new Date(0),
    };
    expect(
      countingFacts([opened], tree, [
        { kind: "platform", scopeId: "platform", at: new Date() },
      ]),
    ).toEqual([opened.fact]);
  });
});

describe("024 rule change — the recompute writes only what moved", () => {
  it("EARS-31: a doctor whose projection already holds every evaluated status takes no write", () => {
    const live = evaluation({
      lesson: { status: "current" },
      step: { status: "open" },
    });
    expect(
      matchesProjection(
        live,
        new Map([
          ["lesson", "current"],
          ["step", "open"],
        ]),
      ),
    ).toBe(true);
    expect(
      matchesProjection(
        live,
        new Map([
          ["lesson", "done"],
          ["step", "open"],
        ]),
      ),
    ).toBe(false);
    expect(matchesProjection(live, undefined)).toBe(false);
  });
});

describe("024 rule change — which items carry the reason", () => {
  it("EARS-24: an item moved off done carries it for life; an item locked again carries it while locked; an unlocked, gained or unmoved item does not", () => {
    const before = evaluation({
      reopened: { status: "done" },
      lostToLocked: { status: "done" },
      relocked: { status: "open" },
      unlocked: { status: "locked", reason: { kind: "previous" } },
      movedOn: { status: "open" },
      gained: { status: "open" },
      same: { status: "locked", reason: { kind: "previous" } },
    });
    const after = evaluation({
      reopened: { status: "current" },
      lostToLocked: { status: "locked", reason: { kind: "previous" } },
      relocked: { status: "locked", reason: { kind: "previous" } },
      unlocked: { status: "open" },
      movedOn: { status: "current" },
      gained: { status: "done" },
      same: { status: "locked", reason: { kind: "previous" } },
    });
    expect(movedByChange(before, after)).toEqual([
      { itemId: "reopened", whileLocked: false },
      { itemId: "lostToLocked", whileLocked: false },
      { itemId: "relocked", whileLocked: true },
    ]);
  });
});
