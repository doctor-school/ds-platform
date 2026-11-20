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
  LearningPathAuthor,
  LearningPathStep,
  LearningSchoolRead,
  LearningStepBody,
  LearningStepRead,
  RecordLearningFactRequest,
  RecordLearningFactResponse,
  SubmitLearningAttemptRequest,
} from "@ds/schemas";
import {
  RecordLearningFactRequestSchema,
  expertDisplayName,
} from "@ds/schemas";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  clampReportedPosition,
  elementType,
  videoDurationSec,
  watchedPercent,
} from "../catalog/element-types.js";
import {
  evaluateCourse,
  type LearningCourseEvaluator,
  type LearningEvaluation,
} from "../evaluator/evaluator.js";
import { courseProgress, nextLessonNumber } from "../evaluator/course-progress.js";
import {
  LearningServerError,
  SERVER_EVENT_PREFIX,
  type LearningServerDeps,
  type LearningTx,
} from "./deps.js";
import {
  lockPersonCourse,
  project,
  type LearningStatusChange,
} from "./projector.js";
import { fileFormatLabel } from "./file-format.js";
import {
  courseBySlug,
  coursePlaces,
  courseOfLesson,
  courseOfStep,
  loadCourseTree,
  loadCourseTrees,
  loadFacts,
  loadFactsOfCourses,
  loadLayersFor,
  loadQuestions,
  publicPartnerNames,
  publishedCoursesOfSchool,
  questionCounts,
  schoolBySlug,
  scopesOf,
  type LoadedCourse,
} from "./repository.js";

// 024 EARS-10, EARS-11, EARS-13, EARS-15, EARS-17, EARS-18 — the doctor-side
// reads and writes, served alike to the website and the mobile app (EARS-25).
// Every status is the evaluator's result over the doctor's facts and the rules
// resolved now; the projection only detects transitions (EARS-11, EARS-12).

type Handle = LearningServerDeps["db"] | LearningTx;

/** The leading expert as `coursePlaces` reads it (null unless public). */
type PlacesExpert = NonNullable<Awaited<ReturnType<typeof coursePlaces>>>["expert"];

interface Evaluated {
  loaded: LoadedCourse;
  evaluator: LearningCourseEvaluator;
  evaluation: LearningEvaluation;
}

/** A step node's kicker facts (EARS-13): a test's questions and pass mark, a download's file. */
type KickerFacts = Pick<LearningPathStep, "test" | "file">;

