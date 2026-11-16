import type {
  LearningCoursePath,
  LearningLessonRead,
  LearningStepRead,
} from "@ds/schemas";
import { vi } from "vitest";

import type { LearningHostConfig } from "../host-config";

// Shared fixtures for the `./ui` component tests (024 EARS-14…18): one course,
// one module, three lessons — done · «Вы здесь» · locked behind the previous.

export const CONFIG: LearningHostConfig = {
  routes: { courses: "/courses", register: "/register" },
};

export const ID = {
  course: "00000000-0000-4000-8000-000000000001",
  module: "00000000-0000-4000-8000-000000000002",
  l1: "00000000-0000-4000-8000-000000000011",
  l2: "00000000-0000-4000-8000-000000000012",
  l3: "00000000-0000-4000-8000-000000000013",
  s1: "00000000-0000-4000-8000-000000000101",
  s2: "00000000-0000-4000-8000-000000000102",
  s3: "00000000-0000-4000-8000-000000000103",
  s4: "00000000-0000-4000-8000-000000000104",
  test: "00000000-0000-4000-8000-000000000201",
  attempt: "00000000-0000-4000-8000-000000000301",
  q1: "00000000-0000-4000-8000-000000000401",
  o1: "00000000-0000-4000-8000-000000000501",
  o2: "00000000-0000-4000-8000-000000000502",
} as const;

export function coursePath(over: Partial<LearningCoursePath> = {}): LearningCoursePath {
  return {
    course: { id: ID.course, slug: "kardio", title: "Кардиология для практика", state: { status: "current" } },
    direction: { slug: "cardio", title: "Кардиология" },
    school: { slug: "school-a", title: "Школа сердца" },
    author: {
      slug: "ivanova",
      name: "Анна Иванова",
      role: "Кардиолог",
      credentials: "д. м. н.",
      affiliation: "НМИЦ",
      photoUrl: null,
    },
    signedIn: true,
    modules: [
      {
        id: ID.module,
        title: "Основы",
        position: 1,
        state: { status: "current" },
        club: null,
        lessons: [
          {
            id: ID.l1,
            number: 1,
            title: "Анамнез",
            durationMin: 12,
            stepCount: 1,
            state: { status: "done" },
            steps: [{ id: ID.s1, type: "video", title: "Сбор анамнеза", durationMin: 12, state: { status: "done" } }],
          },
          {
            id: ID.l2,
            number: 2,
            title: "ЭКГ",
            durationMin: 20,
            stepCount: 2,
            state: { status: "current" },
            steps: [
              { id: ID.s2, type: "video", title: "Чтение ЭКГ", durationMin: 15, state: { status: "current" } },
              { id: ID.s3, type: "download", title: "Памятка по ЭКГ", durationMin: 5, state: { status: "open" } },
            ],
          },
          {
            id: ID.l3,
            number: 3,
            title: "Итог модуля",
            durationMin: 10,
            stepCount: 1,
            state: { status: "locked", reason: { kind: "previous" } },
            steps: [
              {
                id: ID.s4,
                type: "test",
                title: "Итоговый тест",
                durationMin: 10,
                state: { status: "locked", reason: { kind: "previous" } },
              },
            ],
          },
        ],
      },
    ],
    document: { state: { status: "locked", reason: { kind: "previous" } } },
    current: { stepId: ID.s2, lessonId: ID.l2 },
    ...over,
  };
}

export function lessonRead(over: Partial<LearningLessonRead> = {}): LearningLessonRead {
  return {
    course: { id: ID.course, slug: "kardio", title: "Кардиология для практика" },
    lesson: {
      id: ID.l2,
      number: 2,
      title: "ЭКГ",
      description: "Как читать ЭКГ на приёме.",
      teaser: "",
      durationMin: 20,
      stepCount: 2,
      state: { status: "current" },
      completionSentence: "Урок пройден, когда пройдены все шаги.",
    },
    signedIn: true,
    steps: [
      { id: ID.s2, type: "video", title: "Чтение ЭКГ", durationMin: 15, state: { status: "current" }, completionSentence: "Досмотрите видео до конца." },
      { id: ID.s3, type: "download", title: "Памятка по ЭКГ", durationMin: 5, state: { status: "open" }, completionSentence: "Откройте материал." },
    ],
    ...over,
  };
}

