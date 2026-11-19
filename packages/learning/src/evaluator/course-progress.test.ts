import type { LearningNodeState } from "@ds/schemas";
import { describe, expect, it } from "vitest";
import type { LearningCourseModel } from "../model.js";
import { courseProgress } from "./course-progress.js";

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
