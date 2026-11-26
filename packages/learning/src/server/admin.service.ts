import {
  directions,
  events,
  experts,
  learningCourses,
  learningLessons,
  learningModules,
  learningOptions,
  learningPresets,
  learningQuestions,
  learningRuleLayers,
  learningSchools,
  learningSteps,
  learningTests,
  organisations,
  projects,
  type LearningCourseRow,
  type LearningLessonRow,
  type LearningModuleRow,
  type LearningSchoolRow,
  type LearningStepRow,
} from "@ds/db";
import {
  taxonomyETag,
  type CreateLearningCourseRequest,
  type CreateLearningLessonRequest,
  type CreateLearningModuleRequest,
  type CreateLearningSchoolRequest,
  type CreateLearningStepRequest,
  type LearningCourseAdmin,
  type LearningCourseComposition,
  type LearningEarnedProgress,
  type LearningElementType,
  type LearningLessonAdmin,
  type LearningModuleAdmin,
  type LearningModuleClubEvent,
  type LearningPreset,
  type LearningRuleChangePreview,
  type LearningSchoolAdmin,
  type LearningScopeKind,
  type LearningScopeRules,
  type LearningSettingValues,
  type LearningStepAdmin,
  type UpdateLearningCourseRequest,
  type UpdateLearningLessonRequest,
  type UpdateLearningModuleRequest,
  type UpdateLearningSchoolRequest,
  type UpdateLearningStepRequest,
  LEARNING_SCHOOL_EXPERT_TAKEN,
  LEARNING_SETTING_KEYS,
  LearningTestPayloadSchema,
  SetLearningStepSourceRequestSchema,
  STREAM_PROVIDER_HAS_PARENT_API,
  type SetLearningStepSourceRequest,
  type LearningRulesAuthority,
} from "@ds/schemas";
import type { LearningSchoolAdminDetail } from "@ds/schemas";
import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import {
  elementType,
  type LearningMediaDef,
} from "../catalog/element-types.js";
import {
  LEARNING_PLATFORM_SCOPE_ID,
  type LearningScopePath,
} from "../model.js";
import { applyPresetValues } from "../rules/resolver.js";
import {
  activeInterestCount,
  claimSchoolOpenedNotices,
  claimSchoolRepublishedNotices,
} from "./school-interest.js";
import {
  EMPTY_RULE_SCOPE,
  publishRequirements,
  validateSettingValues,
  validateStepPayload,
  type LearningRuleScope,
} from "../rules/validate.js";
import {
  fieldError,
  LearningServerError,
  type LearningDb,
  type LearningServerDeps,
  type LearningTx,
} from "./deps.js";
import type { LearningSchoolOpenedNotice } from "./deps.js";
import {
  courseById,
  courseOfLesson,
  courseOfModule,
  courseOfStep,
  loadCourseTree,
  loadLayersFor,
  loadQuestions,
  scopesOf,
  toStepModel,
} from "./repository.js";
import {
  changedSettings,
  keepRepublishedCompletion,
  previewRuleChange,
  governedCoursesUnder,
  finishRuleChange,
  recordRuleChange,
  type LearningRecordedRuleChange,
} from "./rule-change.js";

/**
 * EARS-31 — how a save on a published course treats earned completion
 * (owner D16: «keep» unless the author chose otherwise) and who made it.
 */
/** EARS-30 — who may change a scope's rules. */
export type { LearningRulesAuthority };

export interface LearningRuleChangeInput {
  earnedProgress: LearningEarnedProgress;
  actorSub: string | null;
  /**
   * EARS-30 — refuses (throws) a caller without the authority the scope
   * needs. Called inside the saving transaction once the scope's courses are
   * locked, so a publish and a rules save cannot race past it.
   */
  authorize?: (needed: LearningRulesAuthority) => void;
}

const DEFAULT_RULE_CHANGE: LearningRuleChangeInput = {
  earnedProgress: "keep",
  actorSub: null,
};

const toPreset = (r: typeof learningPresets.$inferSelect): LearningPreset => ({
  id: r.id,
  name: r.name,
  values: r.values as LearningSettingValues,
  version: r.version,
});

// 024 EARS-1, EARS-2, EARS-4, EARS-9, EARS-28, EARS-29 — the admin commands
// over the structure and the rule layers. Framework-free: the host
// (`apps/api/src/learning`) owns the admin session, CSRF, the idempotency
// record and `If-Match` parsing; every command takes the version the caller
// read and, through `complete`, lets the host store the exact response inside
// the command's own transaction (the 012 idempotency convention).

/** What a command answers; the host stores it for an idempotent replay. */
export interface LearningCommandResult<T> {
  status: 200 | 201;
  body: T;
  etag: string;
  location?: string;
}

/** The host hook that fences the idempotency record inside the command's transaction. */
export type LearningComplete = (
  tx: LearningTx,
  result: LearningCommandResult<unknown>,
) => Promise<void>;

const STALE = "the item changed since it was read; reload and retry";

const noComplete: LearningComplete = async () => {};

function stale(): LearningServerError {
  return new LearningServerError("PRECONDITION_FAILED", STALE);
}

function notFound(what: string): LearningServerError {
  return new LearningServerError("NOT_FOUND", `${what} not found`);
}

/**
 * EARS-4 — a published lesson is whole and on doctors' paths: its steps take
 * no write (add, change, re-source, re-file, remove, reorder) until it is
 * unpublished, so the publish gate cannot be bypassed and no doctor's earned
 * completion turns un-done under them.
 */
const PUBLISHED_READ_ONLY =
  "the lesson is published; unpublish it to change its steps";

/** A uniqueness violation (Postgres 23505) by constraint name, if any. */
function uniqueViolation(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    const o = e as { code?: string; constraint?: string; cause?: unknown };
    if (o.code === "23505") return o.constraint ?? "";
    e = o.cause;
  }
  return null;
}

const toSchool = (r: LearningSchoolRow): LearningSchoolAdmin => ({
  id: r.id,
  directionId: r.directionId,
  leadExpertId: r.leadExpertId,
  projectId: r.projectId,
  slug: r.slug,
  title: r.title,
  state: r.state,
  description: r.description,
  facts: r.facts,
  soonNote: r.soonNote,
  communityUrl: r.communityUrl,
  mentoringOffer: r.mentoringOffer,
  internshipOffer: r.internshipOffer,
  version: r.version,
});

const toCourse = (r: LearningCourseRow): LearningCourseAdmin => ({
  id: r.id,
  schoolId: r.schoolId,
  projectId: r.projectId,
  slug: r.slug,
  title: r.title,
  state: r.state,
  description: r.description,
  academicHours: r.academicHours,
  documentKind: r.documentKind,
  documentPrerequisites: r.documentPrerequisites,
  partnerOrganisationId: r.partnerOrganisationId,
  position: r.position,
  version: r.version,
});

const toModule = (
  r: LearningModuleRow,
  clubs: ReadonlyMap<string, LearningModuleClubEvent>,
): LearningModuleAdmin => ({
  id: r.id,
  courseId: r.courseId,
  position: r.position,
  title: r.title,
  clubEventId: r.clubEventId,
  clubEvent: r.clubEventId ? (clubs.get(r.clubEventId) ?? null) : null,
  version: r.version,
});

