"use client";

import { useEffect, useRef, useState } from "react";
import type {
  LearningAttempt,
  LearningAttemptResult,
  LearningLessonRead,
  LearningStepRead,
} from "@ds/schemas";
import { Alert, Badge, Button, cn } from "@ds/design-system";
import { RecordingPlayer } from "@ds/event-page/recording-player";

import {
  LearningClientError,
  createLearningClient,
  newLearningEventId,
} from "../client/index";
import {
  type LearningHostConfig,
  coursePathHref,
  registerHref,
  stepHref,
} from "./host-config";
import { LEARNING_UI_COPY as C, lockReasonText } from "./learning-ui-copy";
import { StepIcon } from "./step-icon";

// 024 EARS-15, EARS-16, EARS-18 — one screen per step per
// `design-source/doctor-lesson.dc.html` v18: the lesson header, the strip of
// the lesson's steps with their states, the step body by type, the step's and
// the lesson's completion sentences (EARS-17, from the read), and «Дальше»
// WHEN the order allows the next step. A locked step shows its reason only.

/** How often a playing video reports its position (EARS-10; the server clamps). */
export const VIDEO_REPORT_INTERVAL_MS = 15_000;

export interface StepScreenProps {
  courseSlug: string;
  config: LearningHostConfig;
  lesson: LearningLessonRead;
  stepId: string;
  /** The step read; null for a guest or a locked step. */
  step: LearningStepRead | null;
}

const STRIP_TONE = {
  done: "bg-primary-action text-primary-foreground border-primary-action",
  here: "bg-tint text-tint-foreground border-border shadow-md",
  open: "bg-card text-tint-foreground border-primary",
  closed: "bg-muted text-muted-foreground border-hairline",
} as const;

