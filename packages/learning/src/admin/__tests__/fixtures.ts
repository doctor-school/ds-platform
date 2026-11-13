import { vi } from "vitest";
import type {
  LearningCourseComposition,
  LearningLessonAdmin,
  LearningPreset,
  LearningScopeRules,
  LearningStepAdmin,
} from "@ds/schemas";

import type { LearningAdminTransport } from "../transport";

// Fixtures of the `./admin` component tests (024 EARS-28, EARS-29): admin read
// models shaped by `@ds/schemas` and a transport whose every method is a spy.

export const AID = {
  course: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  school: "10000000-0000-4000-8000-000000000003",
  module: "10000000-0000-4000-8000-000000000004",
  lesson: "10000000-0000-4000-8000-000000000005",
  lesson2: "10000000-0000-4000-8000-000000000006",
  s1: "20000000-0000-4000-8000-000000000001",
  s2: "20000000-0000-4000-8000-000000000002",
  s3: "20000000-0000-4000-8000-000000000003",
  path: "30000000-0000-4000-8000-000000000001",
  open: "30000000-0000-4000-8000-000000000002",
  q1: "40000000-0000-4000-8000-000000000001",
  o1: "40000000-0000-4000-8000-000000000002",
  o2: "40000000-0000-4000-8000-000000000003",
} as const;

export function step(over: Partial<LearningStepAdmin> = {}): LearningStepAdmin {
  return {
    id: AID.s1,
    lessonId: AID.lesson,
    position: 1,
    type: "video",
    title: "Разбор ЭКГ",
    durationMin: 12,
    payload: { durationSec: 600 },
    questions: null,
    media: null,
    source: null,
    version: 1,
    ...over,
  };
}

export const videoStep = (over: Partial<LearningStepAdmin> = {}) => step(over);
export const downloadStep = (over: Partial<LearningStepAdmin> = {}) =>
  step({
    id: AID.s2,
    position: 2,
    type: "download",
    title: "Памятка",
    durationMin: 3,
    payload: { fileName: "pamyatka.pdf" },
    ...over,
  });
export const testStep = (over: Partial<LearningStepAdmin> = {}) =>
  step({
    id: AID.s3,
    position: 3,
    type: "test",
    title: "Итоговый тест",
    durationMin: 5,
    payload: { kind: "exit" },
    questions: [
      {
        id: AID.q1,
        text: "Нормальный интервал PQ?",
        correctiveText: null,
        options: [
          { id: AID.o1, text: "120–200 мс", correct: true },
          { id: AID.o2, text: "300 мс", correct: false },
        ],
      },
    ],
    ...over,
  });

export function lesson(
  over: Partial<LearningLessonAdmin> = {},
): LearningLessonAdmin {
  const steps = over.steps ?? [videoStep(), downloadStep()];
  return {
    id: AID.lesson,
    moduleId: AID.module,
    projectId: AID.project,
    position: 1,
    title: "Основы ЭКГ",
    description: "Что видно на плёнке",
    teaser: "Начните с ритма",
    state: "draft",
    durationMin: steps.reduce((sum, s) => sum + s.durationMin, 0),
    steps,
    version: 4,
    ...over,
  };
}

export function course(
  over: Partial<LearningCourseComposition> = {},
): LearningCourseComposition {
  const { steps: _steps, ...l1 } = lesson();
  return {
    id: AID.course,
    schoolId: AID.school,
    projectId: AID.project,
    slug: "ekg",
    title: "ЭКГ с нуля",
    state: "draft",
    version: 2,
    modules: [
      {
        id: AID.module,
        courseId: AID.course,
        position: 1,
        title: "Ритм",
        version: 1,
        lessons: [l1],
      },
    ],
    ...over,
  };
}

export const PRESETS: LearningPreset[] = [
  {
    id: AID.path,
    name: "Путь (Duolingo)",
    values: {
      order: "strict",
      unlock: { kind: "after-previous" },
      "test.exitRequired": true,
    },
    version: 1,
  },
  {
    id: AID.open,
    name: "Открытый курс",
    values: {
      order: "free",
      "completion.lesson": {
        all: [
          { condition: "all-steps-done" },
          { condition: "test-passed", test: "exit" },
        ],
      },
    },
    version: 1,
  },
];

export function rules(
  over: Partial<LearningScopeRules> = {},
): LearningScopeRules {
  return {
    scopeKind: "course",
    scopeId: AID.course,
    layerVersion: 0,
    appliedPreset: null,
    values: {},
    effective: [
      { key: "test.threshold", value: 70, level: "platform", preset: null },
    ],
    ...over,
  };
}

/** A transport whose every call is a spy; reads answer the given fixtures. */
export function fakeTransport(
  over: Partial<LearningAdminTransport> = {},
): LearningAdminTransport &
  Record<keyof LearningAdminTransport, ReturnType<typeof vi.fn>> {
  const t = {
    course: vi.fn(async () => course()),
    createModule: vi.fn(async () => course().modules[0]),
    createLesson: vi.fn(async () => lesson({ id: AID.lesson2, steps: [] })),
    lesson: vi.fn(async () => lesson()),
    publishLesson: vi.fn(async () => lesson({ state: "published" })),
    unpublishLesson: vi.fn(async () => lesson()),
    createStep: vi.fn(async () => videoStep()),
    setStepSource: vi.fn(async () => videoStep()),
    setStepMedia: vi.fn(async () => downloadStep()),
    removeStep: vi.fn(async () => videoStep()),
    reorderSteps: vi.fn(async () => lesson()),
    presets: vi.fn(async () => PRESETS),
    rules: vi.fn(async () => rules()),
    applyPreset: vi.fn(async () =>
      rules({ appliedPreset: "Путь (Duolingo)", layerVersion: 1 }),
    ),
    ...over,
  };
  return t as never;
}

/** A refused admin write as the host transport throws it (012 problem body). */
export function refusal(
  errorCode: string,
  fieldErrors: { path: string; message: string }[] = [],
  statusCode = 409,
) {
  return Object.assign(new Error(errorCode), {
    statusCode,
    errorCode,
    fieldErrors,
  });
}
