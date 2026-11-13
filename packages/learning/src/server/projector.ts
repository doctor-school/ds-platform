import { learningNodeStatus } from "@ds/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { LearningCourseEvaluator, LearningEvaluation } from "../evaluator/evaluator.js";
import type { LearningEvent, LearningServerDeps, LearningTx } from "./deps.js";

// 024 EARS-11, EARS-12 — the status projector. It diffs the evaluator's
// statuses against the rebuildable `learning_node_status` projection, upserts
// the changed rows with their cause, and on a lesson's or module's transition to
// `done` records the 025 fact through `PointsEngine.record(tx, fact)` inside the
// causing transaction. The 025 event id is derived from the person and the item,
// so a re-completion replays as a 025 duplicate; a status turning back from
// `done` records nothing toward 025.

export interface LearningStatusChange {
  itemKind: "step" | "lesson" | "module" | "course";
  itemId: string;
  status: "done" | "current" | "open" | "locked" | "test-out-reachable";
}

export interface LearningProjection {
  changed: LearningStatusChange[];
  /** Run after COMMIT: the 025 publication and the in-process events. */
  afterCommit: () => Promise<void>;
}

/** Serialise one doctor's writes on one course (the projection diff is read-modify-write). */
export async function lockPersonCourse(tx: LearningTx, personId: string, courseId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`learning:${personId}:${courseId}`}))`);
}

export function completionEventId(type: "lesson.completed" | "module.completed", personId: string, itemId: string): string {
  return `learning:${type}:${personId}:${itemId}`;
}

export async function project(
  deps: LearningServerDeps,
  tx: LearningTx,
  input: {
    personId: string;
    evaluator: LearningCourseEvaluator;
    evaluation: LearningEvaluation;
    cause: { kind: "fact" | "rule-change"; id: string };
    at: Date;
  },
): Promise<LearningProjection> {
  const { personId, evaluator, evaluation, cause, at } = input;
  const ids = [...evaluation.states.keys()];
  const existing =
    ids.length === 0
      ? []
      : await tx
          .select({ itemId: learningNodeStatus.itemId, status: learningNodeStatus.status })
          .from(learningNodeStatus)
          .where(and(eq(learningNodeStatus.personId, personId), inArray(learningNodeStatus.itemId, ids)));
  const before = new Map(existing.map((r) => [r.itemId, r.status]));

  const changed: LearningStatusChange[] = [];
  const publishers: Array<() => Promise<void>> = [];
  const events: LearningEvent[] = [];
  const mode = evaluator.setting("course.deliveryMode", { kind: "course", id: evaluator.index.course.id });

  for (const [itemId, state] of evaluation.states) {
    const previous = before.get(itemId);
    if (previous === state.status) continue;
    const itemKind = evaluation.kinds.get(itemId)!;
    changed.push({ itemKind, itemId, status: state.status });
    await tx
      .insert(learningNodeStatus)
      .values({ personId, itemKind, itemId, status: state.status, since: at, causeKind: cause.kind, causeId: cause.id })
      .onConflictDoUpdate({
        target: [learningNodeStatus.personId, learningNodeStatus.itemId],
        set: { status: state.status, since: at, causeKind: cause.kind, causeId: cause.id },
      });
    if (state.status !== "done") continue;
    if (itemKind === "lesson" || itemKind === "module") {
      const type = itemKind === "lesson" ? "lesson.completed" : "module.completed";
      const recorded = await deps.points.record(tx, {
        type,
        eventId: completionEventId(type, personId, itemId),
        personId,
        ref: itemId,
        occurredAt: at,
        attributes: { mode },
      });
      publishers.push(recorded.publishAfterCommit);
    } else if (itemKind === "step") {
      events.push({ type: "StepCompleted", personId, stepId: itemId, at });
      const step = evaluator.index.steps.get(itemId)?.step;
      if (step?.type === "test") {
        events.push({ type: "TestPassed", personId, testId: itemId, score: evaluator.facts.bestScore(itemId), at });
      }
    } else if (itemKind === "course") {
      events.push({ type: "CourseCompleted", personId, courseId: itemId, at });
    }
  }

  return {
    changed,
    afterCommit: async () => {
      for (const publish of publishers) await publish();
      for (const event of events) await deps.events.publish(event);
    },
  };
}