export function StepScreen({ courseSlug, config, lesson, stepId, step }: StepScreenProps) {
  const l = lesson.lesson;
  const current = lesson.steps.find((s) => s.id === stepId) ?? null;
  const index = lesson.steps.findIndex((s) => s.id === stepId);
  const back = stepHref(config, courseSlug, stepId);

  return (
    <div className="bg-background pb-16 text-foreground">
      <section className="px-gutter pt-10">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <nav aria-label={C.here} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <a href={coursePathHref(config, courseSlug)} className="cursor-pointer text-muted-foreground no-underline hover:underline">
              {C.breadcrumbPath}
            </a>
            <span aria-hidden="true">›</span>
            <span className="font-semibold text-foreground">{C.lessonLabel(l.number)}</span>
          </nav>
          <div className="text-eyebrow font-extrabold uppercase tracking-eyebrow text-primary-action">
            {C.lessonEyebrow(l.number, l.stepCount, l.durationMin)}
          </div>
          <h1 className="m-0 text-panel-headline font-extrabold leading-display">{l.title}</h1>
        </div>
      </section>

      <section className="px-gutter pt-8">
        <div className="mx-auto max-w-4xl">
          <ol aria-label={C.stepsLabel} className="m-0 flex list-none items-start p-0">
            {lesson.steps.map((s, i) => {
              const here = s.id === stepId;
              const tone = here
                ? "here"
                : s.state.status === "done"
                  ? "done"
                  : s.state.status === "locked"
                    ? "closed"
                    : "open";
              const word = C.statusWord[here ? "current" : s.state.status];
              const label = `Шаг ${i + 1}. ${s.title}. ${word}`;
              const box = cn(
                "inline-flex size-12 flex-none items-center justify-center border-2 no-underline",
                STRIP_TONE[tone],
              );
              return (
                <li key={s.id} className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-2">
                  <div className="flex items-center self-stretch">
                    <span aria-hidden="true" className={cn("flex-1 border-t-4", i === 0 ? "border-transparent" : "border-primary-action")} />
                    {tone === "closed" ? (
                      <span role="img" aria-label={label} aria-disabled="true" className={box}>
                        <StepIcon kind={s.type} size={22} />
                      </span>
                    ) : (
                      <a
                        href={stepHref(config, courseSlug, s.id)}
                        aria-label={label}
                        aria-current={here ? "step" : undefined}
                        className={cn(box, "cursor-pointer hover:shadow-btn focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring")}
                      >
                        <StepIcon kind={s.type} size={22} />
                      </a>
                    )}
                    <span aria-hidden="true" className={cn("flex-1 border-t-4", i === lesson.steps.length - 1 ? "border-transparent" : "border-primary-action")} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="px-gutter pt-8">
        <div className="mx-auto max-w-4xl">
          {!lesson.signedIn ? (
            <GuestGate href={registerHref(config, back)} lesson={lesson} />
          ) : !current || current.state.status === "locked" || !step ? (
            <Alert variant="info">
              {current && current.state.status === "locked"
                ? lockReasonText(current.state.reason)
                : C.errorStep.title}
            </Alert>
          ) : (
            <article className="border-2 border-border bg-card shadow-lg">
              <header className="flex flex-col gap-2 border-b-2 border-border px-6 py-5">
                <div className="text-eyebrow font-extrabold uppercase tracking-eyebrow text-primary-action">
                  {C.stepKicker(index + 1, step.step.type, step.step.durationMin)}
                </div>
                <h2 className="m-0 text-xl font-extrabold leading-tight">{step.step.title}</h2>
              </header>
              <div className="flex flex-col gap-4 p-6">
                <StepBody step={step} />
              </div>
              <footer className="flex flex-wrap items-center gap-4 border-t-2 border-border px-6 py-4">
                <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                  <p className="m-0 text-caption font-semibold leading-prose text-muted-foreground">
                    {step.step.completionSentence}
                  </p>
                  <p className="m-0 text-caption font-semibold leading-prose text-muted-foreground">
                    {step.lessonCompletionSentence}
                  </p>
                </div>
                {step.nextStepId ? (
                  <Button asChild>
                    <a href={stepHref(config, courseSlug, step.nextStepId)}>{C.next}</a>
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <a href={coursePathHref(config, courseSlug)}>{C.toPath}</a>
                  </Button>
                )}
              </footer>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}

function GuestGate({ href, lesson }: { href: string; lesson: LearningLessonRead }) {
  return (
    <div className="flex flex-col gap-6">
      {lesson.lesson.description ? (
        <p className="m-0 text-lead leading-prose text-muted-foreground">{lesson.lesson.description}</p>
      ) : null}
      <div id="gate" className="flex flex-wrap items-center gap-x-6 gap-y-4 border-2 border-border bg-tint p-6 shadow-lg">
        <span aria-hidden="true" className="inline-flex flex-none text-tint-foreground">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square">
            <rect x="5" y="11" width="14" height="9" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <div className="min-w-0 flex-1 basis-60 text-base font-extrabold leading-snug text-tint-foreground">{C.gate}</div>
        <Button asChild>
          <a href={href}>{C.gateAction}</a>
        </Button>
      </div>
    </div>
  );
}

function StepBody({ step }: { step: LearningStepRead }) {
  switch (step.body.type) {
    case "video":
      return <VideoBody step={step} body={step.body} />;
    case "download":
      return <DownloadBody step={step} body={step.body} />;
    case "test":
      return <TestBody body={step.body} />;
  }
}

type Body<T extends LearningStepRead["body"]["type"]> = Extract<LearningStepRead["body"], { type: T }>;

/**
 * EARS-16 / EARS-10 — the 006 provider embed played exactly as a 014
 * recording (`RecordingPlayer`); the cross-origin frame exposes no universal
 * playback clock, so while the frame is shown and the page is visible the
 * screen reports the advancing position as a fact; the server clamps it to the
 * media length and to `progress.maxPlaybackRate` / `progress.slackSec`.
 */
function VideoBody({ step, body }: { step: LearningStepRead; body: Body<"video"> }) {
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(body.watchedPercent);
  const position = useRef(body.positionSec);

  useEffect(() => {
    if (!playing) return;
    const client = createLearningClient();
    let last = Date.now();
    const tick = async () => {
      const now = Date.now();
      if (document.visibilityState === "visible") {
        position.current = Math.min(body.durationSec, position.current + Math.round((now - last) / 1000));
      }
      last = now;
      try {
        await client.recordFact({
          eventId: newLearningEventId(step.step.id),
          stepId: step.step.id,
          source: "web",
          kind: "position",
          clientOccurredAt: new Date(now).toISOString(),
          data: { positionSec: position.current },
        });
        setWatched(Math.min(100, Math.floor((position.current / body.durationSec) * 100)));
      } catch {
        // A refused report changes nothing on screen; the next tick retries.
      }
    };
    const id = window.setInterval(() => void tick(), VIDEO_REPORT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, body.durationSec, step.step.id]);

  return (
    <div className="flex flex-col gap-3">
      {playing ? (
        <RecordingPlayer
          provider={body.provider}
          embedRef={body.embedRef}
          title={step.step.title}
          kindLabel={C.videoKind}
          unavailableTitle={C.videoUnavailable.title}
          unavailableBody={C.videoUnavailable.body}
          retryLabel={C.videoUnavailable.retry}
        />
      ) : (
        <div className="relative flex aspect-video items-center justify-center border-2 border-border bg-primary-surface text-primary-surface-foreground">
          <button
            type="button"
            aria-label={C.watch}
            onClick={() => setPlaying(true)}
            className="inline-flex size-16 cursor-pointer items-center justify-center border-2 border-border bg-background p-0 text-foreground shadow-btn transition-all hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-btn-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5l12 7-12 7z" />
            </svg>
          </button>
        </div>
      )}
      <div className="flex items-center gap-3 text-xs font-bold tabular-nums">
        <span role="img" aria-label={C.watched(watched)} className="h-1 flex-1 bg-muted">
          <span className="block h-full bg-primary-action" style={{ width: `${watched}%` }} />
        </span>
        <span>{C.watched(watched)}</span>
      </div>
    </div>
  );
}

/** EARS-16 — «Скачать»: the signed read; opening it records `opened` (EARS-10). */
function DownloadBody({ step, body }: { step: LearningStepRead; body: Body<"download"> }) {
  const [opened, setOpened] = useState(body.opened);
  const open = () => {
    void createLearningClient()
      .recordFact({
        eventId: newLearningEventId(step.step.id),
        stepId: step.step.id,
        source: "web",
        kind: "opened",
        clientOccurredAt: new Date().toISOString(),
        data: {},
      })
      .then(() => setOpened(true))
      .catch(() => undefined);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4 border-2 border-border bg-section p-6">
      <span aria-hidden="true" className="inline-flex flex-none text-foreground">
        <StepIcon kind="download" size={40} />
      </span>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <span className="text-base font-extrabold">{body.fileName}</span>
        <span className="text-sm font-semibold text-muted-foreground">{C.fileMeta(body.fileSizeBytes)}</span>
        {opened ? <Badge variant="success">{C.opened}</Badge> : null}
      </div>
      <Button asChild>
        <a href={body.mediaUrl} target="_blank" rel="noopener noreferrer" download={body.fileName} onClick={open}>
          {C.download}
        </a>
      </Button>
    </div>
  );
}

/** EARS-18 — the exit test: start (an open attempt comes back), one question at a time, submit, the result against the threshold. */
function TestBody({ body }: { body: Body<"test"> }) {
  const [attempt, setAttempt] = useState<LearningAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [q, setQ] = useState(0);
  const [result, setResult] = useState<LearningAttemptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setAttempt(await createLearningClient().startAttempt(body.testId));
      setAnswers({});
      setQ(0);
      setResult(null);
    } catch (e) {
      setError(
        e instanceof LearningClientError && e.code === "LEARNING_ATTEMPT_UNAVAILABLE"
          ? C.unavailableTest
          : C.actionFailed,
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = async (all: Record<string, string>) => {
    if (!attempt) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createLearningClient().submitAttempt(attempt.attemptId, {
        answers: Object.entries(all).map(([questionId, optionId]) => ({ questionId, optionId })),
      });
      setResult(r);
      setAttempt(null);
    } catch {
      setError(C.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return result.passed ? (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-2 border-success bg-success-tint px-6 py-4">
        <Badge variant="success">{C.lessonDone}</Badge>
        <span className="min-w-0 flex-1 basis-48 text-base font-extrabold">{C.passed(result.score, result.threshold)}</span>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        <Alert variant="warn">{C.failed(result.score, result.threshold)}</Alert>
        <p className="m-0 text-sm font-semibold leading-prose text-muted-foreground">
          {[C.attemptsLeft(result.attemptsLeft), result.nextAt ? C.nextAttemptAt(result.nextAt) : ""].filter(Boolean).join(" ")}
        </p>
        <div>
          <Button variant="outline" disabled={busy || result.attemptsLeft === 0} onClick={() => void start()}>
            {C.retryTest}
          </Button>
        </div>
      </div>
    );
  }

  if (!attempt) {
    return (
      <div className="flex flex-col gap-4">
        <p className="m-0 text-base font-semibold">{C.testIntro(body.questionCount, body.threshold)}</p>
        {body.lastResult ? (
          <p className="m-0 text-sm font-semibold text-muted-foreground">
            {body.lastResult.passed ? C.passed(body.lastResult.score, body.threshold) : C.failed(body.lastResult.score, body.threshold)}
          </p>
        ) : null}
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <div>
          <Button disabled={busy || body.attemptsLeft === 0} onClick={() => void start()}>
            {C.startTest}
          </Button>
        </div>
      </div>
    );
  }

  const question = attempt.questions[q];
  if (!question) return null;
  const chosen = answers[question.id] ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm font-bold tabular-nums text-faint">{C.question(q + 1, attempt.questions.length)}</div>
      <div className="text-lg font-extrabold leading-snug">{question.text}</div>
      <div role="group" aria-label={C.optionsLabel} className="flex flex-col gap-2">
        {question.options.map((o) => {
          const on = chosen === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => setAnswers((a) => ({ ...a, [question.id]: o.id }))}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 border-2 px-4 py-3 text-left text-base font-semibold transition-colors hover:border-primary hover:bg-tint focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring",
                on ? "border-primary bg-tint text-tint-foreground" : "border-border bg-card text-foreground",
              )}
            >
              <span aria-hidden="true" className={cn("size-4 flex-none border-2", on ? "border-primary bg-primary-action" : "border-border bg-card")} />
              <span>{o.text}</span>
            </button>
          );
        })}
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <div>
        <Button
          disabled={!chosen || busy}
          onClick={() => {
            if (q + 1 < attempt.questions.length) setQ(q + 1);
            else void submit(answers);
          }}
        >
          {C.answer}
        </Button>
      </div>
    </div>
  );
}