/** 023 EARS-1 — the modules' club events (title + start) for the admin read. */
async function clubEventsOf(
  tx: LearningTx | LearningDb,
  modules: readonly LearningModuleRow[],
): Promise<Map<string, LearningModuleClubEvent>> {
  const ids = [
    ...new Set(modules.flatMap((m) => (m.clubEventId ? [m.clubEventId] : []))),
  ];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: events.id, title: events.title, startsAt: events.startsAt })
    .from(events)
    .where(inArray(events.id, ids));
  return new Map(
    rows.map((e) => [
      e.id,
      { id: e.id, title: e.title, startsAt: e.startsAt.toISOString() },
    ]),
  );
}

/** 023 EARS-1 — a module's club is a live 020 event (a field error otherwise). */
async function assertClubEvent(
  tx: LearningTx,
  clubEventId: string | null | undefined,
): Promise<void> {
  if (clubEventId === null || clubEventId === undefined) return;
  const [event] = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, clubEventId), isNull(events.deletedAt)));
  if (!event) throw fieldError("clubEventId", "unknown event");
}

/** A partial row write; an `undefined` field is left as it is (drizzle skips it). */
type Loose<R> = { [K in keyof R]?: R[K] | undefined };

/** 023 EARS-22 — a partner is a live row of the 032 registry (a field error otherwise). */
async function assertPartner(
  tx: LearningTx,
  partnerOrganisationId: string | null,
  issues: { path: string; message: string }[],
): Promise<void> {
  if (partnerOrganisationId === null) return;
  const [partner] = await tx
    .select({ id: organisations.id })
    .from(organisations)
    .where(
      and(
        eq(organisations.id, partnerOrganisationId),
        isNull(organisations.deletedAt),
      ),
    );
  if (!partner)
    issues.push({
      path: "partnerOrganisationId",
      message: "unknown organisation",
    });
}

/** A reorder names every child of its parent exactly once (a field error otherwise). */
function assertExactOrder(
  path: string,
  message: string,
  ordered: string[],
  children: string[],
): void {
  const known = new Set(children);
  if (
    ordered.length !== known.size ||
    new Set(ordered).size !== ordered.length ||
    !ordered.every((id) => known.has(id))
  )
    throw fieldError(path, message);
}

/** Lock the school row, check its version, write `set` and bump the version. */
async function bumpSchool(
  tx: LearningTx,
  schoolId: string,
  expectedVersion: number,
  set: Loose<LearningSchoolRow>,
  check?: (current: LearningSchoolRow) => void,
): Promise<LearningSchoolRow> {
  const [current] = await tx
    .select()
    .from(learningSchools)
    .where(eq(learningSchools.id, schoolId))
    .for("update");
  if (!current) throw notFound("school");
  if (current.version !== expectedVersion) throw stale();
  check?.(current);
  const [row] = await tx
    .update(learningSchools)
    .set({ ...set, version: current.version + 1, updatedAt: new Date() })
    .where(eq(learningSchools.id, schoolId))
    .returning();
  return row!;
}

/** Lock the course row and check its version. */
async function lockCourse(
  tx: LearningTx,
  courseId: string,
  expectedVersion: number,
): Promise<LearningCourseRow> {
  const [current] = await tx
    .select()
    .from(learningCourses)
    .where(eq(learningCourses.id, courseId))
    .for("update");
  if (!current) throw notFound("course");
  if (current.version !== expectedVersion) throw stale();
  return current;
}

async function bumpCourse(
  tx: LearningTx,
  current: LearningCourseRow,
  set: Loose<LearningCourseRow>,
): Promise<LearningCourseRow> {
  const [row] = await tx
    .update(learningCourses)
    .set({ ...set, version: current.version + 1, updatedAt: new Date() })
    .where(eq(learningCourses.id, current.id))
    .returning();
  return row!;
}

/** The 200 answer of a versioned write, fenced with its idempotency record. */
async function finish<T>(
  tx: LearningTx,
  body: T,
  version: number,
  complete: LearningComplete,
): Promise<LearningCommandResult<T>> {
  const result = { status: 200 as const, body, etag: taxonomyETag(version) };
  await complete(tx, result);
  return result;
}

export class LearningAdminService {
  constructor(private readonly deps: LearningServerDeps) {}

  // ── Schools and courses (EARS-1) ──────────────────────────────────────────

  /**
   * 023 EARS-7, EARS-26 — `GET /v1/admin/learning/schools/{id}`: the school
   * with the number of doctors holding an active interest (never who).
   */
  async school(schoolId: string): Promise<LearningSchoolAdminDetail> {
    const [row] = await this.deps.db
      .select()
      .from(learningSchools)
      .where(eq(learningSchools.id, schoolId));
    if (!row) throw notFound("school");
    return {
      ...toSchool(row),
      activeInterestCount: await activeInterestCount(this.deps.db, schoolId),
    };
  }

  async listSchools(): Promise<LearningSchoolAdmin[]> {
    const rows = await this.deps.db
      .select()
      .from(learningSchools)
      .orderBy(asc(learningSchools.title));
    return rows.map(toSchool);
  }

  async createSchool(
    input: CreateLearningSchoolRequest,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningSchoolAdmin>> {
    try {
      return await this.deps.transaction(async (tx) => {
        const issues = [];
        const [direction] = await tx
          .select({ id: directions.id })
          .from(directions)
          .where(eq(directions.id, input.directionId));
        if (!direction)
          issues.push({ path: "directionId", message: "unknown direction" });
        const [expert] = await tx
          .select({ id: experts.id })
          .from(experts)
          .where(eq(experts.id, input.leadExpertId));
        if (!expert)
          issues.push({ path: "leadExpertId", message: "unknown expert" });
        await this.assertProject(tx, input.projectId, issues);
        if (issues.length > 0)
          throw new LearningServerError(
            "VALIDATION_FAILED",
            "the school references unknown rows",
            issues,
          );
        const [row] = await tx
          .insert(learningSchools)
          .values(input)
          .returning();
        const result = {
          status: 201 as const,
          body: toSchool(row!),
          etag: taxonomyETag(row!.version),
          location: `/v1/admin/learning/schools/${row!.id}`,
        };
        await complete(tx, result);
        return result;
      });
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === "learning_schools_direction_expert_key")
        throw fieldError("leadExpertId", LEARNING_SCHOOL_EXPERT_TAKEN);
      if (constraint !== null)
        throw new LearningServerError("SLUG_CONFLICT", "the slug is taken");
      throw err;
    }
  }

  async listCourses(schoolId?: string): Promise<LearningCourseAdmin[]> {
    const rows = await this.deps.db
      .select()
      .from(learningCourses)
      .where(schoolId ? eq(learningCourses.schoolId, schoolId) : undefined)
      .orderBy(
        ...(schoolId
          ? [asc(learningCourses.position), asc(learningCourses.createdAt)]
          : [asc(learningCourses.title)]),
      );
    return rows.map(toCourse);
  }

