import {
  learningCourses,
  learningFacts,
  learningNodeStatus,
  learningRuleChanges,
  type LearningCourseRow,
} from "@ds/db";
import type {
  LearningEarnedProgress,
  LearningRuleChangePreview,
  LearningScopeKind,
  LearningSettingKey,
  LearningSettingValues,
  LearningStatusReason,
} from "@ds/schemas";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  evaluateCourse,
  type LearningCourseEvaluator,
  type LearningEvaluation,
} from "../evaluator/evaluator.js";
import type { LearningLayers } from "../rules/resolver.js";
import {
  SERVER_EVENT_PREFIX,
  type LearningServerDeps,
  type LearningTx,
} from "./deps.js";
import { lockPersonCourse, project } from "./projector.js";
import {
  courseById,
  courseOfLesson,
  courseOfModule,
  courseOfStep,
  loadCourseTree,
  loadFacts,
  loadLayersFor,
  scopesOf,
  type LoadedCourse,
} from "./repository.js";

// 024 EARS-24, EARS-31 (024-design §5) — a rule change on a published course.
// The preview evaluates every affected doctor's facts under the old and the new
// rules and writes nothing. The save writes the layer, one
// `learning_rule_changes` row and (under «keep», owner D16) a `completion-kept`
// fact for every item that was done and would no longer be, in one
// transaction; after COMMIT the affected doctors' statuses are recomputed with
// the change as the cause. The recompute is the projection diff, so it is
// idempotent: a run interrupted before `recomputed_at` is set is resumed by
// {@link resumeRuleChanges}. Reads compute live from facts and rules, so a
// doctor never sees a stale status while it runs.

type Handle = LearningServerDeps["db"] | LearningTx;

/** Doctors recomputed per pass; each doctor is its own short transaction. */
export const RULE_CHANGE_BATCH = 50;

/** Every published course whose items resolve through the scope (EARS-5). */
export async function publishedCoursesUnder(
  db: Handle,
  kind: LearningScopeKind,
  scopeId: string,
): Promise<LearningCourseRow[]> {
  const published = eq(learningCourses.state, "published");
  if (kind === "platform")
    return db.select().from(learningCourses).where(published);
  if (kind === "school")
    return db
      .select()
      .from(learningCourses)
      .where(and(published, eq(learningCourses.schoolId, scopeId)));
  const course =
    kind === "course"
      ? await courseById(db, scopeId)
      : kind === "module"
        ? (await courseOfModule(db, scopeId))?.course
        : kind === "lesson"
          ? (await courseOfLesson(db, scopeId))?.course
          : (await courseOfStep(db, scopeId))?.course;
  return course?.state === "published" ? [course] : [];
}

/** The doctors holding any fact on a course's items. */
export async function doctorsOnCourse(
  db: Handle,
  loaded: LoadedCourse,
): Promise<string[]> {
  const stepIds = loaded.steps.map((s) => s.id);
  const itemIds = [
    loaded.row.id,
    ...loaded.modules.map((m) => m.id),
    ...loaded.lessons.map((l) => l.id),
    ...stepIds,
  ];
  const rows = await db
    .selectDistinct({ personId: learningFacts.personId })
    .from(learningFacts)
    .where(
      or(
        stepIds.length > 0 ? inArray(learningFacts.stepId, stepIds) : undefined,
        inArray(learningFacts.itemRef, itemIds),
      ),
    );
  return rows.map((r) => r.personId);
}

/** One doctor's statuses under the old vs the new rules. */
export interface LearningStatusDiff {
  /** Any item's status differs. */
  changed: boolean;
  /** Items done under the old rules and not under the new ones. */
  lostDone: string[];
  /** Some item done under the new rules and not under the old ones. */
  gainedDone: boolean;
}

export function diffEvaluations(
  before: LearningEvaluation,
  after: LearningEvaluation,
): LearningStatusDiff {
  const lostDone: string[] = [];
  let changed = false;
  let gainedDone = false;
  const ids = new Set([...before.states.keys(), ...after.states.keys()]);
  for (const id of ids) {
    const a = before.states.get(id)?.status;
    const b = after.states.get(id)?.status;
    if (a === b) continue;
    changed = true;
    if (a === "done") lostDone.push(id);
    else if (b === "done") gainedDone = true;
  }
  return { changed, lostDone, gainedDone };
}

interface DoctorAssessment extends LearningStatusDiff {
  personId: string;
}

/** Evaluate every affected doctor under the old and the new values of one scope. */
async function assess(
  db: Handle,
  kind: LearningScopeKind,
  scopeId: string,
  values: LearningSettingValues,
  now: Date,
): Promise<DoctorAssessment[]> {
  const out: DoctorAssessment[] = [];
  for (const course of await publishedCoursesUnder(db, kind, scopeId)) {
    const loaded = await loadCourseTree(db, course, true);
    const oldLayers = await loadLayersFor(db, scopesOf(loaded));
    const newLayers = oldLayers.withValues(kind, scopeId, values);
    for (const personId of await doctorsOnCourse(db, loaded)) {
      const facts = await loadFacts(db, personId, loaded);
      const run = (layers: LearningLayers) =>
        evaluateCourse({ course: loaded.model, layers, facts, now }).evaluation;
      out.push({
        personId,
        ...diffEvaluations(run(oldLayers), run(newLayers)),
      });
    }
  }
  return out;
}

