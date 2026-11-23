// 024 EARS-24, EARS-29–31 (#4012) — submitted test results on the long paths.
//
// A slot runs only `seed:golden`, and until now no golden doctor had submitted
// a single test, so a rules editor raising a published course's pass mark had
// nobody to re-judge: the impact preview read zero and «Потребовать заново»
// reopened nothing. These rows are the long paths (`learning-path-volume.ts`)
// as doctors who have passed a prefix of their lessons leave them, written as
// the doctor endpoints write them:
//
// - per lesson, the client facts of its steps (`recordFact`: `position` for the
//   video at its full length, `opened` for the memo download) and a submitted
//   `learning_attempts` row with its `attempt-submitted` fact (`submitAttempt`:
//   event id `learning:attempt:<attemptId>`, source `system`, data
//   `{ attemptId, score, answers }`), graded on the two golden exit questions —
//   50 % (one right) or 100 %;
// - the `learning_node_status` projection those facts leave (`project()`): one
//   row per step, lesson, module and course, each with the fact that last moved
//   it. It is the projection a rule change diffs against — without it the
//   recompute would see every status as new and name no rule change (EARS-24).
//
// The long paths' own layer sets the pass mark to
// {@link GOLDEN_LEARNING_PATH_PASS_MARK} (50 %), so both scores pass today and
// raising it to 80 % with «Потребовать заново» re-judges every 50 % lesson:
//
// - realistic — the 12-module course: the verified golden doctor and its
//   worker-pool copies passed modules 1–4 (10 lessons), a third of them at 50 %;
// - extreme — the 30-module course: 200 doctors (the worker pool and
//   {@link GOLDEN_LEARNERS} non-login learners) passed two to five lessons,
//   each with at least one 50 %, so the preview reads «Изменится статус у 200
//   врачей» and the recompute runs at that size.
//
// The learners are mirror rows without an IdP account, exactly as the volume
// doctors are (`volume.ts` `buildDoctors`): nobody signs in as them.
//
// Ordinals sit in a #4012 range of their groups, above every existing one:
// users `4_012_000 + i`, attempts `4_012_000_000 + doctor·1000 + course·500 +
// lesson`, facts `4_012·10⁹ + doctor·10⁶ + course·10⁴ + lesson·10 + kind`.

import type { NewConsentRecord } from "../../schema/consent-records.js";
import type {
  learningAttempts,
  learningFacts,
  learningLessons,
  learningModules,
  learningNodeStatus,
  learningOptions,
  learningQuestions,
  learningSteps,
} from "../../schema/learning.js";
import type { NewUser } from "../../schema/users.js";
import { GOLDEN_CONSENT_PURPOSES, GOLDEN_CONSENT_VERSION } from "./consent.js";
import { golden, goldenUuid, GOLDEN_GROUP } from "./ids.js";
import { GOLDEN_LEARNING_PATH_COURSES } from "./learning-path-volume.js";

/** The long paths' exit-test pass mark: both a 50 % and a 100 % attempt pass. */
export const GOLDEN_LEARNING_PATH_PASS_MARK = 50;

/** Non-login doctors beside the worker pool on the 30-module course: 200 in all. */
export const GOLDEN_LEARNERS = 194;

/** The modules of the 12-module course the worker pool has passed. */
export const GOLDEN_RESULTS_REALISTIC_MODULES = 4;

const LEARNER_ORDINAL_BASE = 4_012_000;
const ATTEMPT_ORDINAL_BASE = 4_012_000_000;
const FACT_ORDINAL_BASE = 4_012_000_000_000;

/** The id of learner `i` (0-based). */
export function goldenLearnerId(i: number): string {
  return goldenUuid(GOLDEN_GROUP.users, LEARNER_ORDINAL_BASE + i);
}