  /** EARS-1 — a course takes its school; a missing or unknown one is a field error. */
  async createCourse(
    input: CreateLearningCourseRequest,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningCourseAdmin>> {
    try {
      return await this.deps.transaction(async (tx) => {
        const issues = [];
        const [school] = await tx
          .select({ id: learningSchools.id })
          .from(learningSchools)
          .where(eq(learningSchools.id, input.schoolId));
        if (!school)
          issues.push({ path: "schoolId", message: "unknown school" });
        await this.assertProject(tx, input.projectId, issues);
        await assertPartner(tx, input.partnerOrganisationId, issues);
        if (issues.length > 0)
          throw new LearningServerError(
            "VALIDATION_FAILED",
            "the course references unknown rows",
            issues,
          );
        // 023 EARS-1 — a new course is placed last in its school.
        const [{ last } = { last: null }] = await tx
          .select({ last: max(learningCourses.position) })
          .from(learningCourses)
          .where(eq(learningCourses.schoolId, input.schoolId));
        const [row] = await tx
          .insert(learningCourses)
          .values({ ...input, position: (last ?? 0) + 1 })
          .returning();
        const result = {
          status: 201 as const,
          body: toCourse(row!),
          etag: taxonomyETag(row!.version),
          location: `/v1/admin/learning/courses/${row!.id}`,
        };
        await complete(tx, result);
        return result;
      });
    } catch (err) {
      if (uniqueViolation(err) !== null)
        throw new LearningServerError("SLUG_CONFLICT", "the slug is taken");
      throw err;
    }
  }

  /** The course outline: modules → lessons, with each lesson's duration. */
  async courseComposition(
    courseId: string,
  ): Promise<{ body: LearningCourseComposition; etag: string }> {
    const course = await courseById(this.deps.db, courseId);
    if (!course) throw notFound("course");
    const loaded = await loadCourseTree(this.deps.db, course, false);
    const clubs = await clubEventsOf(this.deps.db, loaded.modules);
    const body: LearningCourseComposition = {
      ...toCourse(course),
      modules: loaded.modules.map((m) => ({
        ...toModule(m, clubs),
        lessons: loaded.lessons
          .filter((l) => l.moduleId === m.id)
          .map((l) => {
            const { steps: _steps, ...rest } = this.toLessonAdmin(
              l,
              loaded.steps.filter((s) => s.lessonId === l.id),
              new Map(),
            );
            return rest;
          }),
      })),
    };
    return { body, etag: taxonomyETag(course.version) };
  }

  /** A course goes live only with at least one published lesson. */
  async setCourseState(
    courseId: string,
    state: "draft" | "published",
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningCourseAdmin>> {
    // 023 EARS-7 — the school-opened notices this publication claimed; sent
    // only once the publication has committed.
    let notices: LearningSchoolOpenedNotice[] = [];
    const result = await this.deps.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(learningCourses)
        .where(eq(learningCourses.id, courseId))
        .for("update");
      if (!current) throw notFound("course");
      if (current.version !== expectedVersion) throw stale();
      if (current.state === state)
        throw new LearningServerError(
          "INVALID_TRANSITION",
          `the course is already ${state}`,
        );
      if (state === "published") {
        const [published] = await tx
          .select({ id: learningLessons.id })
          .from(learningLessons)
          .innerJoin(
            learningModules,
            eq(learningModules.id, learningLessons.moduleId),
          )
          .where(
            and(
              eq(learningModules.courseId, courseId),
              eq(learningLessons.state, "published"),
            ),
          )
          .limit(1);
        if (!published)
          throw new LearningServerError(
            "PUBLISH_REQUIREMENTS_NOT_MET",
            "the course has no published lesson",
            [{ path: "lessons", message: "publish at least one lesson" }],
          );
      }
      const [row] = await tx
        .update(learningCourses)
        .set({
          state,
          version: current.version + 1,
          updatedAt: new Date(),
          // EARS-30 — the first publish is stamped once and never cleared.
          ...(state === "published" && !current.firstPublishedAt
            ? { firstPublishedAt: this.now() }
            : {}),
        })
        .where(eq(learningCourses.id, courseId))
        .returning();
      if (state === "published")
        notices = await claimSchoolOpenedNotices(tx, courseId, this.now());
      const result = {
        status: 200 as const,
        body: toCourse(row!),
        etag: taxonomyETag(row!.version),
      };
      await complete(tx, result);
      return result;
    });
    // Off the response path: the port dispatches and returns at once.
    if (notices.length > 0) this.deps.notices.schoolOpened(notices);
    return result;
  }

  /**
   * 023 EARS-26 — `GET /v1/admin/learning/schools/{id}` with its ETag, so the
   * editor's writes carry the version it rendered from.
   */
  async schoolWithVersion(
    schoolId: string,
  ): Promise<{ body: LearningSchoolAdminDetail; etag: string }> {
    const body = await this.school(schoolId);
    return { body, etag: taxonomyETag(body.version) };
  }