/** The questions one attempt draws: `test.questions`, or every live question. */
const drawnPerAttempt = (perAttempt: number | "all", live: number): number =>
  perAttempt === "all" ? live : Math.min(perAttempt, live);

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

  /**
   * EARS-13 — the kicker facts of the course's steps, read once per request:
   * a test's questions per attempt and resolved pass mark (EARS-8), a
   * download's uploaded file format and size. Public facts (EARS-22): no
   * question text, no file URL.
   */
  private async kickerFacts(
    db: Handle,
    e: Evaluated,
  ): Promise<(stepId: string) => KickerFacts> {
    const rows = new Map(e.loaded.steps.map((r) => [r.id, r]));
    const tests = [...e.evaluator.index.steps.values()]
      .map((entry) => entry.step)
      .filter((st) => st.type === "test");
    const counts = await questionCounts(
      db,
      tests.map((t) => t.id),
    );
    return (stepId) => {
      const step = e.evaluator.index.steps.get(stepId)?.step;
      const row = rows.get(stepId);
      if (!step || !row) return { test: null, file: null };
      if (step.type === "test")
        return {
          test: {
            questionCount: drawnPerAttempt(
              e.evaluator.setting("test.questions", step),
              counts.get(stepId) ?? 0,
            ),
            threshold: e.evaluator.setting("test.threshold", step),
          },
          file: null,
        };
      if (step.type === "download") {
        // A published download always carries its file (EARS-4); without one there is no fact to show.
        const format = row.mediaRef
          ? fileFormatLabel(row.mediaContentType, String(step.payload["fileName"] ?? ""))
          : null;
        return {
          test: null,
          file:
            format !== null && row.mediaSizeBytes !== null
              ? { format, sizeBytes: row.mediaSizeBytes }
              : null,
        };
      }
      return { test: null, file: null };
    };
  }

  /** EARS-14 — the school's leading expert as the public author; null unless public and named. */
  private async author(
    x: PlacesExpert,
  ): Promise<LearningPathAuthor | null> {
    const name = x ? expertDisplayName(x) : null;
    if (!x || !name) return null;
    return {
      slug: x.slug,
      name,
      role: x.professionalRole,
      credentials: x.credentials,
      affiliation: x.affiliation,
      photoUrl: x.photoRef ? await this.deps.media.signedUrl(x.photoRef) : null,
    };
  }

  /** 023 EARS-1, EARS-22 — a course's data on the school card and the course header. */
  private courseData(
    course: LearningCourseRow,
    lessonCount: number,
    partners: Map<string, string>,
  ) {
    const partner = course.partnerOrganisationId
      ? partners.get(course.partnerOrganisationId)
      : undefined;
    return {
      description: course.description,
      academicHours: course.academicHours,
      lessonCount,
      document: {
        kind: course.documentKind,
        prerequisites: course.documentPrerequisites,
      },
      partner: partner !== undefined ? { name: partner } : null,
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * 023 EARS-3 — `GET /v1/learning/schools/{schoolSlug}`: the published
   * school, its published courses in school order with their data and, for a
   * signed-in doctor, each course's state from the 024 evaluator.
   */
  async school(
    schoolSlug: string,
    personId: string | null,
  ): Promise<LearningSchoolRead> {
    const db = this.deps.db;
    const school = await schoolBySlug(db, schoolSlug);
    if (!school || school.state !== "published") throw notFound("school");
    const places = await coursePlaces(db, school.id);
    if (!places) throw notFound("school");
    const rows = await publishedCoursesOfSchool(db, school.id);
    const partners = await publicPartnerNames(
      db,
      rows.flatMap((r) => (r.partnerOrganisationId ? [r.partnerOrganisationId] : [])),
    );
    // 023-design §4 «One batched read»: every course's tree, the rule layers
    // of all their items and the doctor's facts are loaded once; each course
    // is then evaluated in memory.
    const trees = await loadCourseTrees(db, rows, true);
    const scopes = new Map(
      trees.flatMap(scopesOf).map((sc) => [`${sc.kind}:${sc.id}`, sc] as const),
    );
    const layers = await loadLayersFor(db, [...scopes.values()]);
    const facts = personId
      ? await loadFactsOfCourses(db, personId, trees)
      : trees.map(() => []);
    const now = this.now();
    const courses = trees.map((loaded, i) => {
      const { row } = loaded;
      const { evaluation } = evaluateCourse({
        course: loaded.model,
        layers,
        facts: facts[i]!,
        now,
      });
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        ...this.courseData(row, loaded.lessons.length, partners),
        state: personId ? courseProgress(loaded.model, evaluation) : null,
        nextLessonNumber: personId
          ? nextLessonNumber(loaded.model, evaluation)
          : null,
      };
    });
    return {
      school: {
        id: school.id,
        slug: school.slug,
        title: school.title,
        description: school.description,
        facts: school.facts,
        soonNote: school.soonNote,
        communityUrl: school.communityUrl,
        mentoringOffer: school.mentoringOffer,
        internshipOffer: school.internshipOffer,
        status: courses.length > 0 ? "open" : "soon",
        courseCount: courses.length,
        lessonCount: courses.reduce((sum, c) => sum + c.lessonCount, 0),
      },
      direction: places.direction,
      expert: await this.author(places.expert),
      signedIn: personId !== null,
      courses,
    };
  }

  /** EARS-13 — `GET /v1/learning/courses/{courseSlug}/path`. */
  async path(
    courseSlug: string,
    personId: string | null,
  ): Promise<LearningCoursePath> {
    const course = await courseBySlug(this.deps.db, courseSlug);
    if (!course || course.state !== "published") throw notFound("course");
    const e = await this.evaluate(this.deps.db, course, personId);
    const facts = await this.kickerFacts(this.deps.db, e);
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
                  ...facts(s.id),
                  state: this.stateOf(e, s.id),
                })),
            })),
          club: club ? { state: club } : null,
        };
      });
    const places = await coursePlaces(this.deps.db, course.schoolId);
    if (!places) throw notFound("course");
    const partners = await publicPartnerNames(
      this.deps.db,
      course.partnerOrganisationId ? [course.partnerOrganisationId] : [],
    );
    return {
      course: {
        id: course.id,
        slug: course.slug,
        title: course.title,
        state: this.stateOf(e, course.id),
        ...this.courseData(course, e.loaded.lessons.length, partners),
        // 023 EARS-11, EARS-13 — the 024 builder over resolved values; no preset name.
        rulesSummary: e.evaluator.rulesSummary({ kind: "course", id: course.id }),
      },
      direction: places.direction,
      school: places.school,
      author: await this.author(places.expert),
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
    const facts = await this.kickerFacts(this.deps.db, e);
    // EARS-13 — what the path omits as hidden and locked is not served here either.
    if (
      this.hidden(e, "module", owner.module.id) ||
      this.hidden(e, "lesson", lessonId)
    )
      throw notFound("lesson");
    const steps = model.steps.filter((s) => !this.hidden(e, "step", s.id));
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
        // 023 EARS-21 — the first step the path shows, so a lesson link opens the step route.
        firstStepId: steps[0]?.id ?? null,
      },
      signedIn: personId !== null,
      steps: steps.map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        durationMin: s.durationMin,
        ...facts(s.id),
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
        ...(await this.kickerFacts(this.deps.db, e))(stepId),
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
    if (step.type === "video") {
      // A published video always carries its provider source (EARS-4).
      if (!row.provider || !row.embedRef) throw notFound("step source");
      const duration = videoDurationSec(step);
      return {
        type: "video",
        provider: row.provider,
        embedRef: row.embedRef,
        durationSec: duration,
        watchedPercent: Math.min(100, watchedPercent(step, e.evaluator)),
        positionSec: Math.min(e.evaluator.facts.maxPosition(step.id), duration),
      };
    }
    if (step.type === "download") {
      // A published download always carries its file (EARS-4); sign it per read.
      if (!row.mediaRef) throw notFound("step media");
      const mediaUrl = await this.deps.media.signedUrl(row.mediaRef);
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
      questionCount: drawnPerAttempt(perAttempt, questions.length),
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
    if (fact.eventId.startsWith(SERVER_EVENT_PREFIX))
      throw new LearningServerError(
        "EVENT_ID_RESERVED",
        `event ids starting with «${SERVER_EVENT_PREFIX}» are the server's`,
        [{ path: "eventId", message: "reserved prefix" }],
      );
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
      // The server's clock is the fact's time; the client's is informational.
      const occurredAt = this.now();
      const data: Record<string, unknown> = fact.clientOccurredAt
        ? { clientOccurredAt: fact.clientOccurredAt }
        : {};
      if (fact.kind === "position") {
        const step = before.evaluator.index.steps.get(fact.stepId)!.step;
        // The allowance is anchored on the step's first accepted report.
        const [first] = await tx
          .select({ at: learningFacts.occurredAt })
          .from(learningFacts)
          .where(
            and(
              eq(learningFacts.personId, personId),
              eq(learningFacts.stepId, fact.stepId),
              eq(learningFacts.kind, "position"),
            ),
          )
          .orderBy(asc(learningFacts.occurredAt))
          .limit(1);
        data["reportedSec"] = fact.data.positionSec;
        data["positionSec"] = clampReportedPosition({
          reportedSec: fact.data.positionSec,
          durationSec: videoDurationSec(step),
          previousMaxSec: before.evaluator.facts.maxPosition(fact.stepId),
          sinceFirstSec: first
            ? (occurredAt.getTime() - first.at.getTime()) / 1000
            : null,
          maxPlaybackRate: before.evaluator.setting(
            "progress.maxPlaybackRate",
            step,
          ),
          slackSec: before.evaluator.setting("progress.slackSec", step),
        });
      }
      const inserted = await tx
        .insert(learningFacts)
        .values({
          eventId: fact.eventId,
          personId,
          kind: fact.kind,
          stepId: fact.stepId,
          data,
          source: fact.source,
          occurredAt,
        })
        .onConflictDoNothing({
          target: [learningFacts.personId, learningFacts.eventId],
        })
        .returning({ id: learningFacts.id });
      const progressOf = (evaluator: typeof before.evaluator) => {
        if (owner.step.type !== "video") return null;
        const step = evaluator.index.steps.get(fact.stepId)!.step;
        return {
          positionSec: Math.min(
            evaluator.facts.maxPosition(fact.stepId),
            videoDurationSec(step),
          ),
          watchedPercent: Math.min(100, watchedPercent(step, evaluator)),
        };
      };
      if (inserted.length === 0)
        return {
          outcome: "duplicate" as const,
          changed: [],
          progress: progressOf(before.evaluator),
        };
      const after = await this.evaluate(tx, owner.course, personId);
      const projection = await project(this.deps, tx, {
        personId,
        evaluator: after.evaluator,
        evaluation: after.evaluation,
        cause: { kind: "fact", id: inserted[0]!.id },
        at: this.now(),
      });
      afterCommit = projection.afterCommit;
      return {
        outcome: "recorded" as const,
        changed: projection.changed,
        progress: progressOf(after.evaluator),
      };
    });
    if (afterCommit) await (afterCommit as () => Promise<void>)();
    return response;
  }

  // ── Attempts (EARS-18) ────────────────────────────────────────────────────

  /**
   * How many attempts are left and when the next one opens, from the
   * SUBMITTED attempts. At most one attempt is open at a time and a start
   * returns it again, so an unsubmitted attempt never buys an extra try.
   */
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
      .select({ submittedAt: learningAttempts.submittedAt })
      .from(learningAttempts)
      .where(
        and(
          eq(learningAttempts.personId, personId),
          eq(learningAttempts.testId, testId),
          isNotNull(learningAttempts.submittedAt),
        ),
      );
    const attemptsLeft =
      limit === "unlimited" ? null : Math.max(0, limit - submitted.length);
    const lastAt =
      submitted
        .map((a) => a.submittedAt)
        .filter((at): at is Date => at !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
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
      const all = await loadQuestions(tx, testId);
      // An open (unsubmitted) attempt is the doctor's current one: return it
      // with the questions it drew, never a fresh draw.
      const [open] = await tx
        .select()
        .from(learningAttempts)
        .where(
          and(
            eq(learningAttempts.personId, personId),
            eq(learningAttempts.testId, testId),
            isNull(learningAttempts.submittedAt),
          ),
        )
        .limit(1);
      if (open) {
        const byId = new Map(all.map((q) => [q.id, q]));
        const drawnIds = open.questionIds as string[];
        return toAttempt(
          open.id,
          testId,
          drawnIds.flatMap((id) => byId.get(id) ?? []),
        );
      }
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
      return toAttempt(attempt!.id, testId, drawn);
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
      const [found] = await tx
        .select({
          personId: learningAttempts.personId,
          testId: learningAttempts.testId,
        })
        .from(learningAttempts)
        .where(eq(learningAttempts.id, attemptId));
      if (!found || found.personId !== personId) throw notFound("attempt");
      const owner = await this.publishedStep(tx, found.testId);
      // The same lock order as start and facts: person+course, then the row.
      await lockPersonCourse(tx, personId, owner.course.id);
      const [attempt] = await tx
        .select()
        .from(learningAttempts)
        .where(eq(learningAttempts.id, attemptId))
        .for("update");
      if (!attempt) throw notFound("attempt");
      if (attempt.submittedAt)
        throw new LearningServerError(
          "INVALID_TRANSITION",
          "this attempt is already submitted",
        );
      // Re-check under the lock: the rules may have changed since the start.
      const current = await this.evaluate(tx, owner.course, personId);
      if (this.stateOf(current, attempt.testId).status === "locked")
        throw locked();
      const allowed = await this.attemptUsage(
        tx,
        personId,
        attempt.testId,
        current,
      );
      if (allowed.attemptsLeft === 0)
        throw new LearningServerError(
          "LEARNING_ATTEMPT_UNAVAILABLE",
          "no attempts are left",
        );
      if (allowed.nextAt)
        throw new LearningServerError(
          "LEARNING_ATTEMPT_UNAVAILABLE",
          "the next attempt opens after the pause",
          [],
          allowed.nextAt,
        );
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
          eventId: `${SERVER_EVENT_PREFIX}attempt:${attemptId}`,
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

/** An attempt as the doctor sees it: the drawn questions, no correct answers. */
function toAttempt(
  attemptId: string,
  testId: string,
  drawn: Awaited<ReturnType<typeof loadQuestions>>,
): LearningAttempt {
  return {
    attemptId,
    testId,
    questions: drawn.map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
    })),
  };
}

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