const SURNAMES = [
  ["Андреев", "Андреева"],
  ["Белов", "Белова"],
  ["Власов", "Власова"],
  ["Гусев", "Гусева"],
  ["Давыдов", "Давыдова"],
  ["Ефимов", "Ефимова"],
  ["Жуков", "Жукова"],
  ["Зайцев", "Зайцева"],
  ["Ильин", "Ильина"],
  ["Комаров", "Комарова"],
  ["Лебедев", "Лебедева"],
  ["Медведев", "Медведева"],
  ["Никитин", "Никитина"],
  ["Орлов", "Орлова"],
  ["Павлов", "Павлова"],
  ["Романов", "Романова"],
  ["Соколов", "Соколова"],
  ["Тихонов", "Тихонова"],
  ["Уваров", "Уварова"],
  ["Фролов", "Фролова"],
] as const;
const GIVEN = [
  ["Алексей Петрович", "Анна Сергеевна"],
  ["Борис Николаевич", "Вера Андреевна"],
  ["Григорий Олегович", "Галина Ивановна"],
  ["Дмитрий Юрьевич", "Елена Викторовна"],
  ["Евгений Михайлович", "Жанна Павловна"],
  ["Игорь Владимирович", "Ирина Олеговна"],
  ["Константин Сергеевич", "Ксения Дмитриевна"],
  ["Максим Андреевич", "Марина Алексеевна"],
  ["Олег Викторович", "Ольга Николаевна"],
  ["Павел Игоревич", "Светлана Юрьевна"],
] as const;
const SPECIALTIES = ["Кардиология", "Терапия", "Общая врачебная практика (семейная медицина)"] as const;

/** Learner `i`'s display name: a surname × given-name walk, alternating gender. */
function learnerName(i: number): string {
  const g = i % 2;
  const surname = SURNAMES[Math.floor(i / 2) % SURNAMES.length]![g]!;
  const given = GIVEN[Math.floor(i / (2 * SURNAMES.length)) % GIVEN.length]![g]!;
  return `${surname} ${given}`;
}