  /** 023 EARS-26 — the school's EARS-1 data; the identity columns stay as created. */
  async updateSchool(
    schoolId: string,
    input: UpdateLearningSchoolRequest,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningSchoolAdmin>> {
    return this.deps.transaction(async (tx) => {
      const row = await bumpSchool(tx, schoolId, expectedVersion, input);
      return finish(tx, toSchool(row), row.version, complete);
    });
  }

  /**
   * 023 EARS-26 — publish or unpublish a school. A published school is read by
   * doctors (EARS-3: `soon` while it has no published course); a draft one is
   * `404` to them. Its courses keep their own states. A republish that opens
   * the school (EARS-7: it has a published course) claims the unsent
   * school-opened notices, sent once the publication has committed.
   */
  async setSchoolState(
    schoolId: string,
    state: "draft" | "published",
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningSchoolAdmin>> {
    let notices: LearningSchoolOpenedNotice[] = [];
    const result = await this.deps.transaction(async (tx) => {
      const row = await bumpSchool(
        tx,
        schoolId,
        expectedVersion,
        { state },
        (current) => {
          if (current.state === state)
            throw new LearningServerError(
              "INVALID_TRANSITION",
              `the school is already ${state}`,
            );
        },
      );
      if (state === "published")
        notices = await claimSchoolRepublishedNotices(tx, row, this.now());
      return finish(tx, toSchool(row), row.version, complete);
    });
    // Off the response path: the port dispatches and returns at once.
    if (notices.length > 0) this.deps.notices.schoolOpened(notices);
    return result;
  }

  /** 023 EARS-27 — the school's courses in a new order, under the school's `If-Match`. */
  async reorderCourses(
    schoolId: string,
    courseIds: string[],
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningSchoolAdmin>> {
    return this.deps.transaction(async (tx) => {
      const row = await bumpSchool(tx, schoolId, expectedVersion, {});
      const courses = await tx
        .select({ id: learningCourses.id })
        .from(learningCourses)
        .where(eq(learningCourses.schoolId, schoolId));
      assertExactOrder(
        "courseIds",
        "name every course of the school exactly once",
        courseIds,
        courses.map((c) => c.id),
      );
      for (const [i, id] of courseIds.entries()) {
        await tx
          .update(learningCourses)
          .set({ position: i + 1, updatedAt: new Date() })
          .where(eq(learningCourses.id, id));
      }
      return finish(tx, toSchool(row), row.version, complete);
    });
  }

  /** 023 EARS-27 — the course's EARS-1 data; a partner is a live 032 organisation. */
  async updateCourse(
    courseId: string,
    input: UpdateLearningCourseRequest,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningCourseAdmin>> {
    return this.deps.transaction(async (tx) => {
      const current = await lockCourse(tx, courseId, expectedVersion);
      if (input.partnerOrganisationId !== undefined) {
        const issues: { path: string; message: string }[] = [];
        await assertPartner(tx, input.partnerOrganisationId, issues);
        if (issues.length > 0)
          throw new LearningServerError(
            "VALIDATION_FAILED",
            "the course references unknown rows",
            issues,
          );
      }
      const row = await bumpCourse(tx, current, input);
      return finish(tx, toCourse(row), row.version, complete);
    });
  }

  /** 023 EARS-27 — the course's modules in a new order, under the course's `If-Match`. */
  async reorderModules(
    courseId: string,
    moduleIds: string[],
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningCourseAdmin>> {
    return this.deps.transaction(async (tx) => {
      const current = await lockCourse(tx, courseId, expectedVersion);
      const modules = await tx
        .select({ id: learningModules.id })
        .from(learningModules)
        .where(eq(learningModules.courseId, courseId));
      assertExactOrder(
        "moduleIds",
        "name every module of the course exactly once",
        moduleIds,
        modules.map((m) => m.id),
      );
      const row = await bumpCourse(tx, current, {});
      for (const [i, id] of moduleIds.entries()) {
        await tx
          .update(learningModules)
          .set({ position: i + 1, updatedAt: new Date() })
          .where(eq(learningModules.id, id));
      }
      return finish(tx, toCourse(row), row.version, complete);
    });
  }

  /** 023 EARS-1, EARS-27 — rename a module and set its club, under the module's `If-Match`. */
  async updateModule(
    moduleId: string,
    input: UpdateLearningModuleRequest,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningModuleAdmin>> {
    return this.deps.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(learningModules)
        .where(eq(learningModules.id, moduleId))
        .for("update");
      if (!current) throw notFound("module");
      if (current.version !== expectedVersion) throw stale();
      await assertClubEvent(tx, input.clubEventId);
      const [row] = await tx
        .update(learningModules)
        .set({
          title: input.title,
          clubEventId: input.clubEventId,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(learningModules.id, moduleId))
        .returning();
      const clubs = await clubEventsOf(tx, [row!]);
      return finish(tx, toModule(row!, clubs), row!.version, complete);
    });
  }

  // ── Modules and lessons (EARS-1, EARS-28) ─────────────────────────────────

  async createModule(
    input: CreateLearningModuleRequest,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningModuleAdmin>> {
    return this.deps.transaction(async (tx) => {
      const course = await courseById(tx, input.courseId);
      if (!course) throw fieldError("courseId", "unknown course");
      const [{ last } = { last: null }] = await tx
        .select({ last: max(learningModules.position) })
        .from(learningModules)
        .where(eq(learningModules.courseId, input.courseId));
      const [row] = await tx
        .insert(learningModules)
        .values({ ...input, position: (last ?? 0) + 1 })
        .returning();
      const result = {
        status: 201 as const,
        body: toModule(row!, new Map()),
        etag: taxonomyETag(row!.version),
        location: `/v1/admin/learning/modules/${row!.id}`,
      };
      await complete(tx, result);
      return result;
    });
  }

  async createLesson(
    input: CreateLearningLessonRequest,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningLessonAdmin>> {
    return this.deps.transaction(async (tx) => {
      const issues = [];
      const owner = await courseOfModule(tx, input.moduleId);
      if (!owner) issues.push({ path: "moduleId", message: "unknown module" });
      await this.assertProject(tx, input.projectId, issues);
      if (issues.length > 0)
        throw new LearningServerError(
          "VALIDATION_FAILED",
          "the lesson references unknown rows",
          issues,
        );
      const [{ last } = { last: null }] = await tx
        .select({ last: max(learningLessons.position) })
        .from(learningLessons)
        .where(eq(learningLessons.moduleId, input.moduleId));
      const [row] = await tx
        .insert(learningLessons)
        .values({
          moduleId: input.moduleId,
          projectId: input.projectId,
          title: input.title,
          description: input.description ?? "",
          teaser: input.teaser ?? "",
          position: (last ?? 0) + 1,
        })
        .returning();
      const result = {
        status: 201 as const,
        body: this.toLessonAdmin(row!, [], new Map()),
        etag: taxonomyETag(row!.version),
        location: `/v1/admin/learning/lessons/${row!.id}`,
      };
      await complete(tx, result);
      return result;
    });
  }

  /** EARS-28 — the lesson composition: steps in order, a test's questions with the correct option. */
  async lesson(
    lessonId: string,
  ): Promise<{ body: LearningLessonAdmin; etag: string }> {
    const owner = await courseOfLesson(this.deps.db, lessonId);
    if (!owner) throw notFound("lesson");
    const body = await this.lessonBody(this.deps.db, owner.lesson);
    return { body, etag: taxonomyETag(owner.lesson.version) };
  }

  async updateLesson(
    lessonId: string,
    patch: UpdateLearningLessonRequest,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningLessonAdmin>> {
    return this.deps.transaction(async (tx) => {
      const set: Partial<LearningLessonRow> = {};
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.teaser !== undefined) set.teaser = patch.teaser;
      const row = await this.bumpLesson(tx, lessonId, expectedVersion, set);
      return this.finishLesson(tx, row, complete);
    });
  }

  /** EARS-4 — publish the whole lesson or refuse naming every missing item. */
  async setLessonState(
    lessonId: string,
    state: "draft" | "published",
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningLessonAdmin>> {
    return this.deps.transaction(async (tx) => {
      // Lesson row first (the lock order of every step write), so no step
      // changes between the requirements check and the state change.
      await this.lockLesson(tx, lessonId);
      const owner = await courseOfLesson(tx, lessonId);
      if (!owner) throw notFound("lesson");
      if (owner.lesson.state === state)
        throw new LearningServerError(
          "INVALID_TRANSITION",
          `the lesson is already ${state}`,
        );
      if (state === "published") {
        const steps = await this.liveSteps(tx, lessonId);
        const stored = new Map<string, unknown>();
        for (const s of steps) {
          stored.set(
            s.id,
            s.type === "test"
              ? await this.storedTestPayload(tx, s)
              : (s.payload ?? {}),
          );
        }
        const layers = await loadLayersFor(tx, [
          { kind: "school", id: owner.course.schoolId },
          { kind: "course", id: owner.course.id },
          { kind: "module", id: owner.module.id },
          { kind: "lesson", id: lessonId },
        ]);
        const issues = publishRequirements(
          {
            id: lessonId,
            title: owner.lesson.title,
            steps: steps.map(toStepModel),
          },
          layers,
          {
            school: owner.course.schoolId,
            course: owner.course.id,
            module: owner.module.id,
            lesson: lessonId,
          },
          (id) => stored.get(id),
          (id) => steps.find((s) => s.id === id)?.mediaRef != null,
          (id) => steps.find((s) => s.id === id)?.embedRef != null,
        );
        if (issues.length > 0)
          throw new LearningServerError(
            "PUBLISH_REQUIREMENTS_NOT_MET",
            "the lesson is not whole yet",
            issues,
          );
      }
      const row = await this.bumpLesson(tx, lessonId, expectedVersion, {
        state,
      });
      // Owner D16 — a lesson republished changed on a once-published course keeps
      // its doctors' earned completion: what was done and would no longer be
      // gets a `completion-kept` fact (EARS-31; no fact changed or removed).
      if (state === "published" && owner.course.firstPublishedAt) {
        await keepRepublishedCompletion(tx, {
          course: owner.course,
          moduleId: owner.module.id,
          lessonId,
          lessonVersion: row.version,
          now: this.now(),
        });
      }
      return this.finishLesson(tx, row, complete);
    });
  }

  // ── Steps (EARS-2, EARS-28) ───────────────────────────────────────────────

  async createStep(
    input: CreateLearningStepRequest,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningStepAdmin>> {
    const check = validateStepPayload(input.type, input.payload);
    if (!check.ok)
      throw new LearningServerError(
        "VALIDATION_FAILED",
        "the step is refused",
        check.issues,
      );
    return this.deps.transaction(async (tx) => {
      const owner = await courseOfLesson(tx, input.lessonId);
      if (!owner) throw fieldError("lessonId", "unknown lesson");
      await this.lockDraftLesson(tx, input.lessonId);
      const [{ last } = { last: null }] = await tx
        .select({ last: max(learningSteps.position) })
        .from(learningSteps)
        .where(
          and(
            eq(learningSteps.lessonId, input.lessonId),
            isNull(learningSteps.removedAt),
          ),
        );
      const isTest = input.type === "test";
      const [row] = await tx
        .insert(learningSteps)
        .values({
          lessonId: input.lessonId,
          type: input.type,
          title: input.title,
          durationMin: input.durationMin,
          position: (last ?? 0) + 1,
          payload: isTest ? { kind: check.payload["kind"] } : check.payload,
        })
        .returning();
      if (isTest) await this.writeTest(tx, row!.id, check.payload, false);
      const body = await this.stepBody(tx, row!);
      const result = {
        status: 201 as const,
        body,
        etag: taxonomyETag(row!.version),
        location: `/v1/admin/learning/steps/${row!.id}`,
      };
      await complete(tx, result);
      return result;
    });
  }

  async updateStep(
    stepId: string,
    patch: UpdateLearningStepRequest,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningStepAdmin>> {
    return this.deps.transaction(async (tx) => {
      const current = await this.lockStep(tx, stepId, expectedVersion);
      const set: Partial<LearningStepRow> = {};
      if (patch.title !== undefined) set.title = patch.title;
      if (patch.durationMin !== undefined) set.durationMin = patch.durationMin;
      if (patch.payload !== undefined) {
        const check = validateStepPayload(current.type, patch.payload);
        if (!check.ok)
          throw new LearningServerError(
            "VALIDATION_FAILED",
            "the step is refused",
            check.issues,
          );
        if (current.type === "test") {
          set.payload = { kind: check.payload["kind"] };
          await this.writeTest(tx, stepId, check.payload, true);
        } else {
          set.payload = check.payload;
        }
      }
      const row = await this.bumpStep(tx, current, set);
      return this.finishStep(tx, row, complete);
    });
  }

  /** EARS-28 — a removed step leaves the composition; its row and facts stay. */
  async removeStep(
    stepId: string,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningStepAdmin>> {
    return this.deps.transaction(async (tx) => {
      const current = await this.lockStep(tx, stepId, expectedVersion);
      const row = await this.bumpStep(tx, current, { removedAt: new Date() });
      return this.finishStep(tx, row, complete);
    });
  }

  /** EARS-28 — the lesson's live steps in a new order, under the lesson's version. */
  async reorderSteps(
    lessonId: string,
    stepIds: string[],
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningLessonAdmin>> {
    return this.deps.transaction(async (tx) => {
      await this.lockDraftLesson(tx, lessonId);
      const live = await this.liveSteps(tx, lessonId);
      const liveIds = new Set(live.map((s) => s.id));
      if (
        stepIds.length !== liveIds.size ||
        new Set(stepIds).size !== stepIds.length ||
        !stepIds.every((id) => liveIds.has(id))
      ) {
        throw fieldError(
          "stepIds",
          "name every live step of the lesson exactly once",
        );
      }
      const row = await this.bumpLesson(tx, lessonId, expectedVersion, {});
      for (const [i, id] of stepIds.entries()) {
        await tx
          .update(learningSteps)
          .set({ position: i + 1, updatedAt: new Date() })
          .where(eq(learningSteps.id, id));
      }
      return this.finishLesson(tx, row, complete);
    });
  }

  /** The media rule of a step's type — what the host validates an upload against. */
  async mediaRuleOf(
    stepId: string,
  ): Promise<{ step: LearningStepRow; media: LearningMediaDef }> {
    const owner = await courseOfStep(this.deps.db, stepId);
    if (!owner || owner.step.removedAt) throw notFound("step");
    // Refused before the host stores the upload; `setStepMedia` re-checks under lock.
    if (owner.lesson.state === "published")
      throw new LearningServerError("INVALID_TRANSITION", PUBLISHED_READ_ONLY);
    const media = elementType(owner.step.type)?.media;
    if (!media) throw fieldError("file", "this step type carries no file");
    return { step: owner.step, media };
  }

  /**
   * EARS-28 — attach the uploaded 012 media object to a step. The host has
   * already stored the object under a server-generated key; `onReleased`
   * enqueues the replaced object's cleanup in this same transaction.
   */
  async setStepMedia(
    stepId: string,
    media: { ref: string; contentType: string; sizeBytes: number },
    expectedVersion: number,
    onReleased: (tx: LearningTx, objectKey: string) => Promise<void>,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningStepAdmin>> {
    return this.deps.transaction(async (tx) => {
      const current = await this.lockStep(tx, stepId, expectedVersion);
      const row = await this.bumpStep(tx, current, {
        mediaRef: media.ref,
        mediaContentType: media.contentType,
        mediaSizeBytes: media.sizeBytes,
      });
      if (current.mediaRef && current.mediaRef !== media.ref)
        await onReleased(tx, current.mediaRef);
      return this.finishStep(tx, row, complete);
    });
  }

  /**
   * EARS-28 — set a `video` step's source: the 006 provider abstraction, as a
   * 014 recording (`{ provider, embedRef }`, validated per provider). The API
   * never fetches what it points at.
   */
  async setStepSource(
    stepId: string,
    raw: SetLearningStepSourceRequest,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningStepAdmin>> {
    const parsed = SetLearningStepSourceRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw fieldError(issue.path.join(".") || "source", issue.message);
    }
    // EARS-10 — a video step is credited from the provider player's own clock;
    // a provider whose embed reports none (cdnvideo, #4055) could never reach
    // the «viewed» condition, so it is refused for a step.
    if (!STREAM_PROVIDER_HAS_PARENT_API[parsed.data.provider])
      throw fieldError(
        "provider",
        "this provider reports no playback position; a step video needs one",
      );
    return this.deps.transaction(async (tx) => {
      const current = await this.lockStep(tx, stepId, expectedVersion);
      if (!elementType(current.type)?.providerSource)
        throw fieldError("provider", "this step type plays no provider video");
      const row = await this.bumpStep(tx, current, {
        provider: parsed.data.provider,
        embedRef: parsed.data.embedRef,
      });
      return this.finishStep(tx, row, complete);
    });
  }

  // ── Rules (EARS-5, EARS-9, EARS-29) ───────────────────────────────────────

  async presets(): Promise<LearningPreset[]> {
    const rows = await this.deps.db
      .select()
      .from(learningPresets)
      .orderBy(asc(learningPresets.name));
    return rows.map(toPreset);
  }

  /** EARS-29 — a scope's own values and every setting's effective value with its origin. */
  async scopeRules(
    kind: LearningScopeKind,
    scopeId: string,
  ): Promise<LearningScopeRules> {
    const { path, chain } = await this.scopeChain(this.deps.db, kind, scopeId);
    const layers = await loadLayersFor(this.deps.db, chain);
    const own = layers.layer(kind, scopeId);
    const [row] = await this.deps.db
      .select({ version: learningRuleLayers.version })
      .from(learningRuleLayers)
      .where(
        and(
          eq(learningRuleLayers.scopeKind, kind),
          eq(learningRuleLayers.scopeId, scopeId),
        ),
      );
    return {
      scopeKind: kind,
      scopeId,
      layerVersion: row?.version ?? 0,
      authority: await this.authorityIn(this.deps.db, kind, scopeId, false),
      appliedPreset: own?.preset ?? null,
      values: own?.values ?? {},
      effective: LEARNING_SETTING_KEYS.map((key) => {
        const r = layers.resolve(key, path);
        return { key, value: r.value, level: r.level, preset: r.preset };
      }) as LearningScopeRules["effective"],
    };
  }

  /**
   * EARS-29 — replace a scope's own values (an override, or «Вернуть
   * унаследованное» by leaving a key out). `expectedVersion` 0 = no row yet.
   */
  async setScopeValues(
    kind: LearningScopeKind,
    scopeId: string,
    rawValues: unknown,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
    change: LearningRuleChangeInput = DEFAULT_RULE_CHANGE,
  ): Promise<LearningCommandResult<LearningScopeRules>> {
    const { result, ruleChange } = await this.deps.transaction(async (tx) => {
      change.authorize?.(await this.authorityIn(tx, kind, scopeId, true));
      const values = await this.checkedValues(tx, kind, scopeId, rawValues);
      const ruleChange = await this.recordChange(
        tx,
        kind,
        scopeId,
        values,
        change,
      );
      await this.writeLayer(tx, kind, scopeId, expectedVersion, {
        values,
        keepPreset: true,
      });
      return {
        result: await this.finishRules(tx, kind, scopeId, complete),
        ruleChange,
      };
    });
    // EARS-31 — the save is the truth once committed: the recompute runs
    // after it, in the background, and never holds the editor.
    if (ruleChange?.recompute) void finishRuleChange(this.deps, ruleChange.id);
    return result;
  }

  /**
   * EARS-30 — who may change a scope's rules: a scope a published course
   * resolves through (and the platform layer) takes the rules editor; a draft
   * course's scopes stay with the staff who edit that course.
   */
  async rulesAuthority(
    kind: LearningScopeKind,
    scopeId: string,
  ): Promise<LearningRulesAuthority> {
    return this.authorityIn(this.deps.db, kind, scopeId, false);
  }

  /**
   * EARS-30 — the authority from `first_published_at`: a course once
   * published stays with the rules editor after an unpublish. With `lock`,
   * the scope's courses are held `FOR UPDATE` until the saving transaction
   * ends, so a concurrent first publish waits for the save (or the save sees
   * the publish).
   */
  private async authorityIn(
    db: LearningServerDeps["db"] | LearningTx,
    kind: LearningScopeKind,
    scopeId: string,
    lock: boolean,
  ): Promise<LearningRulesAuthority> {
    if (kind === "platform") return "rules-editor";
    await this.scopeChain(db, kind, scopeId);
    if (lock) {
      // Lock every course under the scope, governed or not: a draft one may
      // be published concurrently.
      const ids = await this.coursesOfScope(db, kind, scopeId);
      if (ids.length > 0)
        await db
          .select({ id: learningCourses.id })
          .from(learningCourses)
          .where(inArray(learningCourses.id, ids))
          .for("update");
    }
    const governed = await governedCoursesUnder(db, kind, scopeId);
    return governed.length > 0 ? "rules-editor" : "course-editor";
  }

  /** The ids of the courses whose items resolve through a non-platform scope. */
  private async coursesOfScope(
    db: LearningServerDeps["db"] | LearningTx,
    kind: Exclude<LearningScopeKind, "platform">,
    scopeId: string,
  ): Promise<string[]> {
    if (kind === "school")
      return (
        await db
          .select({ id: learningCourses.id })
          .from(learningCourses)
          .where(eq(learningCourses.schoolId, scopeId))
      ).map((r) => r.id);
    const course =
      kind === "course"
        ? await courseById(db, scopeId)
        : kind === "module"
          ? (await courseOfModule(db, scopeId))?.course
          : kind === "lesson"
            ? (await courseOfLesson(db, scopeId))?.course
            : (await courseOfStep(db, scopeId))?.course;
    return course ? [course.id] : [];
  }

  /** EARS-31 — the change dialog's count under the new values; nothing is written. */
  async previewScopeValues(
    kind: LearningScopeKind,
    scopeId: string,
    rawValues: unknown,
  ): Promise<LearningRuleChangePreview> {
    const values = await this.checkedValues(
      this.deps.db,
      kind,
      scopeId,
      rawValues,
    );
    return previewRuleChange(this.deps.db, kind, scopeId, values, this.now());
  }

  /** EARS-9, EARS-29 — one preset. */
  async preset(presetId: string): Promise<LearningPreset> {
    const [row] = await this.deps.db
      .select()
      .from(learningPresets)
      .where(eq(learningPresets.id, presetId));
    if (!row) throw notFound("preset");
    return toPreset(row);
  }

  /**
   * EARS-9, EARS-29 — replace a preset's values. A preset is copied into a
   * layer when applied, so a change reaches only later «Применить пресет».
   */
  async updatePreset(
    presetId: string,
    rawValues: unknown,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningPreset>> {
    return this.deps.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(learningPresets)
        .where(eq(learningPresets.id, presetId))
        .for("update");
      if (!current) throw notFound("preset");
      if (current.version !== expectedVersion) throw stale();
      // A preset applies on a school or a course; it names no item.
      const check = validateSettingValues(
        rawValues,
        "course",
        EMPTY_RULE_SCOPE,
      );
      if (!check.ok)
        throw new LearningServerError(
          "VALIDATION_FAILED",
          "the preset is refused",
          check.issues,
        );
      const [row] = await tx
        .update(learningPresets)
        .set({
          values: check.values,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(learningPresets.id, presetId))
        .returning();
      const result = {
        status: 200 as const,
        body: toPreset(row!),
        etag: taxonomyETag(row!.version),
      };
      await complete(tx, result);
      return result;
    });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** EARS-6 — a scope's new own values, validated (the platform layer holds every key). */
  private async checkedValues(
    db: LearningServerDeps["db"] | LearningTx,
    kind: LearningScopeKind,
    scopeId: string,
    rawValues: unknown,
  ): Promise<LearningSettingValues> {
    const { ruleScope } = await this.scopeChain(db, kind, scopeId);
    const check = validateSettingValues(rawValues, kind, ruleScope);
    if (!check.ok)
      throw new LearningServerError(
        "VALIDATION_FAILED",
        "the rules are refused",
        check.issues,
      );
    if (kind === "platform") {
      const missing = LEARNING_SETTING_KEYS.filter(
        (k) => !Object.hasOwn(check.values, k),
      );
      if (missing.length > 0)
        throw new LearningServerError(
          "VALIDATION_FAILED",
          "the platform layer holds every setting",
          missing.map((k) => ({
            path: `values.${k}`,
            message: "required on the platform layer",
          })),
        );
    }
    return check.values;
  }

  /**
   * EARS-31 — on a scope a published course resolves through, a save that
   * changes the values is a rule change: its record and, under «keep», the
   * `completion-kept` facts, in the saving transaction before the layer is
   * written. Null on a draft scope or an unchanged save.
   */
  private async recordChange(
    tx: LearningTx,
    kind: LearningScopeKind,
    scopeId: string,
    values: LearningSettingValues,
    change: LearningRuleChangeInput,
  ): Promise<LearningRecordedRuleChange | null> {
    const governed = await governedCoursesUnder(tx, kind, scopeId);
    if (governed.length === 0) return null;
    const [current] = await tx
      .select({ values: learningRuleLayers.values })
      .from(learningRuleLayers)
      .where(
        and(
          eq(learningRuleLayers.scopeKind, kind),
          eq(learningRuleLayers.scopeId, scopeId),
        ),
      );
    const before = (current?.values ?? {}) as LearningSettingValues;
    if (changedSettings(before, values).length === 0) return null;
    return recordRuleChange(tx, {
      kind,
      scopeId,
      before,
      after: values,
      earnedProgress: change.earnedProgress,
      actorSub: change.actorSub,
      now: this.now(),
    });
  }

  /** EARS-9 — apply a preset on a school or a course: one layer written, every other kept. */
  async applyPreset(
    kind: "school" | "course",
    scopeId: string,
    presetId: string,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
    change: LearningRuleChangeInput = DEFAULT_RULE_CHANGE,
  ): Promise<LearningCommandResult<LearningScopeRules>> {
    const { result, ruleChange } = await this.deps.transaction(async (tx) => {
      change.authorize?.(await this.authorityIn(tx, kind, scopeId, true));
      const [preset] = await tx
        .select()
        .from(learningPresets)
        .where(eq(learningPresets.id, presetId));
      if (!preset) throw fieldError("presetId", "unknown preset");
      const [current] = await tx
        .select()
        .from(learningRuleLayers)
        .where(
          and(
            eq(learningRuleLayers.scopeKind, kind),
            eq(learningRuleLayers.scopeId, scopeId),
          ),
        );
      const values = applyPresetValues(
        (current?.values ?? {}) as LearningSettingValues,
        preset.values as LearningSettingValues,
      );
      const ruleChange = await this.recordChange(
        tx,
        kind,
        scopeId,
        values,
        change,
      );
      await this.writeLayer(tx, kind, scopeId, expectedVersion, {
        values,
        presetId: preset.id,
      });
      return {
        result: await this.finishRules(tx, kind, scopeId, complete),
        ruleChange,
      };
    });
    // EARS-31 — the save is the truth once committed: the recompute runs
    // after it, in the background, and never holds the editor.
    if (ruleChange?.recompute) void finishRuleChange(this.deps, ruleChange.id);
    return result;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async assertProject(
    tx: LearningTx,
    projectId: string,
    issues: Array<{ path: string; message: string }>,
  ): Promise<void> {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project)
      issues.push({ path: "projectId", message: "unknown project" });
  }

  private liveSteps(
    db: LearningServerDeps["db"] | LearningTx,
    lessonId: string,
  ): Promise<LearningStepRow[]> {
    return db
      .select()
      .from(learningSteps)
      .where(
        and(
          eq(learningSteps.lessonId, lessonId),
          isNull(learningSteps.removedAt),
        ),
      )
      .orderBy(asc(learningSteps.position), asc(learningSteps.createdAt));
  }

  /** The lesson row, locked for the transaction (the first lock of every lesson write). */
  private async lockLesson(
    tx: LearningTx,
    lessonId: string,
  ): Promise<LearningLessonRow> {
    const [row] = await tx
      .select()
      .from(learningLessons)
      .where(eq(learningLessons.id, lessonId))
      .for("update");
    if (!row) throw notFound("lesson");
    return row;
  }

  /** {@link lockLesson}, refusing a published lesson ({@link PUBLISHED_READ_ONLY}). */
  private async lockDraftLesson(
    tx: LearningTx,
    lessonId: string,
  ): Promise<LearningLessonRow> {
    const row = await this.lockLesson(tx, lessonId);
    if (row.state === "published")
      throw new LearningServerError("INVALID_TRANSITION", PUBLISHED_READ_ONLY);
    return row;
  }

  /** The step for a write: its lesson locked and draft first, then the step. */
  private async lockStep(
    tx: LearningTx,
    stepId: string,
    expectedVersion: number,
  ): Promise<LearningStepRow> {
    const [owner] = await tx
      .select({ lessonId: learningSteps.lessonId })
      .from(learningSteps)
      .where(eq(learningSteps.id, stepId));
    if (!owner) throw notFound("step");
    await this.lockDraftLesson(tx, owner.lessonId);
    const [row] = await tx
      .select()
      .from(learningSteps)
      .where(eq(learningSteps.id, stepId))
      .for("update");
    if (!row || row.removedAt) throw notFound("step");
    if (row.version !== expectedVersion) throw stale();
    return row;
  }

  private async bumpStep(
    tx: LearningTx,
    current: LearningStepRow,
    set: Partial<LearningStepRow>,
  ): Promise<LearningStepRow> {
    const [row] = await tx
      .update(learningSteps)
      .set({ ...set, version: current.version + 1, updatedAt: new Date() })
      .where(eq(learningSteps.id, current.id))
      .returning();
    return row!;
  }

  private async bumpLesson(
    tx: LearningTx,
    lessonId: string,
    expectedVersion: number,
    set: Partial<LearningLessonRow>,
  ): Promise<LearningLessonRow> {
    const [current] = await tx
      .select()
      .from(learningLessons)
      .where(eq(learningLessons.id, lessonId))
      .for("update");
    if (!current) throw notFound("lesson");
    if (current.version !== expectedVersion) throw stale();
    const [row] = await tx
      .update(learningLessons)
      .set({ ...set, version: current.version + 1, updatedAt: new Date() })
      .where(eq(learningLessons.id, lessonId))
      .returning();
    return row!;
  }

  private async finishLesson(
    tx: LearningTx,
    row: LearningLessonRow,
    complete: LearningComplete,
  ): Promise<LearningCommandResult<LearningLessonAdmin>> {
    const result = {
      status: 200 as const,
      body: await this.lessonBody(tx, row),
      etag: taxonomyETag(row.version),
    };
    await complete(tx, result);
    return result;
  }

  private async finishStep(
    tx: LearningTx,
    row: LearningStepRow,
    complete: LearningComplete,
  ): Promise<LearningCommandResult<LearningStepAdmin>> {
    const result = {
      status: 200 as const,
      body: await this.stepBody(tx, row),
      etag: taxonomyETag(row.version),
    };
    await complete(tx, result);
    return result;
  }

  private async finishRules(
    tx: LearningTx,
    kind: LearningScopeKind,
    scopeId: string,
    complete: LearningComplete,
  ): Promise<LearningCommandResult<LearningScopeRules>> {
    const body = await this.scopeRulesIn(tx, kind, scopeId);
    const result = {
      status: 200 as const,
      body,
      etag: taxonomyETag(body.layerVersion),
    };
    await complete(tx, result);
    return result;
  }

  private async scopeRulesIn(
    tx: LearningTx,
    kind: LearningScopeKind,
    scopeId: string,
  ): Promise<LearningScopeRules> {
    // Same read as `scopeRules`, inside the command's transaction.
    const self = new LearningAdminService({ ...this.deps, db: tx as never });
    return self.scopeRules(kind, scopeId);
  }

  private async writeLayer(
    tx: LearningTx,
    kind: LearningScopeKind,
    scopeId: string,
    expectedVersion: number,
    change: {
      values: LearningSettingValues;
      presetId?: string;
      keepPreset?: boolean;
    },
  ): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`learning-layer:${kind}:${scopeId}`}))`,
    );
    const [current] = await tx
      .select()
      .from(learningRuleLayers)
      .where(
        and(
          eq(learningRuleLayers.scopeKind, kind),
          eq(learningRuleLayers.scopeId, scopeId),
        ),
      )
      .for("update");
    if ((current?.version ?? 0) !== expectedVersion) throw stale();
    const appliedPresetId =
      change.presetId ?? (change.keepPreset ? current?.appliedPresetId : null);
    if (!current) {
      await tx.insert(learningRuleLayers).values({
        scopeKind: kind,
        scopeId,
        values: change.values,
        appliedPresetId: appliedPresetId ?? null,
      });
      return;
    }
    await tx
      .update(learningRuleLayers)
      .set({
        values: change.values,
        appliedPresetId: appliedPresetId ?? null,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(learningRuleLayers.id, current.id));
  }

  /**
   * The scope path a setting resolves along, the layers to load, and the items
   * a rule written on this scope may reference (EARS-6 «inside the rule's scope»).
   */
  private async scopeChain(
    db: LearningServerDeps["db"] | LearningTx,
    kind: LearningScopeKind,
    scopeId: string,
  ): Promise<{
    path: LearningScopePath;
    chain: Array<{ kind: LearningScopeKind; id: string }>;
    ruleScope: LearningRuleScope;
  }> {
    if (kind === "platform") {
      if (scopeId !== LEARNING_PLATFORM_SCOPE_ID) throw notFound("scope");
      return { path: {}, chain: [], ruleScope: EMPTY_RULE_SCOPE };
    }
    if (kind === "school") {
      const [school] = await db
        .select({ id: learningSchools.id })
        .from(learningSchools)
        .where(eq(learningSchools.id, scopeId));
      if (!school) throw notFound("school");
      return {
        path: { school: scopeId },
        chain: [{ kind: "school", id: scopeId }],
        ruleScope: EMPTY_RULE_SCOPE,
      };
    }
    let courseRow: LearningCourseRow | undefined;
    let path: LearningScopePath = {};
    if (kind === "course") {
      courseRow = await courseById(db, scopeId);
      if (courseRow)
        path = { school: courseRow.schoolId, course: courseRow.id };
    } else if (kind === "module") {
      const o = await courseOfModule(db, scopeId);
      courseRow = o?.course;
      if (o)
        path = {
          school: o.course.schoolId,
          course: o.course.id,
          module: o.module.id,
        };
    } else if (kind === "lesson") {
      const o = await courseOfLesson(db, scopeId);
      courseRow = o?.course;
      if (o)
        path = {
          school: o.course.schoolId,
          course: o.course.id,
          module: o.module.id,
          lesson: o.lesson.id,
        };
    } else {
      const o = await courseOfStep(db, scopeId);
      courseRow = o?.course;
      if (o)
        path = {
          school: o.course.schoolId,
          course: o.course.id,
          module: o.module.id,
          lesson: o.lesson.id,
          step: o.step.id,
        };
    }
    if (!courseRow) throw notFound(kind);
    const loaded = await loadCourseTree(db, courseRow, false);
    // The items under this scope — what its completion rules may name.
    const inScope = loaded.steps.filter((s) => {
      if (kind === "course") return true;
      if (kind === "step") return s.id === scopeId;
      const lesson = loaded.lessons.find((l) => l.id === s.lessonId);
      if (kind === "lesson") return s.lessonId === scopeId;
      return lesson?.moduleId === scopeId;
    });
    const moduleIds =
      kind === "course"
        ? loaded.modules.map((m) => m.id)
        : kind === "module"
          ? [scopeId]
          : [];
    return {
      path,
      chain: scopesOf(loaded),
      ruleScope: {
        stepIds: new Set(inScope.map((s) => s.id)),
        moduleIds: new Set(moduleIds),
        testStepIds: new Set(
          inScope.filter((s) => s.type === "test").map((s) => s.id),
        ),
      },
    };
  }

  /** A test's questions and options, replaced as a whole on update (old rows soft-removed). */
  private async writeTest(
    tx: LearningTx,
    stepId: string,
    payload: Record<string, unknown>,
    replace: boolean,
  ): Promise<void> {
    const test = LearningTestPayloadSchema.parse(payload);
    if (replace) {
      await tx
        .update(learningQuestions)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(learningQuestions.testId, stepId),
            isNull(learningQuestions.removedAt),
          ),
        );
      await tx
        .update(learningTests)
        .set({ kind: test.kind, updatedAt: new Date() })
        .where(eq(learningTests.stepId, stepId));
    } else {
      await tx.insert(learningTests).values({ stepId, kind: test.kind });
    }
    for (const [qi, q] of test.questions.entries()) {
      const [question] = await tx
        .insert(learningQuestions)
        .values({
          testId: stepId,
          position: qi + 1,
          text: q.text,
          correctiveText: q.correctiveText ?? null,
        })
        .returning({ id: learningQuestions.id });
      await tx.insert(learningOptions).values(
        q.options.map((o, oi) => ({
          questionId: question!.id,
          position: oi + 1,
          text: o.text,
          correct: o.correct,
        })),
      );
    }
  }

  /** The admin-written test payload, rebuilt from its rows (what EARS-4 validates). */
  private async storedTestPayload(
    tx: LearningTx,
    step: LearningStepRow,
  ): Promise<unknown> {
    const questions = await loadQuestions(tx, step.id);
    return {
      kind: (step.payload as Record<string, unknown>)["kind"],
      questions: questions.map((q) => ({
        text: q.text,
        ...(q.correctiveText ? { correctiveText: q.correctiveText } : {}),
        options: q.options.map((o) => ({ text: o.text, correct: o.correct })),
      })),
    };
  }

  private async lessonBody(
    db: LearningServerDeps["db"] | LearningTx,
    row: LearningLessonRow,
  ): Promise<LearningLessonAdmin> {
    const steps = await this.liveSteps(db, row.id);
    const tests = steps.filter((s) => s.type === "test").map((s) => s.id);
    const questions = new Map<string, LearningStepAdmin["questions"]>();
    for (const id of tests) questions.set(id, await this.questionsOf(db, id));
    return this.toLessonAdmin(row, steps, questions);
  }

  private async stepBody(
    db: LearningServerDeps["db"] | LearningTx,
    row: LearningStepRow,
  ): Promise<LearningStepAdmin> {
    return this.toStepAdmin(
      row,
      row.type === "test" ? await this.questionsOf(db, row.id) : null,
    );
  }

  private async questionsOf(
    db: LearningServerDeps["db"] | LearningTx,
    testId: string,
  ): Promise<LearningStepAdmin["questions"]> {
    const rows = await loadQuestions(db, testId);
    return rows.map((q) => ({
      id: q.id,
      text: q.text,
      correctiveText: q.correctiveText,
      options: q.options.map((o) => ({
        id: o.id,
        text: o.text,
        correct: o.correct,
      })),
    }));
  }

  private toStepAdmin(
    row: LearningStepRow,
    questions: LearningStepAdmin["questions"],
  ): LearningStepAdmin {
    return {
      id: row.id,
      lessonId: row.lessonId,
      position: row.position,
      type: row.type as LearningElementType,
      title: row.title,
      durationMin: row.durationMin,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      questions,
      media:
        row.mediaRef && row.mediaContentType && row.mediaSizeBytes !== null
          ? { contentType: row.mediaContentType, sizeBytes: row.mediaSizeBytes }
          : null,
      source:
        row.provider && row.embedRef
          ? { provider: row.provider, embedRef: row.embedRef }
          : null,
      version: row.version,
    };
  }

  private toLessonAdmin(
    row: LearningLessonRow,
    steps: LearningStepRow[],
    questions: Map<string, LearningStepAdmin["questions"]>,
  ): LearningLessonAdmin {
    return {
      id: row.id,
      moduleId: row.moduleId,
      projectId: row.projectId,
      position: row.position,
      title: row.title,
      description: row.description,
      teaser: row.teaser,
      state: row.state,
      durationMin: steps.reduce((sum, s) => sum + s.durationMin, 0),
      steps: steps.map((s) => this.toStepAdmin(s, questions.get(s.id) ?? null)),
      version: row.version,
    };
  }
}
