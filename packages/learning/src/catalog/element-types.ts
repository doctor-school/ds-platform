import {
  LEARNING_ELEMENT_TYPES,
  LEARNING_STEP_MEDIA_MAX_BYTES,
  LEARNING_STEP_PAYLOAD_SCHEMAS,
  type LearningElementType,
} from "@ds/schemas";
import type { z } from "zod";
import { LEARNING_COPY_RU } from "../copy/learning-copy-ru.js";
import type { LearningStepModel } from "../model.js";
import type { LearningEvalContext } from "../evaluator/context.js";

// 024 EARS-2 — the element-type catalog as code. Each type declares its payload
// schema, the progress facts a client may report on it and its «viewed»
// definition with its default; a percentage is the setting of EARS-5, never a
// literal here. Adding a type is a code change (#4013 adds the rest).

export type LearningClientFactKind = "position" | "opened";

/** A type's media slot under the 012 media contract (an uploaded object, never a URL). */
export interface LearningMediaDef {
  /** The content types the upload accepts. */
  contentTypes: readonly string[];
  maxBytes: number;
}

export interface LearningElementTypeDef {
  type: LearningElementType;
  payloadSchema: z.ZodType;
  /** The step's required media, or null for a type with none (EARS-4 requires it on publish). */
  media: LearningMediaDef | null;
  /** The facts `POST /v1/me/learning/facts` accepts on a step of this type. */
  clientFacts: readonly LearningClientFactKind[];
  /** The type's «viewed» definition over the doctor's facts and the resolved settings. */
  viewed(step: LearningStepModel, ctx: LearningEvalContext): boolean;
  /** The «viewed» clause of the completion sentence (EARS-17). */
  viewedPhrase(step: LearningStepModel, ctx: LearningEvalContext): string;
}

/** The media length a `video` payload declares, in seconds. */
export function videoDurationSec(step: LearningStepModel): number {
  const d = step.payload["durationSec"];
  return typeof d === "number" && d > 0 ? d : 0;
}

/** EARS-10 — the watched share, positions capped at the real media duration. */
export function watchedPercent(
  step: LearningStepModel,
  ctx: LearningEvalContext,
): number {
  const duration = videoDurationSec(step);
  if (duration === 0) return 0;
  const position = Math.min(ctx.facts.maxPosition(step.id), duration);
  return Math.floor((position / duration) * 100);
}

export const LEARNING_ELEMENT_CATALOG: Readonly<
  Record<LearningElementType, LearningElementTypeDef>
> = {
  video: {
    type: "video",
    payloadSchema: LEARNING_STEP_PAYLOAD_SCHEMAS.video,
    media: {
      contentTypes: ["video/mp4", "video/webm"],
      maxBytes: LEARNING_STEP_MEDIA_MAX_BYTES,
    },
    clientFacts: ["position"],
    viewed: (step, ctx) =>
      watchedPercent(step, ctx) >= ctx.setting("viewed.video.percent", step),
    viewedPhrase: (step, ctx) =>
      LEARNING_COPY_RU.phrase.videoWatched(
        ctx.setting("viewed.video.percent", step),
      ),
  },
  download: {
    type: "download",
    payloadSchema: LEARNING_STEP_PAYLOAD_SCHEMAS.download,
    media: {
      contentTypes: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      maxBytes: LEARNING_STEP_MEDIA_MAX_BYTES,
    },
    clientFacts: ["opened"],
    viewed: (step, ctx) => ctx.facts.opened(step.id),
    viewedPhrase: () => LEARNING_COPY_RU.phrase.downloadOpened,
  },
  test: {
    type: "test",
    payloadSchema: LEARNING_STEP_PAYLOAD_SCHEMAS.test,
    media: null,
    clientFacts: [],
    viewed: (step, ctx) =>
      ctx.facts.bestScore(step.id) >= ctx.setting("test.threshold", step),
    viewedPhrase: (step, ctx) =>
      LEARNING_COPY_RU.phrase.testPassed(ctx.setting("test.threshold", step)),
  },
};

/** EARS-2 — the catalog entry, or undefined for a type it does not declare. */
export function elementType(type: string): LearningElementTypeDef | undefined {
  return (LEARNING_ELEMENT_TYPES as readonly string[]).includes(type)
    ? LEARNING_ELEMENT_CATALOG[type as LearningElementType]
    : undefined;
}

/** Whether a step is a lesson's exit test. */
export function isExitTest(step: LearningStepModel): boolean {
  return step.type === "test" && step.payload["kind"] === "exit";
}
