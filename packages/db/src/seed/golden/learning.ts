// 024 (#4059) — the golden published learning course.
//
// The doctor course routes (`/courses/[courseSlug]`,
// `/courses/[courseSlug]/steps/[stepId]`) render a published course only, and the
// `live/doctor/learning` slot leg drives one end to end. A slot is a clone of
// `ds_golden`, so the course lives here, beside the other golden content.
//
// The rows are exactly what the admin API writes for the same course (the
// journey seed of `apps/api/test/learning/harness.ts` `buildCourse` plus a second
// lesson, «Путь (Duolingo)» applied on the course, lessons and course published):
//
//   * a test step's row keeps only `{ kind }` in `payload`; its questions and
//     options are `learning_tests` / `learning_questions` / `learning_options`
//     rows (`LearningAdminService.createStep` → `writeTest`);
//   * applying a preset writes the course rule layer with the preset's values
//     merged over the layer's own (none here) and `applied_preset_id` set
//     (`applyPreset` → `applyPresetValues`). The preset rows are inserted by
//     migration 0065 with generated ids, so the layer names its preset and the
//     plan resolves the row (id AND values) at seed time — never a copy of the
//     preset's contents in this file;
//   * the school is `published` with its 023 EARS-1 data, so the 023 school
//     read (`GET /v1/learning/schools/{slug}`) answers it on a slot; a seed
//     row sets the state directly rather than through the admin school publish
//     (`POST /v1/admin/learning/schools/{id}/publish`, 023 EARS-26);
//   * the course carries its 023 EARS-1 data and `position` 1 in the school, as
//     the admin course create writes it;
//   * the download step's file is a golden media object (`media.ts`), so the
//     signed link the step read hands out answers with a real PDF.
//
// `packages/learning/src/__tests__/golden-course.test.ts` holds these rows
// against the admin path's own validators (step payloads, the lesson publish
// requirements under the applied preset) and the evaluator.

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
import { goldenDirectionId } from "./volume.js";

/** The preset the golden course applies (its row name in `learning_presets`). */
export const GOLDEN_COURSE_PRESET_NAME = "Путь (Duolingo)";

/** Object-storage key of the golden course's download (lesson 1, step 2). */
export const GOLDEN_COURSE_MEMO_KEY = "golden/learning/memo.pdf";
export const GOLDEN_COURSE_MEMO_CONTENT_TYPE = "application/pdf";

/**
 * The memo PDF: a one-page, valid PDF 1.4 built from text alone, so its bytes —
 * and the `media_size_bytes` the step row records — are known without a PDF
 * library and are identical on every build.
 */