export interface GoldenLearners {
  users: NewUser[];
  consentRecords: NewConsentRecord[];
  doctorSpecialties: {
    id: string;
    doctorId: string;
    specialtyName: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
}

/**
 * The non-login learners: active, verified doctors with their sign-up consents
 * and a specialty, created a year before «now» — before any fact they hold.
 */
export function buildGoldenLearners(now: Date): GoldenLearners {
  const day = (d: number) => new Date(now.getTime() + d * 86_400_000);
  const out: GoldenLearners = {
    users: [],
    consentRecords: [],
    doctorSpecialties: [],
  };
  for (let i = 0; i < GOLDEN_LEARNERS; i++) {
    const ordinal = LEARNER_ORDINAL_BASE + i;
    const id = goldenLearnerId(i);
    const created = day(-365 + (i % 60));
    out.users.push({
      id,
      // The `buildDoctors` shape: deterministic, unique, never a Zitadel snowflake.
      zitadelSub: `golden-volume-${ordinal}`,
      email: `golden.learner.${i + 1}@example.test`,
      displayName: learnerName(i),
      emailVerified: true,
      phoneVerified: false,
      role: "doctor_guest",
      recordStatus: "active",
      createdAt: created,
      updatedAt: created,
    });
    GOLDEN_CONSENT_PURPOSES.forEach((purpose, p) => {
      out.consentRecords.push({
        id: goldenUuid(GOLDEN_GROUP.consentRecords, ordinal * 10 + p),
        userId: id,
        purpose,
        version: GOLDEN_CONSENT_VERSION,
        capturedAt: created,
      });
    });
    out.doctorSpecialties.push({
      id: goldenUuid(GOLDEN_GROUP.doctorSpecialties, ordinal),
      doctorId: id,
      specialtyName: SPECIALTIES[i % SPECIALTIES.length]!,
      createdAt: created,
      updatedAt: created,
    });
  }
  return out;
}

interface PathRows {
  learningModules: readonly (typeof learningModules.$inferInsert)[];
  learningLessons: readonly (typeof learningLessons.$inferInsert)[];
  learningSteps: readonly (typeof learningSteps.$inferInsert)[];
  learningQuestions: readonly (typeof learningQuestions.$inferInsert)[];
  learningOptions: readonly (typeof learningOptions.$inferInsert)[];
}

export interface GoldenLearningResults {
  learningAttempts: (typeof learningAttempts.$inferInsert)[];
  learningFacts: (typeof learningFacts.$inferInsert)[];
  learningNodeStatus: (typeof learningNodeStatus.$inferInsert)[];
}

/** One doctor's results on one course: the score of each passed lesson, in order. */
export interface GoldenResultPlan {
  personId: string;
  /** Index into the doctor slot space (worker pool 0–5, then the learners). */
  slot: number;
  course: number;
  scores: number[];
}

/**
 * Who passed what. Worker-pool doctor `d` scores 50 on the lessons `i` with
 * `(i + d) % 3 === 1` of the 12-module course; on the 30-module course doctor
 * `s` passes `2 + s % 4` lessons, 50 where `(i + s) % 2 === 0`.
 */
export function goldenResultPlans(): GoldenResultPlan[] {
  const pool = golden.workerPool.verifiedCardiologist.map((d) => d.id);
  const lessonsIn = (modules: number) =>
    Array.from({ length: modules }, (_, m) => 2 + (m % 2)).reduce(
      (a, b) => a + b,
      0,
    );
  const realistic = lessonsIn(GOLDEN_RESULTS_REALISTIC_MODULES);
  const plans: GoldenResultPlan[] = [];
  pool.forEach((personId, d) => {
    plans.push({
      personId,
      slot: d,
      course: 0,
      scores: Array.from({ length: realistic }, (_, i) =>
        (i + d) % 3 === 1 ? 50 : 100,
      ),
    });
  });
  const extreme = [
    ...pool,
    ...Array.from({ length: GOLDEN_LEARNERS }, (_, i) => goldenLearnerId(i)),
  ];
  extreme.forEach((personId, s) => {
    plans.push({
      personId,
      slot: s,
      course: 1,
      scores: Array.from({ length: 2 + (s % 4) }, (_, i) =>
        (i + s) % 2 === 0 ? 50 : 100,
      ),
    });
  });
  return plans;
}

type Status = "done" | "current" | "open" | "locked";
interface Item {
  id: string;
  kind: "step" | "lesson" | "module" | "course";
}

/**
 * The statuses the evaluator gives a course under the long paths' own layer
 * (`order: strict`, `unlock: after-previous`, a lesson done when its steps are,
 * a module and the course when their lessons are) for a set of done steps:
 * an item behind a not-done sibling or inside a locked parent is locked, the
 * first open step is current and so are its lesson, module and course. Held
 * against `evaluateCourse` by `packages/learning/src/golden-learning-results.test.ts`.
 */
function statusesOf(
  tree: { id: string; lessons: { id: string; steps: string[] }[] }[],
  courseId: string,
  doneSteps: ReadonlySet<string>,
): Map<string, Status> {
  const out = new Map<string, Status>();
  const lessonDone = (l: { steps: string[] }) =>
    l.steps.length > 0 && l.steps.every((s) => doneSteps.has(s));
  const moduleDone = (m: (typeof tree)[number]) =>
    m.lessons.length > 0 && m.lessons.every(lessonDone);
  let current: { step: string; lesson: string; module: string } | null = null;
  let previousModuleDone: boolean | undefined;
  for (const module of tree) {
    const mLocked = previousModuleDone === false;
    out.set(module.id, moduleDone(module) ? "done" : mLocked ? "locked" : "open");
    let previousLessonDone: boolean | undefined;
    for (const lesson of module.lessons) {
      const lLocked = mLocked || previousLessonDone === false;
      out.set(lesson.id, lessonDone(lesson) ? "done" : lLocked ? "locked" : "open");
      let previousStepDone: boolean | undefined;
      for (const step of lesson.steps) {
        const sLocked = lLocked || previousStepDone === false;
        const done = doneSteps.has(step);
        let status: Status = done ? "done" : sLocked ? "locked" : "open";
        if (status === "open" && current === null) {
          current = { step, lesson: lesson.id, module: module.id };
          status = "current";
        }
        out.set(step, status);
        previousStepDone = done;
      }
      previousLessonDone = lessonDone(lesson);
    }
    previousModuleDone = moduleDone(module);
  }
  const all = tree.flatMap((m) => m.lessons);
  out.set(courseId, all.length > 0 && all.every(lessonDone) ? "done" : "open");
  if (current !== null) {
    const c = current as { lesson: string; module: string };
    for (const id of [c.lesson, c.module, courseId])
      if (out.get(id) === "open") out.set(id, "current");
  }
  return out;
}

/** Builds the attempts, facts and projection; `created` is the dataset's creation instant. */
export function buildGoldenLearningResults(
  created: Date,
  rows: PathRows,
): GoldenLearningResults {
  const out: GoldenLearningResults = {
    learningAttempts: [],
    learningFacts: [],
    learningNodeStatus: [],
  };
  const trees = GOLDEN_LEARNING_PATH_COURSES.map((course) =>
    rows.learningModules
      .filter((m) => m.courseId === course.id)
      .sort((a, b) => a.position - b.position)
      .map((m) => ({
        id: m.id!,
        lessons: rows.learningLessons
          .filter((l) => l.moduleId === m.id)
          .sort((a, b) => a.position - b.position)
          .map((l) => ({
            id: l.id!,
            steps: rows.learningSteps
              .filter((s) => s.lessonId === l.id)
              .sort((a, b) => a.position - b.position),
          })),
      })),
  );
  const answersOf = (testId: string, score: number) =>
    rows.learningQuestions
      .filter((q) => q.testId === testId)
      .sort((a, b) => a.position - b.position)
      .map((q, qi) => {
        const options = rows.learningOptions.filter((o) => o.questionId === q.id);
        // 100 %: both right; 50 %: the first right, the second wrong.
        const right = score === 100 || qi === 0;
        return {
          questionId: q.id!,
          optionId: options.find((o) => o.correct === right)!.id!,
        };
      });

  for (const plan of goldenResultPlans()) {
    const course = GOLDEN_LEARNING_PATH_COURSES[plan.course]!;
    const tree = trees[plan.course]!;
    const lessons = tree.flatMap((m) => m.lessons);
    // Each doctor starts on their own day, one lesson an hour, a minute a step.
    let t =
      created.getTime() +
      (40 + plan.course * 5 + (plan.slot % 20)) * 86_400_000 +
      Math.floor(plan.slot / 20) * 600_000;
    const doneSteps = new Set<string>();
    const shape = tree.map((m) => ({
      id: m.id,
      lessons: m.lessons.map((l) => ({ id: l.id, steps: l.steps.map((s) => s.id!) })),
    }));
    const projected = new Map<string, { status: Status; since: Date; causeId: string }>();
    const kinds = new Map<string, Item["kind"]>([[course.id, "course"]]);
    for (const m of tree) {
      kinds.set(m.id, "module");
      for (const l of m.lessons) {
        kinds.set(l.id, "lesson");
        for (const s of l.steps) kinds.set(s.id!, "step");
      }
    }
    const factId = (lesson: number, kind: number) =>
      goldenUuid(
        GOLDEN_GROUP.learningFacts,
        FACT_ORDINAL_BASE +
          plan.slot * 1_000_000 +
          plan.course * 10_000 +
          lesson * 10 +
          kind,
      );
    const record = (fact: (typeof learningFacts.$inferInsert), doneStep: string) => {
      out.learningFacts.push(fact);
      doneSteps.add(doneStep);
      // `project()`: diff the statuses against the projection, upsert the changed.
      for (const [itemId, status] of statusesOf(shape, course.id, doneSteps)) {
        if (projected.get(itemId)?.status === status) continue;
        projected.set(itemId, { status, since: fact.occurredAt!, causeId: fact.id! });
      }
    };

    plan.scores.forEach((score, li) => {
      const lesson = lessons[li]!;
      lesson.steps.forEach((step, si) => {
        const at = new Date(t + si * 60_000);
        if (step.type === "test") {
          const attemptId = goldenUuid(
            GOLDEN_GROUP.learningAttempts,
            ATTEMPT_ORDINAL_BASE + plan.slot * 1000 + plan.course * 500 + li,
          );
          const questionIds = rows.learningQuestions
            .filter((q) => q.testId === step.id)
            .sort((a, b) => a.position - b.position)
            .map((q) => q.id!);
          out.learningAttempts.push({
            id: attemptId,
            personId: plan.personId,
            testId: step.id!,
            questionIds,
            startedAt: new Date(at.getTime() - 30_000),
            submittedAt: at,
          });
          record(
            {
              id: factId(li, si),
              eventId: `learning:attempt:${attemptId}`,
              personId: plan.personId,
              kind: "attempt-submitted",
              stepId: step.id!,
              data: { attemptId, score, answers: answersOf(step.id!, score) },
              source: "system",
              occurredAt: at,
            },
            step.id!,
          );
        } else {
          record(
            {
              id: factId(li, si),
              eventId: `golden-4012-${step.id}`,
              personId: plan.personId,
              kind: step.type === "download" ? "opened" : "position",
              stepId: step.id!,
              data:
                step.type === "download"
                  ? {}
                  : { reportedSec: 60, positionSec: 60 },
              source: "web",
              occurredAt: at,
            },
            step.id!,
          );
        }
      });
      t += 3_600_000;
    });

    for (const [itemId, row] of projected) {
      out.learningNodeStatus.push({
        personId: plan.personId,
        itemKind: kinds.get(itemId)!,
        itemId,
        status: row.status,
        since: row.since,
        causeKind: "fact",
        causeId: row.causeId,
      });
    }
  }
  return out;
}