/** EARS-31 — the change dialog's count; nothing is written. */
export async function previewRuleChange(
  db: Handle,
  kind: LearningScopeKind,
  scopeId: string,
  values: LearningSettingValues,
  now: Date,
): Promise<LearningRuleChangePreview> {
  const affected = new Set<string>();
  const toDone = new Set<string>();
  const toNotDone = new Set<string>();
  for (const d of await assess(db, kind, scopeId, values, now)) {
    if (d.changed) affected.add(d.personId);
    if (d.gainedDone) toDone.add(d.personId);
    if (d.lostDone.length > 0) toNotDone.add(d.personId);
  }
  return {
    affectedDoctors: affected.size,
    toDone: toDone.size,
    toNotDone: toNotDone.size,
  };
}

/**
 * EARS-31 — inside the saving transaction, BEFORE the layer is written: the
 * `learning_rule_changes` row and, under «keep», the `completion-kept` facts.
 * Returns the change id the after-commit recompute takes.
 */
export async function recordRuleChange(
  tx: LearningTx,
  input: {
    kind: LearningScopeKind;
    scopeId: string;
    before: LearningSettingValues;
    after: LearningSettingValues;
    earnedProgress: LearningEarnedProgress;
    actorSub: string | null;
    now: Date;
  },
): Promise<string> {
  const assessed =
    input.earnedProgress === "keep"
      ? await assess(tx, input.kind, input.scopeId, input.after, input.now)
      : [];
  const [change] = await tx
    .insert(learningRuleChanges)
    .values({
      scopeKind: input.kind,
      scopeId: input.scopeId,
      before: input.before,
      after: input.after,
      earnedProgress: input.earnedProgress,
      actorSub: input.actorSub,
      at: input.now,
    })
    .returning({ id: learningRuleChanges.id });
  const ruleChangeId = change!.id;
  for (const d of assessed) {
    for (const itemId of d.lostDone) {
      await tx
        .insert(learningFacts)
        .values({
          eventId: `${SERVER_EVENT_PREFIX}completion-kept:${ruleChangeId}:${itemId}`,
          personId: d.personId,
          kind: "completion-kept",
          itemRef: itemId,
          data: { item: itemId, ruleChangeId },
          source: "system",
          occurredAt: input.now,
        })
        .onConflictDoNothing({
          target: [learningFacts.personId, learningFacts.eventId],
        });
    }
  }
  return ruleChangeId;
}

/**
 * EARS-31 — after COMMIT: recompute every affected doctor's statuses with the
 * change as the cause (EARS-11) and emit the transitions (EARS-12), then mark
 * the change recomputed. Idempotent — the projection diff writes only what
 * differs — so a re-run resumes an interrupted one.
 */
export async function recomputeRuleChange(
  deps: LearningServerDeps,
  ruleChangeId: string,
): Promise<void> {
  const [change] = await deps.db
    .select()
    .from(learningRuleChanges)
    .where(eq(learningRuleChanges.id, ruleChangeId));
  if (!change) return;
  const now = () => deps.now?.() ?? new Date();
  const courses = await publishedCoursesUnder(
    deps.db,
    change.scopeKind as LearningScopeKind,
    change.scopeId,
  );
  for (const course of courses) {
    const doctors = await doctorsOnCourse(
      deps.db,
      await loadCourseTree(deps.db, course, true),
    );
    for (let i = 0; i < doctors.length; i += RULE_CHANGE_BATCH) {
      for (const personId of doctors.slice(i, i + RULE_CHANGE_BATCH)) {
        const projection = await deps.transaction(async (tx) => {
          await lockPersonCourse(tx, personId, course.id);
          const loaded = await loadCourseTree(tx, course, true);
          const layers = await loadLayersFor(tx, scopesOf(loaded));
          const facts = await loadFacts(tx, personId, loaded);
          const at = now();
          const { evaluator, evaluation } = evaluateCourse({
            course: loaded.model,
            layers,
            facts,
            now: at,
          });
          return project(deps, tx, {
            personId,
            evaluator,
            evaluation,
            cause: { kind: "rule-change", id: ruleChangeId },
            at,
          });
        });
        await projection.afterCommit();
      }
    }
  }
  await deps.db
    .update(learningRuleChanges)
    .set({ recomputedAt: now() })
    .where(eq(learningRuleChanges.id, ruleChangeId));
}

