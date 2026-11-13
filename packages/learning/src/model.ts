import type {
  LearningElementType,
  LearningScopeKind,
  LearningSettingKey,
  LearningSettings,
  LearningSettingValues,
} from "@ds/schemas";

// 024 — the pure structure and fact model the evaluator reads (024-design §2,
// §4). No I/O: the server half loads rows into these shapes.

export interface LearningStepModel {
  id: string;
  type: LearningElementType;
  title: string;
  durationMin: number;
  /** The stored payload (for `test`: `{ kind }`). */
  payload: Record<string, unknown>;
}

export interface LearningLessonModel {
  id: string;
  title: string;
  steps: LearningStepModel[];
}

export interface LearningModuleModel {
  id: string;
  title: string;
  lessons: LearningLessonModel[];
}

export interface LearningCourseModel {
  id: string;
  schoolId: string;
  modules: LearningModuleModel[];
}

/** The progress facts the evaluator reads (024-design §2 «Facts»). */
export type LearningFactModel =
  | { kind: "position"; stepId: string; positionSec: number }
  | { kind: "opened"; stepId: string }
  | { kind: "attempt-submitted"; stepId: string; score: number }
  | { kind: "manual-mark"; itemId: string }
  | { kind: "club-attended"; moduleId: string }
  | { kind: "completion-kept"; itemId: string }
  | { kind: "test-out-passed"; itemId: string };

/** One rule layer row (EARS-5). */
export interface LearningLayer {
  scopeKind: LearningScopeKind;
  scopeId: string;
  values: LearningSettingValues;
  /** The preset's name when this layer was written by «Применить пресет». */
  preset: string | null;
}

/** The ids above an item, nearest-first resolution walks step → … → school → platform. */
export type LearningScopePath = Partial<
  Record<Exclude<LearningScopeKind, "platform">, string>
>;

export type { LearningSettingKey, LearningSettings };

/** The id the platform layer row carries. */
export const LEARNING_PLATFORM_SCOPE_ID = "platform";
