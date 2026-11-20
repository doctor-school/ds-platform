import type { LearningNodeState } from "@ds/schemas";
import { describe, expect, it } from "vitest";
import type { LearningCourseModel } from "../model.js";
import { courseProgress, nextLessonNumber } from "./course-progress.js";

// 023 EARS-3 (023-design §4) — the per-course state on a school card:
// `done` = the 024 evaluator's course status; `started` = any done step, or a
// current step that is not the course's first; else `not-started`.

const step = (id: string) => ({
  id,
  type: "video" as const,
  title: id,
  durationMin: 1,
  payload: {},
});

const course: LearningCourseModel = {
  id: "course",
  schoolId: "school",
  modules: [
    {
      id: "m1",
      title: "m1",
      lessons: [
        { id: "l1", title: "l1", steps: [step("s1"), step("s2")] },
        { id: "l2", title: "l2", steps: [step("s3")] },
      ],
    },
  ],
};

const evaluation = (
  states: Record<string, LearningNodeState["status"]>,
  current: string | null,
) => ({
  states: new Map(
    Object.entries(states).map(
      ([id, status]) => [id, { status } as LearningNodeState] as const,
    ),
  ),
  current: current ? { stepId: current, lessonId: "l1" } : null,
});

describe("023 course progress on a school card", () => {
  it("023 EARS-3: a course with no done step and the first step current is not-started", () => {
    expect(
      courseProgress(
        course,
        evaluation({ course: "current", s1: "current", s2: "locked", s3: "locked" }, "s1"),
      ),
    ).toBe("not-started");
  });

  it("023 EARS-3: a course whose rules open every step and nothing done is not-started", () => {
    expect(
      courseProgress(
        course,
        evaluation({ course: "current", s1: "current", s2: "open", s3: "open" }, "s1"),
      ),
    ).toBe("not-started");
  });

  it("023 EARS-3: any done step makes the course started", () => {
    expect(
      courseProgress(
        course,
        evaluation({ course: "current", s1: "done", s2: "current", s3: "locked" }, "s2"),
      ),
    ).toBe("started");
  });

  it("023 EARS-3: a current step past the first makes the course started without a done step", () => {
    expect(
      courseProgress(
        course,
        evaluation({ course: "current", s1: "open", s2: "open", s3: "current" }, "s3"),
      ),
    ).toBe("started");
  });

  it("023 EARS-3: the evaluator's done course status is done", () => {
    expect(
      courseProgress(
        course,
        evaluation({ course: "done", s1: "done", s2: "done", s3: "done" }, null),
      ),
    ).toBe("done");
  });

  it("023 EARS-3: a course with no steps and no current is not-started", () => {
    expect(
      courseProgress(
        { id: "course", schoolId: "school", modules: [] },
        evaluation({ course: "open" }, null),
      ),
    ).toBe("not-started");
  });
});

describe("023 the next lesson number on a started school card", () => {
  const twoModules: LearningCourseModel = {
    ...course,
    modules: [
      ...course.modules,
      {
        id: "m2",
        title: "m2",
        lessons: [{ id: "l3", title: "l3", steps: [step("s4")] }],
      },
    ],
  };
  const at = (lessonId: string, stepId: string) => ({
    states: new Map<string, LearningNodeState>([
      ["s1", { status: "done" }],
    ]),
    current: { stepId, lessonId },
  });

  it("023 EARS-5: a started course names the course-wide ordinal of the lesson holding the current step", () => {
    expect(nextLessonNumber(twoModules, at("l1", "s2"))).toBe(1);
    expect(nextLessonNumber(twoModules, at("l2", "s3"))).toBe(2);
    // Numbering runs across modules: the first lesson of module 2 is lesson 3.
    expect(nextLessonNumber(twoModules, at("l3", "s4"))).toBe(3);
  });

  it("023 EARS-5: a course that is not started, or done, has no next lesson number", () => {
    expect(
      nextLessonNumber(twoModules, { states: new Map(), current: { stepId: "s1", lessonId: "l1" } }),
    ).toBeNull();
    expect(
      nextLessonNumber(twoModules, {
        states: new Map([["course", { status: "done" } as LearningNodeState]]),
        current: null,
      }),
    ).toBeNull();
  });
});