export function goldenCourseMemoPdf(): Uint8Array {
  const text = "Golden course memo";
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** A course rule layer that applies a preset, resolved against its row by the plan. */
export interface GoldenLearningPresetLayer {
  id: string;
  scopeKind: "course";
  scopeId: string;
  presetName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoldenLearning {
  learningSchools: (typeof learningSchools.$inferInsert)[];
  learningCourses: (typeof learningCourses.$inferInsert)[];
  learningModules: (typeof learningModules.$inferInsert)[];
  learningLessons: (typeof learningLessons.$inferInsert)[];
  learningSteps: (typeof learningSteps.$inferInsert)[];
  learningTests: (typeof learningTests.$inferInsert)[];
  learningQuestions: (typeof learningQuestions.$inferInsert)[];
  learningOptions: (typeof learningOptions.$inferInsert)[];
  learningRuleLayers: GoldenLearningPresetLayer[];
}

/** A two-question exit test, «Верно» the right option of each (the live journey answers by text). */
export const GOLDEN_EXIT_QUESTIONS = [
  {
    text: "Какой целевой уровень офисного АД у большинства пациентов с гипертензией?",
    options: [
      { text: "Верно", correct: true },
      { text: "Неверно", correct: false },
    ],
  },
  {
    text: "С чего начинают лечение при впервые выявленной гипертензии высокого риска?",
    options: [
      { text: "Неверно", correct: false },
      { text: "Верно", correct: true },
    ],
  },
] as const;

/** Builds every learning row of the golden course; `created` is the dataset's creation instant. */
export function buildGoldenLearning(created: Date): GoldenLearning {
  const L = golden.learning;
  const projectId = golden.projects.publishedSchool.id;
  const stamps = { version: 1, createdAt: created, updatedAt: created };
  const memo = goldenCourseMemoPdf();

  const steps: GoldenLearning["learningSteps"] = [
    {
      id: L.steps.firstVideo.id,
      lessonId: L.lessons.first.id,
      position: 1,
      type: "video",
      title: "Как измерять давление правильно",
      durationMin: 1,
      payload: { durationSec: 60 },
      provider: "youtube",
      embedRef: "dQw4w9WgXcQ",
      ...stamps,
    },
    {
      id: L.steps.firstDownload.id,
      lessonId: L.lessons.first.id,
      position: 2,
      type: "download",
      title: "Памятка по измерению АД",
      durationMin: 2,
      payload: { fileName: "memo.pdf" },
      mediaRef: GOLDEN_COURSE_MEMO_KEY,
      mediaContentType: GOLDEN_COURSE_MEMO_CONTENT_TYPE,
      mediaSizeBytes: memo.byteLength,
      ...stamps,
    },
    {
      id: L.steps.firstExitTest.id,
      lessonId: L.lessons.first.id,
      position: 3,
      type: "test",
      title: "Итоговый тест урока",
      durationMin: 3,
      payload: { kind: "exit" },
      ...stamps,
    },
    {
      id: L.steps.secondVideo.id,
      lessonId: L.lessons.second.id,
      position: 1,
      type: "video",
      title: "Выбор стартовой терапии",
      durationMin: 1,
      payload: { durationSec: 60 },
      provider: "youtube",
      embedRef: "dQw4w9WgXcQ",
      ...stamps,
    },
    {
      id: L.steps.secondExitTest.id,
      lessonId: L.lessons.second.id,
      position: 2,
      type: "test",
      title: "Итоговый тест урока",
      durationMin: 3,
      payload: { kind: "exit" },
      ...stamps,
    },
  ];

  const tests = [L.steps.firstExitTest.id, L.steps.secondExitTest.id];
  const questions: GoldenLearning["learningQuestions"] = [];
  const options: GoldenLearning["learningOptions"] = [];
  tests.forEach((testId, ti) => {
    GOLDEN_EXIT_QUESTIONS.forEach((q, qi) => {
      const questionId = goldenUuid(
        GOLDEN_GROUP.learningQuestions,
        ti * GOLDEN_EXIT_QUESTIONS.length + qi + 1,
      );
      questions.push({
        id: questionId,
        testId,
        position: qi + 1,
        text: q.text,
        correctiveText: null,
        createdAt: created,
      });
      q.options.forEach((o, oi) => {
        options.push({
          id: goldenUuid(
            GOLDEN_GROUP.learningOptions,
            (ti * GOLDEN_EXIT_QUESTIONS.length + qi) * 2 + oi + 1,
          ),
          questionId,
          position: oi + 1,
          text: o.text,
          correct: o.correct,
          createdAt: created,
        });
      });
    });
  });

  return {
    learningSchools: [
      {
        id: L.school.id,
        directionId: goldenDirectionId("cardiology"),
        leadExpertId: golden.experts.published.id,
        projectId,
        slug: L.school.slug,
        title: "Школа кардиологии",
        state: "published",
        description:
          "Школа о диагностике и лечении сердечно-сосудистых заболеваний для практикующих врачей.",
        facts: [
          { label: "Формат", text: "Видеоуроки, памятки и тесты" },
          { label: "Ведущий эксперт", text: "Практикующий кардиолог" },
        ],
        ...stamps,
      },
    ],
    learningCourses: [
      {
        id: L.course.id,
        schoolId: L.school.id,
        projectId,
        slug: L.course.slug,
        title: "Артериальная гипертензия: от измерения к терапии",
        state: "published",
        description:
          "Как правильно измерить давление, поставить диагноз и выбрать стартовую терапию.",
        academicHours: 2,
        documentKind: "certificate",
        documentPrerequisites: "",
        position: 1,
        // Published when created, before any doctor reached it (024 EARS-30):
        // the seed runs after migration 0069's backfill, so it stamps the instant.
        firstPublishedAt: created,
        ...stamps,
      },
    ],
    learningModules: [
      {
        id: L.modules.first.id,
        courseId: L.course.id,
        position: 1,
        title: "Диагностика",
        ...stamps,
      },
      {
        id: L.modules.second.id,
        courseId: L.course.id,
        position: 2,
        title: "Лечение",
        ...stamps,
      },
    ],
    learningLessons: [
      {
        id: L.lessons.first.id,
        moduleId: L.modules.first.id,
        projectId,
        position: 1,
        title: "Измерение артериального давления",
        description: "",
        teaser: "",
        state: "published",
        ...stamps,
      },
      {
        id: L.lessons.second.id,
        moduleId: L.modules.second.id,
        projectId,
        position: 1,
        title: "Стартовая терапия",
        description: "",
        teaser: "",
        state: "published",
        ...stamps,
      },
    ],
    learningSteps: steps,
    learningTests: tests.map((stepId) => ({ stepId, kind: "exit", ...stamps })),
    learningQuestions: questions,
    learningOptions: options,
    learningRuleLayers: [
      {
        id: L.courseRules.id,
        scopeKind: "course",
        scopeId: L.course.id,
        presetName: GOLDEN_COURSE_PRESET_NAME,
        createdAt: created,
        updatedAt: created,
      },
    ],
  };
}