/** Resume every rule change whose recompute never finished (host boot). */
export async function resumeRuleChanges(
  deps: LearningServerDeps,
): Promise<number> {
  const pending = await deps.db
    .select({ id: learningRuleChanges.id })
    .from(learningRuleChanges)
    .where(isNull(learningRuleChanges.recomputedAt))
    .orderBy(learningRuleChanges.at);
  for (const { id } of pending) await recomputeRuleChange(deps, id);
  return pending.length;
}

/**
 * Owner D16 (EARS-31) — a lesson of a published course republished after a
 * change (unpublish → edit → publish) keeps earned completion: inside the
 * publishing transaction, every doctor whose projection holds the lesson, its
 * module or its course `done` and whom the changed tree would no longer
 * count done gets a `completion-kept` fact for that item.
 */
export async function keepRepublishedCompletion(
  tx: LearningTx,
  input: {
    course: LearningCourseRow;
    moduleId: string;
    lessonId: string;
    lessonVersion: number;
    now: Date;
  },
): Promise<void> {
  const items = [input.lessonId, input.moduleId, input.course.id];
  const rows = await tx
    .select({
      personId: learningNodeStatus.personId,
      itemId: learningNodeStatus.itemId,
    })
    .from(learningNodeStatus)
    .where(
      and(
        inArray(learningNodeStatus.itemId, items),
        eq(learningNodeStatus.status, "done"),
      ),
    );
  if (rows.length === 0) return;
  const donePerPerson = new Map<string, string[]>();
  for (const r of rows)
    donePerPerson.set(r.personId, [
      ...(donePerPerson.get(r.personId) ?? []),
      r.itemId,
    ]);
  const loaded = await loadCourseTree(tx, input.course, true);
  const layers = await loadLayersFor(tx, scopesOf(loaded));
  for (const [personId, done] of donePerPerson) {
    const facts = await loadFacts(tx, personId, loaded);
    const { evaluation } = evaluateCourse({
      course: loaded.model,
      layers,
      facts,
      now: input.now,
    });
    for (const itemId of done) {
      if (evaluation.states.get(itemId)?.status === "done") continue;
      await tx
        .insert(learningFacts)
        .values({
          eventId: `${SERVER_EVENT_PREFIX}completion-kept:republish:${input.lessonId}:${input.lessonVersion}:${itemId}`,
          personId,
          kind: "completion-kept",
          itemRef: itemId,
          data: { item: itemId, republishedLessonId: input.lessonId },
          source: "system",
          occurredAt: input.now,
        })
        .onConflictDoNothing({
          target: [learningFacts.personId, learningFacts.eventId],
        });
    }
  }
}

// ── EARS-24 — the status reason ─────────────────────────────────────────────

/** The settings a change touched on its scope, before → after (null = not set there). */
export function changedSettings(
  before: LearningSettingValues,
  after: LearningSettingValues,
): LearningStatusReason["changed"] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: LearningStatusReason["changed"] = [];
  for (const key of [...keys].sort()) {
    const b = (before as Record<string, unknown>)[key] ?? null;
    const a = (after as Record<string, unknown>)[key] ?? null;
    if (canonical(b) === canonical(a)) continue;
    out.push({ key: key as LearningSettingKey, before: b, after: a });
  }
  return out;
}

/**
 * EARS-24 — the reason of each given lesson whose projected status was last
 * changed by a rule change; a lesson the doctor has since completed carries a
 * `fact` cause and so no reason.
 */
export async function lessonStatusReasons(
  db: Handle,
  personId: string,
  lessonIds: readonly string[],
  evaluator: LearningCourseEvaluator,
  evaluation: LearningEvaluation,
): Promise<Map<string, LearningStatusReason>> {
  const reasons = new Map<string, LearningStatusReason>();
  if (lessonIds.length === 0) return reasons;
  const rows = await db
    .select({ itemId: learningNodeStatus.itemId, change: learningRuleChanges })
    .from(learningNodeStatus)
    .innerJoin(
      learningRuleChanges,
      sql`${learningRuleChanges.id}::text = ${learningNodeStatus.causeId}`,
    )
    .where(
      and(
        eq(learningNodeStatus.personId, personId),
        eq(learningNodeStatus.causeKind, "rule-change"),
        inArray(learningNodeStatus.itemId, [...lessonIds]),
      ),
    );
  for (const { itemId, change } of rows) {
    const status = evaluation.states.get(itemId)?.status;
    if (!status) continue;
    reasons.set(itemId, {
      ruleChangeId: change.id,
      at: change.at.toISOString(),
      scope: {
        kind: change.scopeKind as LearningScopeKind,
        id: change.scopeId,
      },
      changed: changedSettings(
        change.before as LearningSettingValues,
        change.after as LearningSettingValues,
      ),
      needed: {
        status,
        completionSentence: evaluator.sentence({ kind: "lesson", id: itemId }),
      },
    });
  }
  return reasons;
}

/** A JSON text independent of key order (jsonb stores keys reordered). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([x], [y]) =>
            x < y ? -1 : x > y ? 1 : 0,
          ),
        )
      : v,
  );
}