export function videoStep(over: Partial<LearningStepRead> = {}): LearningStepRead {
  return {
    courseSlug: "kardio",
    lessonId: ID.l2,
    step: { id: ID.s2, type: "video", title: "Чтение ЭКГ", durationMin: 15, state: { status: "current" }, completionSentence: "Досмотрите видео до конца." },
    lessonCompletionSentence: "Урок пройден, когда пройдены все шаги.",
    body: { type: "video", provider: "rutube", embedRef: "0123456789abcdef0123456789abcdef", durationSec: 120, watchedPercent: 0, positionSec: 0 },
    nextStepId: ID.s3,
    ...over,
  };
}

/** A fetch stub answering by `METHOD path`; every call is recorded. */
export function stubFetch(routes: Record<string, unknown | (() => unknown)>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    if (!(key in routes)) return new Response("{}", { status: 404 });
    const v = routes[key];
    const body = typeof v === "function" ? (v as () => unknown)() : v;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** The posted JSON bodies of the calls to `METHOD path`. */
export function bodiesOf(fn: ReturnType<typeof stubFetch>, key: string): unknown[] {
  return fn.mock.calls
    .filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === key)
    .map(([, init]) => JSON.parse(String(init?.body ?? "null")));
}

/** jsdom has no matchMedia; `narrow` sets the canvas's narrow-axis query. */
export function stubMatchMedia(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: narrow,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

/**
 * A course of `modules` modules × `lessonsPer` lessons (video → download →
 * test), lessons before `hereLesson` done, its first step «Вы здесь», the rest
 * locked behind the previous — the volume the canvas is built for (3 / 6 / 26).
 */
export function multiModulePath(modules: number, lessonsPer: number, hereLesson: number): LearningCoursePath {
  const uuid = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;
  let lessonNo = 0;
  let hereStep = "";
  let hereLessonId = "";
  const mods: LearningCoursePath["modules"] = [];
  for (let m = 1; m <= modules; m++) {
    const lessons: LearningCoursePath["modules"][number]["lessons"] = [];
    for (let k = 1; k <= lessonsPer; k++) {
      lessonNo += 1;
      const n = lessonNo;
      const done = n < hereLesson;
      const here = n === hereLesson;
      const locked = { status: "locked", reason: { kind: "previous" } } as const;
      const lessonId = uuid(1_000 + n);
      const steps = (["video", "download", "test"] as const).map((type, si) => {
        const id = uuid(10_000 + n * 10 + si);
        if (here && si === 0) hereStep = id;
        const state = done
          ? ({ status: "done" } as const)
          : here && si === 0
            ? ({ status: "current" } as const)
            : locked;
        return { id, type, title: `${type === "video" ? "Серия" : type === "download" ? "Памятка" : "Тест"} урока ${n}`, durationMin: 5, state };
      });
      if (here) hereLessonId = lessonId;
      lessons.push({
        id: lessonId,
        number: n,
        title: `Урок о клиническом случае ${n}`,
        durationMin: 15,
        stepCount: 3,
        state: done ? { status: "done" } : here ? { status: "current" } : locked,
        steps,
      });
    }
    mods.push({
      id: uuid(100 + m),
      title: `Раздел ${m}`,
      position: m,
      state: { status: "current" },
      club: { state: { status: "locked", reason: { kind: "previous" } } },
      lessons,
    });
  }
  return coursePath({
    modules: mods,
    current: hereStep ? { stepId: hereStep, lessonId: hereLessonId } : null,
  });
}
