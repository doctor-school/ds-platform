import {
  learningAttempts,
  learningFacts,
  learningTests,
  type LearningCourseRow,
  type LearningStepRow,
} from "@ds/db";
import type {
  LearningAttempt,
  LearningAttemptResult,
  LearningCoursePath,
  LearningLessonRead,
  LearningNodeState,
  LearningStepBody,
  LearningStepRead,
  RecordLearningFactRequest,
  RecordLearningFactResponse,
  SubmitLearningAttemptRequest,
} from "@ds/schemas";
import { RecordLearningFactRequestSchema } from "@ds/schemas";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  elementType,
  videoDurationSec,
  watchedPercent,
} from "../catalog/element-types.js";
import {
  evaluateCourse,
  type LearningCourseEvaluator,
  type LearningEvaluation,
} from "../evaluator/evaluator.js";
import {
  LearningServerError,
  type LearningServerDeps,
  type LearningTx,
} from "./deps.js";
import {
  lockPersonCourse,
  project,
  type LearningStatusChange,
} from "./projector.js";
import {
  courseBySlug,
  courseOfLesson,
  courseOfStep,
  loadCourseTree,
  loadFacts,
  loadLayersFor,
  loadQuestions,
  scopesOf,
  type LoadedCourse,
} from "./repository.js";

// 024 EARS-10, EARS-11, EARS-13, EARS-15, EARS-17, EARS-18 — the doctor-side
// reads and writes, served alike to the website and the mobile app (EARS-25).
// Every status is the evaluator's result over the doctor's facts and the rules
// resolved now; the projection only detects transitions (EARS-11, EARS-12).

type Handle = LearningServerDeps["db"] | LearningTx;

interface Evaluated {
  loaded: LoadedCourse;
  evaluator: LearningCourseEvaluator;
  evaluation: LearningEvaluation;
}

const notFound = (what: string) =>
  new LearningServerError("NOT_FOUND", `${what} not found`);

const locked = () =>
  new LearningServerError(
    "LEARNING_STEP_LOCKED",
    "this step is not open for you yet",
  );

