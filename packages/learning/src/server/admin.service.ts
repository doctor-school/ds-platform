import {
  directions,
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
  type LearningElementType,
  type LearningLessonAdmin,
  type LearningModuleAdmin,
  type LearningPreset,
  type LearningSchoolAdmin,
  type LearningScopeKind,
  type LearningScopeRules,
  type LearningSettingValues,
  type LearningStepAdmin,
  type UpdateLearningLessonRequest,
  type UpdateLearningStepRequest,
  LEARNING_SETTING_KEYS,
  LearningTestPayloadSchema,
  SetLearningStepSourceRequestSchema,
  type SetLearningStepSourceRequest,
} from "@ds/schemas";
import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
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
  EMPTY_RULE_SCOPE,
  publishRequirements,
  validateSettingValues,
  validateStepPayload,
  type LearningRuleScope,
} from "../rules/validate.js";
import {
  fieldError,
  LearningServerError,
  type LearningServerDeps,
  type LearningTx,
} from "./deps.js";
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
  version: r.version,
});

const toCourse = (r: LearningCourseRow): LearningCourseAdmin => ({
  id: r.id,
  schoolId: r.schoolId,
  projectId: r.projectId,
  slug: r.slug,
  title: r.title,
  state: r.state,
  version: r.version,
});

const toModule = (r: LearningModuleRow): LearningModuleAdmin => ({
  id: r.id,
  courseId: r.courseId,
  position: r.position,
  title: r.title,
  version: r.version,
});

export class LearningAdminService {
  constructor(private readonly deps: LearningServerDeps) {}

  // ── Schools and courses (EARS-1) ──────────────────────────────────────────

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
        throw fieldError(
          "leadExpertId",
          "this expert already leads a school in this direction",
        );
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
      .orderBy(asc(learningCourses.title));
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
        if (issues.length > 0)
          throw new LearningServerError(
            "VALIDATION_FAILED",
            "the course references unknown rows",
            issues,
          );
        const [row] = await tx
          .insert(learningCourses)
          .values(input)
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
    const body: LearningCourseComposition = {
      ...toCourse(course),
      modules: loaded.modules.map((m) => ({
        ...toModule(m),
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
    return this.deps.transaction(async (tx) => {
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
        })
        .where(eq(learningCourses.id, courseId))
        .returning();
      const result = {
        status: 200 as const,
        body: toCourse(row!),
        etag: taxonomyETag(row!.version),
      };
      await complete(tx, result);
      return result;
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
        body: toModule(row!),
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
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      values: r.values as LearningSettingValues,
      version: r.version,
    }));
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
  ): Promise<LearningCommandResult<LearningScopeRules>> {
    return this.deps.transaction(async (tx) => {
      const { ruleScope } = await this.scopeChain(tx, kind, scopeId);
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
      await this.writeLayer(tx, kind, scopeId, expectedVersion, {
        values: check.values,
        keepPreset: true,
      });
      return this.finishRules(tx, kind, scopeId, complete);
    });
  }

  /** EARS-9 — apply a preset on a school or a course: one layer written, every other kept. */
  async applyPreset(
    kind: "school" | "course",
    scopeId: string,
    presetId: string,
    expectedVersion: number,
    complete: LearningComplete = noComplete,
  ): Promise<LearningCommandResult<LearningScopeRules>> {
    return this.deps.transaction(async (tx) => {
      await this.scopeChain(tx, kind, scopeId);
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
      await this.writeLayer(tx, kind, scopeId, expectedVersion, {
        values,
        presetId: preset.id,
      });
      return this.finishRules(tx, kind, scopeId, complete);
    });
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

  private async lockStep(
    tx: LearningTx,
    stepId: string,
    expectedVersion: number,
  ): Promise<LearningStepRow> {
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
