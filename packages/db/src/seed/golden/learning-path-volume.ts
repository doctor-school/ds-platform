// #4172 — the long learning paths at volume.
//
// The school volumes (`learning-volume.ts`, #4164) give every course ONE module,
// so a slot could not show the canvas path «с десятками шагов и дюжиной
// модулей»: the module headers, the long scroll, a locked tail. This published
// school carries two courses at the canvas volume switches — 12 and 30 modules,
// two or three lessons each — written as the admin path writes them: a video
// (the golden course's provider source), on every other lesson the golden memo
// download (no new media object), and an exit test closing every lesson, its
// questions and options as `learning_tests` / `learning_questions` /
// `learning_options` rows (`createStep` → `writeTest`). The course layer carries
// the volume courses' own values (`GOLDEN_VOLUME_COURSE_RULES`), which makes the
// lessons publishable (held by `packages/learning/src/golden-school-volume.test.ts`).
//
// No facts: a fresh doctor opens the path from its first step.
//
// Ordinals continue the scheme of `goldenLearningVolumeOrdinal` as school index
// 4 (`5001`, `5002` for the courses) with one more decimal level for the module,
// so no id meets a #4164 one: module `course·100 + m`, lesson `module·10 + l`,
// step `lesson·10 + s`, question `step·10 + q`, option `question·10 + o`.

import type {
  learningCourses,
  learningLessons,
  learningModules,
  learningOptions,
  learningQuestions,
  learningSchools,
  learningSteps,
  learningTests,
} from "../../schema/learning.js";
import { golden, goldenUuid, GOLDEN_GROUP } from "./ids.js";
import {
  goldenCourseMemoPdf,
  GOLDEN_COURSE_MEMO_CONTENT_TYPE,
  GOLDEN_COURSE_MEMO_KEY,
  GOLDEN_EXIT_QUESTIONS,
} from "./learning.js";
import { goldenDirectionId, GOLDEN_VOLUME_ORDINAL_BASE } from "./volume.js";

/** The long-path school: a volume ordinal of its group (named schools are 1, 11–14). */
export const GOLDEN_LEARNING_PATH_SCHOOL = Object.freeze({
  id: goldenUuid(GOLDEN_GROUP.learningSchools, GOLDEN_VOLUME_ORDINAL_BASE + 5),
  slug: "golden-school-clinical-cardiology",
});

/** The two long courses: the canvas switches «дюжина модулей» and 30. */
export const GOLDEN_LEARNING_PATH_COURSES = Object.freeze([
  Object.freeze({
    id: goldenUuid(GOLDEN_GROUP.learningCourses, 5001),
    slug: "golden-course-clinical-cardiology-12",
    modules: 12,
  }),
  Object.freeze({
    id: goldenUuid(GOLDEN_GROUP.learningCourses, 5002),
    slug: "golden-course-clinical-cardiology-30",
    modules: 30,
  }),
]);

/** Module topics, walked in order; a 30-module course takes them twice with a part number. */
const MODULE_TOPICS = [
  "Анатомия и физиология сердца",
  "ЭКГ: основы",
  "ЭКГ: нарушения ритма",
  "Артериальная гипертензия",
  "Ишемическая болезнь сердца",
  "Острый коронарный синдром",
  "Сердечная недостаточность",
  "Фибрилляция предсердий",
  "Клапанные пороки",
  "Кардиомиопатии",
  "Дислипидемии",
  "Профилактика и реабилитация",
  "Лёгочная гипертензия",
  "Миокардиты и перикардиты",
  "Синкопальные состояния",
] as const;

const LESSON_TITLES = [
  "Ключевые понятия",
  "Диагностика",
  "Лечение и наблюдение",
] as const;

/** Two lessons, then three, alternating down the course. */
export function goldenLearningPathLessonCount(module: number): number {
  return 2 + (module % 2);
}

export interface GoldenLearningPathVolume {
  learningSchools: (typeof learningSchools.$inferInsert)[];
  learningCourses: (typeof learningCourses.$inferInsert)[];
  learningModules: (typeof learningModules.$inferInsert)[];
  learningLessons: (typeof learningLessons.$inferInsert)[];
  learningSteps: (typeof learningSteps.$inferInsert)[];
  learningTests: (typeof learningTests.$inferInsert)[];
  learningQuestions: (typeof learningQuestions.$inferInsert)[];
  learningOptions: (typeof learningOptions.$inferInsert)[];
  /** The course ids whose own layer the caller writes (`GOLDEN_VOLUME_COURSE_RULES`). */
  ownLayerCourseIds: string[];
}