export class LearningDoctorService {
  constructor(private readonly deps: LearningServerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** The published course, evaluated for a doctor (or a guest, with no facts). */
  private async evaluate(
    db: Handle,
    course: LearningCourseRow,
    personId: string | null,
  ): Promise<Evaluated> {
    const loaded = await loadCourseTree(db, course, true);
    const layers = await loadLayersFor(db, scopesOf(loaded));
    const facts = personId ? await loadFacts(db, personId, loaded) : [];
    const { evaluator, evaluation } = evaluateCourse({
      course: loaded.model,
      layers,
      facts,
      now: this.now(),
    });
    return { loaded, evaluator, evaluation };
  }

  /** The published course a published step belongs to, or 404. */
  private async publishedStep(db: Handle, stepId: string) {
    const owner = await courseOfStep(db, stepId);
    if (
      !owner ||
      owner.step.removedAt ||
      owner.lesson.state !== "published" ||
      owner.course.state !== "published"
    )
      throw notFound("step");
    return owner;
  }

  private stateOf(e: Evaluated, id: string): LearningNodeState {
    return e.evaluation.states.get(id) ?? { status: "open" };
  }

  /** WHILE the resolved visibility is `hidden`, a locked item is omitted (EARS-13). */
  private hidden(
    e: Evaluated,
    kind: "step" | "lesson" | "module",
    id: string,
  ): boolean {
    return (
      this.stateOf(e, id).status === "locked" &&
      e.evaluator.setting("lockedVisibility", { kind, id }) === "hidden"
    );
  }

  /** The lesson's ordinal in the whole course, from 1 («Урок N»). */
  private lessonNumbers(e: Evaluated): Map<string, number> {
    const numbers = new Map<string, number>();
    for (const m of e.loaded.model.modules)
      for (const l of m.lessons) numbers.set(l.id, numbers.size + 1);
    return numbers;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** EARS-13 — `GET /v1/learning/courses/{courseSlug}/path`. */
  async path(
    courseSlug: string,
    personId: string | null,
  ): Promise<LearningCoursePath> {
    const course = await courseBySlug(this.deps.db, courseSlug);
    if (!course || course.state !== "published") throw notFound("course");
    const e = await this.evaluate(this.deps.db, course, personId);
    const numbers = this.lessonNumbers(e);
    const modules = e.loaded.model.modules
      .filter((m) => !this.hidden(e, "module", m.id))
      .map((m) => {
        const row = e.loaded.modules.find((r) => r.id === m.id)!;
        const club = e.evaluation.clubs.get(m.id);
        return {
          id: m.id,
          title: m.title,
          position: row.position,
          state: this.stateOf(e, m.id),
          lessons: m.lessons
            .filter((l) => !this.hidden(e, "lesson", l.id))
            .map((l) => ({
              id: l.id,
              number: numbers.get(l.id)!,
              title: l.title,
              durationMin: l.steps.reduce((sum, s) => sum + s.durationMin, 0),
              stepCount: l.steps.length,
              state: this.stateOf(e, l.id),
              steps: l.steps
                .filter((s) => !this.hidden(e, "step", s.id))
                .map((s) => ({
                  id: s.id,
                  type: s.type,
                  title: s.title,
                  durationMin: s.durationMin,
                  state: this.stateOf(e, s.id),
                })),
            })),
          club: club ? { state: club } : null,
        };
      });
    return {
      course: {
        id: course.id,
        slug: course.slug,
        title: course.title,
        state: this.stateOf(e, course.id),
      },
      signedIn: personId !== null,
      modules,
      document: { state: e.evaluation.document },
      current: e.evaluation.current,
    };
  }

  /** EARS-15, EARS-17 — `GET /v1/learning/lessons/{lessonId}`; no step payload. */
  async lesson(
    lessonId: string,
    personId: string | null,
  ): Promise<LearningLessonRead> {
    const owner = await courseOfLesson(this.deps.db, lessonId);
    if (
      !owner ||
      owner.lesson.state !== "published" ||
      owner.course.state !== "published"
    )
      throw notFound("lesson");
    const e = await this.evaluate(this.deps.db, owner.course, personId);
    const model = e.evaluator.index.lessons.get(lessonId)?.lesson;
    if (!model) throw notFound("lesson");
    return {
      course: {
        id: owner.course.id,
        slug: owner.course.slug,
        title: owner.course.title,
      },
      lesson: {
        id: lessonId,
        number: this.lessonNumbers(e).get(lessonId)!,
        title: owner.lesson.title,
        description: owner.lesson.description,
        teaser: owner.lesson.teaser,
        durationMin: model.steps.reduce((sum, s) => sum + s.durationMin, 0),
        stepCount: model.steps.length,
        state: this.stateOf(e, lessonId),
        completionSentence: e.evaluator.sentence({
          kind: "lesson",
          id: lessonId,
        }),
      },
      signedIn: personId !== null,
      steps: model.steps
        .filter((s) => !this.hidden(e, "step", s.id))
        .map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          durationMin: s.durationMin,
          state: this.stateOf(e, s.id),
          completionSentence: e.evaluator.sentence({ kind: "step", id: s.id }),
        })),
    };
  }

  /**
   * EARS-15, EARS-16, EARS-18 — `GET /v1/me/learning/steps/{stepId}`: an
   * openable step's body for a signed-in doctor; a locked step is refused
   * with no content (the host refuses a guest with 401 before this).
   */
  async step(stepId: string, personId: string): Promise<LearningStepRead> {
    const owner = await this.publishedStep(this.deps.db, stepId);
    const e = await this.evaluate(this.deps.db, owner.course, personId);
    const state = this.stateOf(e, stepId);
    if (state.status === "locked") throw locked();
    const entry = e.evaluator.index.steps.get(stepId)!;
    const order = [...e.evaluator.index.steps.keys()];
    const nextId = order[order.indexOf(stepId) + 1] ?? null;
    const nextOpen =
      nextId !== null && this.stateOf(e, nextId).status !== "locked"
        ? nextId
        : null;
    return {
      courseSlug: owner.course.slug,
      lessonId: owner.lesson.id,
      step: {
        id: stepId,
        type: entry.step.type,
        title: entry.step.title,
        durationMin: entry.step.durationMin,
        state,
        completionSentence: e.evaluator.sentence({ kind: "step", id: stepId }),
      },
      lessonCompletionSentence: e.evaluator.sentence({
        kind: "lesson",
        id: owner.lesson.id,
      }),
      body: await this.body(owner.step, e, personId),
      nextStepId: nextOpen,
    };
  }

  private async body(
    row: LearningStepRow,
    e: Evaluated,
    personId: string,
  ): Promise<LearningStepBody> {
    const step = e.evaluator.index.steps.get(row.id)!.step;
    if (step.type === "video" || step.type === "download") {
      // Published steps always carry their media (EARS-4); sign it per read.
      if (!row.mediaRef) throw notFound("step media");
      const mediaUrl = await this.deps.media.signedUrl(row.mediaRef);
      if (step.type === "video") {
        const duration = videoDurationSec(step);
        return {
          type: "video",
          mediaUrl,
          durationSec: duration,
          watchedPercent: Math.min(100, watchedPercent(step, e.evaluator)),
          positionSec: Math.min(
            e.evaluator.facts.maxPosition(step.id),
            duration,
          ),
        };
      }
      return {
        type: "download",
        mediaUrl,
        fileName: String(step.payload["fileName"] ?? ""),
        fileSizeBytes: row.mediaSizeBytes ?? 0,
        opened: e.evaluator.facts.opened(step.id),
      };
    }
    const questions = await loadQuestions(this.deps.db, row.id);
    const perAttempt = e.evaluator.setting("test.questions", step);
    const usage = await this.attemptUsage(this.deps.db, personId, row.id, e);
    const [last] = await this.deps.db
      .select({ data: learningFacts.data })
      .from(learningFacts)
      .where(
        and(
          eq(learningFacts.personId, personId),
          eq(learningFacts.stepId, row.id),
          eq(learningFacts.kind, "attempt-submitted"),
        ),
      )
      .orderBy(desc(learningFacts.recordedAt))
      .limit(1);
    const threshold = e.evaluator.setting("test.threshold", step);
    const lastScore = last
      ? Number((last.data as Record<string, unknown>)["score"] ?? 0)
      : null;
    return {
      type: "test",
      testId: row.id,
      kind: "exit",
      questionCount:
        perAttempt === "all"
          ? questions.length
          : Math.min(perAttempt, questions.length),
      threshold,
      attemptsLeft: usage.attemptsLeft,
      lastResult:
        lastScore === null
          ? null
          : { score: lastScore, passed: lastScore >= threshold },
    };
  }

  // ── Facts intake (EARS-10) ────────────────────────────────────────────────

  /** EARS-10 — validate, store append-only (a replay is a duplicate), re-evaluate, project. */
  async recordFact(
    personId: string,
    raw: RecordLearningFactRequest,
  ): Promise<RecordLearningFactResponse> {
    const fact = RecordLearningFactRequestSchema.parse(raw);
    let afterCommit: (() => Promise<void>) | null = null;
    const response = await this.deps.transaction(async (tx) => {
      const owner = await this.publishedStep(tx, fact.stepId);
      const def = elementType(owner.step.type);
      if (!def || !def.clientFacts.includes(fact.kind)) {
        throw new LearningServerError(
          "VALIDATION_FAILED",
          "this step does not take that progress",
          [
            {
              path: "kind",
              message: `a ${owner.step.type} step does not record «${fact.kind}»`,
            },
          ],
        );
      }
      await lockPersonCourse(tx, personId, owner.course.id);
      const before = await this.evaluate(tx, owner.course, personId);
      if (this.stateOf(before, fact.stepId).status === "locked") throw locked();
      const inserted = await tx
        .insert(learningFacts)
        .values({
          eventId: fact.eventId,
          personId,
          kind: fact.kind,
          stepId: fact.stepId,
          data: fact.data,
          source: fact.source,
          occurredAt: fact.occurredAt ? new Date(fact.occurredAt) : this.now(),
        })
        .onConflictDoNothing({ target: learningFacts.eventId })
        .returning({ id: learningFacts.id });
      if (inserted.length === 0)
        return { outcome: "duplicate" as const, changed: [] };
      const after = await this.evaluate(tx, owner.course, personId);
      const projection = await project(this.deps, tx, {
        personId,
        evaluator: after.evaluator,
        evaluation: after.evaluation,
        cause: { kind: "fact", id: inserted[0]!.id },
        at: this.now(),
      });
      afterCommit = projection.afterCommit;
      return { outcome: "recorded" as const, changed: projection.changed };
    });
    if (afterCommit) await (afterCommit as () => Promise<void>)();
    return response;
  }

  // ── Attempts (EARS-18) ────────────────────────────────────────────────────

  /** How many attempts are left and when the next one opens. */
  private async attemptUsage(
    db: Handle,
    personId: string,
    testId: string,
    e: Evaluated,
  ): Promise<{ attemptsLeft: number | null; nextAt: Date | null }> {
    const ref = { kind: "step" as const, id: testId };
    const limit = e.evaluator.setting("test.attempts", ref);
    const pauseMin = e.evaluator.setting("test.pauseMin", ref);
    const submitted = await db
      .select({ at: learningAttempts.submittedAt })
      .from(learningAttempts)
      .where(
        and(
          eq(learningAttempts.personId, personId),
          eq(learningAttempts.testId, testId),
          isNotNull(learningAttempts.submittedAt),
        ),
      )
      .orderBy(desc(learningAttempts.submittedAt));
    const attemptsLeft =
      limit === "unlimited" ? null : Math.max(0, limit - submitted.length);
    const lastAt = submitted[0]?.at ?? null;
    const opensAt =
      lastAt && pauseMin > 0
        ? new Date(lastAt.getTime() + pauseMin * 60_000)
        : null;
    return {
      attemptsLeft,
      nextAt: opensAt && opensAt > this.now() ? opensAt : null,
    };
  }

  /** EARS-18 — start an attempt: the resolved number of questions, no correct answers. */
  async startAttempt(
    personId: string,
    testId: string,
  ): Promise<LearningAttempt> {
    return this.deps.transaction(async (tx) => {
      const owner = await this.publishedStep(tx, testId);
      const [test] = await tx
        .select()
        .from(learningTests)
        .where(eq(learningTests.stepId, testId));
      if (!test) throw notFound("test");
      await lockPersonCourse(tx, personId, owner.course.id);
      const e = await this.evaluate(tx, owner.course, personId);
      if (this.stateOf(e, testId).status === "locked") throw locked();
      const usage = await this.attemptUsage(tx, personId, testId, e);
      if (usage.attemptsLeft === 0)
        throw new LearningServerError(
          "LEARNING_ATTEMPT_UNAVAILABLE",
          "no attempts are left",
        );
      if (usage.nextAt)
        throw new LearningServerError(
          "LEARNING_ATTEMPT_UNAVAILABLE",
          "the next attempt opens after the pause",
          [],
          usage.nextAt,
        );
      const all = await loadQuestions(tx, testId);
      const perAttempt = e.evaluator.setting("test.questions", {
        kind: "step",
        id: testId,
      });
      const drawn =
        perAttempt === "all" || perAttempt >= all.length
          ? all
          : shuffle(all).slice(0, perAttempt);
      const [attempt] = await tx
        .insert(learningAttempts)
        .values({
          personId,
          testId,
          questionIds: drawn.map((q) => q.id),
          startedAt: this.now(),
        })
        .returning({ id: learningAttempts.id });
      return {
        attemptId: attempt!.id,
        testId,
        questions: drawn.map((q) => ({
          id: q.id,
          text: q.text,
          options: q.options.map((o) => ({ id: o.id, text: o.text })),
        })),
      };
    });
  }

  /** EARS-18 — grade on the server, store the attempt as a fact, re-evaluate and project. */
  async submitAttempt(
    personId: string,
    attemptId: string,
    input: SubmitLearningAttemptRequest,
  ): Promise<LearningAttemptResult> {
    let afterCommit: (() => Promise<void>) | null = null;
    const result = await this.deps.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(learningAttempts)
        .where(eq(learningAttempts.id, attemptId))
        .for("update");
      if (!attempt || attempt.personId !== personId) throw notFound("attempt");
      if (attempt.submittedAt)
        throw new LearningServerError(
          "INVALID_TRANSITION",
          "this attempt is already submitted",
        );
      const owner = await this.publishedStep(tx, attempt.testId);
      await lockPersonCourse(tx, personId, owner.course.id);
      const questionIds = attempt.questionIds as string[];
      const questions = (await loadQuestions(tx, attempt.testId)).filter((q) =>
        questionIds.includes(q.id),
      );
      const chosen = new Map(
        input.answers.map((a) => [a.questionId, a.optionId]),
      );
      const correct = questions.filter((q) =>
        q.options.some((o) => o.correct && o.id === chosen.get(q.id)),
      ).length;
      const score =
        questionIds.length === 0
          ? 0
          : Math.round((correct / questionIds.length) * 100);
      const at = this.now();
      await tx
        .update(learningAttempts)
        .set({ submittedAt: at })
        .where(eq(learningAttempts.id, attemptId));
      const [fact] = await tx
        .insert(learningFacts)
        .values({
          eventId: `learning:attempt:${attemptId}`,
          personId,
          kind: "attempt-submitted",
          stepId: attempt.testId,
          data: {
            attemptId,
            score,
            answers: input.answers.filter((a) =>
              questionIds.includes(a.questionId),
            ),
          },
          source: "system",
          occurredAt: at,
        })
        .returning({ id: learningFacts.id });
      const e = await this.evaluate(tx, owner.course, personId);
      const projection = await project(this.deps, tx, {
        personId,
        evaluator: e.evaluator,
        evaluation: e.evaluation,
        cause: { kind: "fact", id: fact!.id },
        at,
      });
      afterCommit = projection.afterCommit;
      const threshold = e.evaluator.setting("test.threshold", {
        kind: "step",
        id: attempt.testId,
      });
      const usage = await this.attemptUsage(tx, personId, attempt.testId, e);
      return {
        score,
        threshold,
        passed: score >= threshold,
        attemptsLeft: usage.attemptsLeft,
        nextAt: usage.nextAt?.toISOString() ?? null,
        changed: projection.changed as LearningStatusChange[],
      };
    });
    if (afterCommit) await (afterCommit as () => Promise<void>)();
    return result;
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
