import type { DrizzleHandle } from "@ds/db";
import type { LearningFieldIssue } from "../rules/validate.js";

// 024 — the server half's seams (024-design §1 `./server`). The host
// (`apps/api`) supplies the database, the audit-attributed transaction (010),
// the 025 `PointsEngine` bridge and the in-process event bus; this package
// owns the logic and never imports a host.

export type LearningDb = DrizzleHandle["db"];
export type LearningTx = Parameters<
  Parameters<LearningDb["transaction"]>[0]
>[0];

/** The 025 fact a completion records (025 EARS-7 / EARS-8; 024 EARS-12). */
export interface LearningCompletionFact {
  type: "lesson.completed" | "module.completed";
  eventId: string;
  personId: string;
  ref: string;
  occurredAt: Date;
  attributes: { mode: "online" | "offline" | "open" };
}

/** `PointsEngine.record(tx, fact)` — recorded inside the causing transaction. */
export interface LearningPointsPort {
  record(
    tx: LearningTx,
    fact: LearningCompletionFact,
  ): Promise<{ publishAfterCommit: () => Promise<void> }>;
}

/** EARS-12 — the in-process transitions published after commit. */
export type LearningEvent =
  | { type: "StepCompleted"; personId: string; stepId: string; at: Date }
  | {
      type: "TestPassed";
      personId: string;
      testId: string;
      score: number;
      at: Date;
    }
  | { type: "CourseCompleted"; personId: string; courseId: string; at: Date };

export class LearningEventBus {
  private readonly listeners = new Set<
    (event: LearningEvent) => void | Promise<void>
  >();

  subscribe(
    listener: (event: LearningEvent) => void | Promise<void>,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(event: LearningEvent): Promise<void> {
    for (const listener of this.listeners) await listener(event);
  }
}

/** The 012 media store: a short-lived signed GET for a stored object key (EARS-22: gated reads only). */
export interface LearningMediaPort {
  signedUrl(objectKey: string): Promise<string>;
}

export interface LearningServerDeps {
  db: LearningDb;
  media: LearningMediaPort;
  /** One audit-attributed transaction (apps/api: `withRequestAuditContext`). */
  transaction<T>(fn: (tx: LearningTx) => Promise<T>): Promise<T>;
  points: LearningPointsPort;
  events: LearningEventBus;
  now?: () => Date;
}

export type LearningServerErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "PUBLISH_REQUIREMENTS_NOT_MET"
  | "INVALID_TRANSITION"
  | "SLUG_CONFLICT"
  | "PRECONDITION_FAILED"
  | "LEARNING_STEP_LOCKED"
  | "LEARNING_ATTEMPT_UNAVAILABLE";

/** A refusal the host maps to its RFC 7807 problem (024-design §7). */
export class LearningServerError extends Error {
  constructor(
    readonly code: LearningServerErrorCode,
    message: string,
    readonly issues: LearningFieldIssue[] = [],
    /** `LEARNING_ATTEMPT_UNAVAILABLE` — when the next attempt opens; null = none left. */
    readonly nextAt: Date | null = null,
  ) {
    super(message);
  }
}

export function fieldError(path: string, message: string): LearningServerError {
  return new LearningServerError("VALIDATION_FAILED", message, [
    { path, message },
  ]);
}
