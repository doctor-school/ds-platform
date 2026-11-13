"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Link,
  Skeleton,
} from "@ds/design-system";
import type {
  CreateLearningStepRequest,
  LearningLessonAdmin,
  LearningStepAdmin,
  StreamProvider,
} from "@ds/schemas";

import { STEP_TYPE_LABEL } from "../ui/learning-ui-copy";
import { ADMIN_COPY as C, LESSON_STATE_LABEL } from "./admin-copy";
import { isStale, publishRefusalItems, refusedFieldLines } from "./refusals";
import { StepFileForm, StepSourceForm, AddStepForm } from "./step-forms";
import type { LearningAdminTransport } from "./transport";

// 024 EARS-28 (slice 1: `video`, `download`, the exit `test`) and EARS-4 — the
// staff lesson composition screen. Every write names the version the screen
// rendered from; a step write reloads the lesson so the next write asserts the
// version the server holds. A refusal changes nothing on the screen but the
// refusal itself: a publish names every missing item in words, any other write
// its field errors, a stale version reloads.

export interface LessonCompositionScreenProps {
  lessonId: string;
  transport: LearningAdminTransport;
  /** The 006 providers in the host's words (the admin's `events.providers.*`). */
  providerLabels: Record<StreamProvider, string>;
  /** The course screen the lesson belongs to, for the way back. */
  courseHref?: string;
}

type Refusal =
  { kind: "publish"; items: string[] } | { kind: "write"; lines: string[] };