/** Builds the long-path school; `created` is the dataset's creation instant. */
export function buildGoldenLearningPathVolume(
  created: Date,
): GoldenLearningPathVolume {
  const projectId = golden.projects.publishedSchool.id;
  const stamps = { version: 1, createdAt: created, updatedAt: created };
  const memoBytes = goldenCourseMemoPdf().byteLength;
  const out: GoldenLearningPathVolume = {
    learningSchools: [
      {
        id: GOLDEN_LEARNING_PATH_SCHOOL.id,
        directionId: goldenDirectionId("cardiology"),
        leadExpertId: golden.experts.published.id,
        projectId,
        slug: GOLDEN_LEARNING_PATH_SCHOOL.slug,
        title: "Школа клинической кардиологии",
        state: "published",
        description:
          "Два больших курса по кардиологии: от ЭКГ и гипертензии до сердечной недостаточности и реабилитации — с тестом после каждого урока.",
        facts: [
          { label: "Формат", text: "Видеоуроки, памятки и тесты" },
          { label: "Для кого", text: "Кардиологи и терапевты" },
          { label: "Документ", text: "Сертификат с баллами НМО" },
        ],
        ...stamps,
      },
    ],
    learningCourses: [],
    learningModules: [],
    learningLessons: [],
    learningSteps: [],
    learningTests: [],
    learningQuestions: [],
    learningOptions: [],
    ownLayerCourseIds: [],
  };

  GOLDEN_LEARNING_PATH_COURSES.forEach((course, c) => {
    const courseOrdinal = 5001 + c;
    const lessonsTotal = Array.from({ length: course.modules }, (_, m) =>
      goldenLearningPathLessonCount(m),
    ).reduce((a, b) => a + b, 0);
    out.learningCourses.push({
      id: course.id,
      schoolId: GOLDEN_LEARNING_PATH_SCHOOL.id,
      projectId,
      slug: course.slug,
      title:
        course.modules === 12
          ? "Кардиология для терапевта: базовый курс"
          : "Клиническая кардиология: полный курс",
      state: "published",
      description: `${course.modules} модулей и ${lessonsTotal} уроков: видеолекции, памятки и тест после каждого урока — по действующим клиническим рекомендациям.`,
      academicHours: lessonsTotal * 2,
      documentKind: "certificate-nmo",
      documentPrerequisites:
        "Действующее свидетельство об аккредитации специалиста",
      partnerOrganisationId: null,
      position: c + 1,
      ...stamps,
    });
    out.ownLayerCourseIds.push(course.id);

    for (let m = 0; m < course.modules; m++) {
      const moduleOrdinal = courseOrdinal * 100 + m + 1;
      const moduleId = goldenUuid(GOLDEN_GROUP.learningModules, moduleOrdinal);
      const round = Math.floor(m / MODULE_TOPICS.length);
      const topic = MODULE_TOPICS[m % MODULE_TOPICS.length]!;
      out.learningModules.push({
        id: moduleId,
        courseId: course.id,
        position: m + 1,
        title: round === 0 ? topic : `${topic}. Часть ${round + 1}`,
        ...stamps,
      });
      for (let l = 0; l < goldenLearningPathLessonCount(m); l++) {
        const lessonOrdinal = moduleOrdinal * 10 + l + 1;
        const lessonId = goldenUuid(
          GOLDEN_GROUP.learningLessons,
          lessonOrdinal,
        );
        const lessonTitle = LESSON_TITLES[l]!;
        out.learningLessons.push({
          id: lessonId,
          moduleId,
          projectId,
          position: l + 1,
          title: lessonTitle,
          description: "",
          teaser: "",
          state: "published",
          ...stamps,
        });
        const stepOrdinal = (s: number) => lessonOrdinal * 10 + s + 1;
        const stepId = (s: number) =>
          goldenUuid(GOLDEN_GROUP.learningSteps, stepOrdinal(s));
        const subject = lessonTitle.toLowerCase();
        let position = 1;
        out.learningSteps.push({
          id: stepId(0),
          lessonId,
          position: position++,
          type: "video",
          title: `Видеолекция: ${subject}`,
          durationMin: 1,
          payload: { durationSec: 60 },
          provider: "youtube",
          embedRef: "dQw4w9WgXcQ",
          ...stamps,
        });
        if ((m + l) % 2 === 1) {
          out.learningSteps.push({
            id: stepId(1),
            lessonId,
            position: position++,
            type: "download",
            title: `Памятка: ${subject}`,
            durationMin: 2,
            payload: { fileName: "memo.pdf" },
            mediaRef: GOLDEN_COURSE_MEMO_KEY,
            mediaContentType: GOLDEN_COURSE_MEMO_CONTENT_TYPE,
            mediaSizeBytes: memoBytes,
            ...stamps,
          });
        }
        const testId = stepId(2);
        out.learningSteps.push({
          id: testId,
          lessonId,
          position: position++,
          type: "test",
          title: "Итоговый тест урока",
          durationMin: 3,
          payload: { kind: "exit" },
          ...stamps,
        });
        out.learningTests.push({ stepId: testId, kind: "exit", ...stamps });
        GOLDEN_EXIT_QUESTIONS.forEach((q, qi) => {
          const questionOrdinal = stepOrdinal(2) * 10 + qi + 1;
          const questionId = goldenUuid(
            GOLDEN_GROUP.learningQuestions,
            questionOrdinal,
          );
          out.learningQuestions.push({
            id: questionId,
            testId,
            position: qi + 1,
            text: q.text,
            correctiveText: null,
            createdAt: created,
          });
          q.options.forEach((o, oi) => {
            out.learningOptions.push({
              id: goldenUuid(
                GOLDEN_GROUP.learningOptions,
                questionOrdinal * 10 + oi + 1,
              ),
              questionId,
              position: oi + 1,
              text: o.text,
              correct: o.correct,
              createdAt: created,
            });
          });
        });
      }
    }
  });
  return out;
}