export function LessonCompositionScreen({
  lessonId,
  transport,
  providerLabels,
  courseHref,
}: LessonCompositionScreenProps) {
  const [lesson, setLesson] = useState<LearningLessonAdmin | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const load = useCallback(async () => {
    try {
      setLesson(await transport.lesson(lessonId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [lessonId, transport]);

  useEffect(() => {
    void load();
    // The exit test's threshold is a rule of the lesson's scope (EARS-8), shown
    // beside the test; its editor is the rules editor's (#4012).
    transport
      .rules("lesson", lessonId)
      .then((r) => {
        const v = r.effective.find((s) => s.key === "test.threshold")?.value;
        setThreshold(typeof v === "number" ? v : null);
      })
      .catch(() => setThreshold(null));
  }, [lessonId, load, transport]);

  /** Run one write; `next` = the lesson the write answered, or reload. */
  async function write(
    run: () => Promise<LearningLessonAdmin | unknown>,
    answersLesson = false,
  ): Promise<boolean> {
    if (!lesson) return false;
    setBusy(true);
    setRefusal(null);
    try {
      const body = await run();
      if (answersLesson) setLesson(body as LearningLessonAdmin);
      else await load();
      return true;
    } catch (error) {
      const items = publishRefusalItems(error, lesson.steps);
      if (items) setRefusal({ kind: "publish", items });
      else if (isStale(error)) {
        setRefusal({ kind: "write", lines: [C.stale] });
        await load();
      } else {
        const lines = refusedFieldLines(error);
        setRefusal({
          kind: "write",
          lines: lines.length > 0 ? lines : [C.failed],
        });
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loadFailed)
    return (
      <Alert variant="danger" data-testid="lesson-load-error">
        {C.loadFailed}{" "}
        <Button variant="link" onClick={() => void load()}>
          {C.retry}
        </Button>
      </Alert>
    );
  if (!lesson)
    return (
      <div
        aria-busy="true"
        aria-label={C.loading}
        className="flex flex-col gap-3"
      >
        <div className="h-8 w-2/3">
          <Skeleton className="h-full w-full" />
        </div>
        <div className="h-24 w-full">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );

  const steps = lesson.steps;
  const move = (index: number, delta: number) => {
    const ids = steps.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    return write(
      () => transport.reorderSteps(lesson.id, ids, lesson.version),
      true,
    );
  };

  return (
    <div className="flex flex-col gap-6" data-testid="lesson-composition">
      {courseHref ? (
        <div>
          <Link href={courseHref} variant="standalone">
            {C.back}
          </Link>
        </div>
      ) : null}
      <header className="flex flex-col gap-2">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <h1 className="min-w-0 break-words text-xl font-extrabold text-foreground">
            {lesson.title}
          </h1>
          <Badge
            variant={lesson.state === "published" ? "success" : "label"}
            data-testid="lesson-state"
          >
            {LESSON_STATE_LABEL[lesson.state]}
          </Badge>
        </div>
        {lesson.teaser ? (
          <p className="text-sm text-muted-foreground">{lesson.teaser}</p>
        ) : null}
        {lesson.description ? (
          <p className="text-sm text-foreground">{lesson.description}</p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {C.lessonDuration(lesson.durationMin)}
        </p>
      </header>

      {refusal?.kind === "publish" ? (
        <Alert variant="danger" data-testid="publish-refusal">
          <p className="font-bold">{C.publishRefused}</p>
          <ul className="mt-1 list-disc pl-5">
            {refusal.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {refusal?.kind === "write" ? (
        <Alert variant="danger" data-testid="write-refusal">
          <p className="font-bold">{C.writeRefused}</p>
          <ul className="mt-1 list-disc pl-5">
            {refusal.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {lesson.state === "draft" ? (
          <Button
            disabled={busy}
            onClick={() =>
              void write(
                () => transport.publishLesson(lesson.id, lesson.version),
                true,
              )
            }
          >
            {C.publish}
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void write(
                () => transport.unpublishLesson(lesson.id, lesson.version),
                true,
              )
            }
          >
            {C.unpublish}
          </Button>
        )}
      </div>

      <section
        aria-labelledby="lesson-steps-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="lesson-steps-heading"
          className="text-lg font-bold text-foreground"
        >
          {C.stepsHeading}
        </h2>
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">{C.noSteps}</p>
        ) : null}
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <StepRow
              key={`${step.id}:${step.version}`}
              step={step}
              no={i + 1}
              last={i === steps.length - 1}
              busy={busy}
              threshold={threshold}
              providerLabels={providerLabels}
              onUp={() => void move(i, -1)}
              onDown={() => void move(i, 1)}
              onRemove={() =>
                void write(() => transport.removeStep(step.id, step.version))
              }
              onSource={(body) =>
                void write(() =>
                  transport.setStepSource(step.id, body, step.version),
                )
              }
              onUpload={(file) =>
                void write(() =>
                  transport.setStepMedia(step.id, file, step.version),
                )
              }
            />
          ))}
        </ol>
      </section>

      <AddStepForm
        lessonId={lesson.id}
        busy={busy}
        onAdd={(body: CreateLearningStepRequest) =>
          write(() => transport.createStep(body))
        }
      />
    </div>
  );
}

function StepRow({
  step,
  no,
  last,
  busy,
  threshold,
  providerLabels,
  onUp,
  onDown,
  onRemove,
  onSource,
  onUpload,
}: {
  step: LearningStepAdmin;
  no: number;
  last: boolean;
  busy: boolean;
  threshold: number | null;
  providerLabels: Record<StreamProvider, string>;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onSource: Parameters<typeof StepSourceForm>[0]["onSave"];
  onUpload: (file: File) => void;
}) {
  return (
    <li data-testid={`step-row-${no}`}>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 break-words font-bold text-foreground">
              {C.stepLine(
                no,
                STEP_TYPE_LABEL[step.type],
                step.title,
                step.durationMin,
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label={C.upLabel(no)}
                disabled={busy || no === 1}
                onClick={onUp}
              >
                {C.up}
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={C.downLabel(no)}
                disabled={busy || last}
                onClick={onDown}
              >
                {C.down}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                aria-label={C.removeLabel(no)}
                disabled={busy}
                onClick={onRemove}
              >
                {C.remove}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {step.type === "test" && step.questions ? (
              <p className="text-sm text-muted-foreground">
                {C.testLine(step.questions.length, threshold)}
              </p>
            ) : null}
            {step.source ? (
              <p className="text-sm text-muted-foreground">
                {C.sourceSet(
                  providerLabels[step.source.provider],
                  step.source.embedRef,
                )}
              </p>
            ) : null}
            {step.media ? (
              <p className="text-sm text-muted-foreground">
                {C.fileSet(step.media.contentType, step.media.sizeBytes)}
              </p>
            ) : null}
            <StepSourceForm
              step={step}
              busy={busy}
              providerLabels={providerLabels}
              onSave={onSource}
            />
            <StepFileForm step={step} busy={busy} onUpload={onUpload} />
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
