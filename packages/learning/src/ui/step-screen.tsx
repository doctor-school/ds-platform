"use client";

import NextLink from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  LearningAttempt,
  LearningAttemptResult,
  LearningLessonRead,
  LearningStepRead,
} from "@ds/schemas";
import { Alert, Badge, Button, Link, Radio, cn } from "@ds/design-system";
import { PointsPlate, type PointsPlateBalances } from "@ds/design-system/blocks";
import { RecordingPlayer } from "@ds/event-page/recording-player";

import {
  LearningClientError,
  createLearningClient,
  newLearningEventId,
  pointsPlateBalances,
} from "../client/index";
import { VIDEO_END_WINDOW_SEC } from "../catalog/video-end-window";
import {
  type LearningHostConfig,
  coursePathHref,
  registerHref,
  stepHref,
} from "./host-config";
import { LEARNING_UI_COPY as C, STEP_TYPE_LABEL, lockReasonText } from "./learning-ui-copy";
import { StepIcon } from "./step-icon";

// 024 EARS-15, EARS-16, EARS-18 — one screen per step per
// `design-source/doctor-lesson.dc.html` v18: the lesson header, the strip of
// the lesson's steps with their states, the step body by type, the step's and
// the lesson's completion sentences (EARS-17, from the read), and «Дальше»
// WHEN the order allows the next step. A locked step shows its reason only.

/**
 * How much provider playback time passes between two position facts (EARS-10);
 * the end of the media is always reported, so 100 % (D15) is reachable.
 */
export const VIDEO_REPORT_EVERY_SEC = 10;

/**
 * A refused position fact is retried after this wall time, doubling up to
 * {@link REPORT_RETRY_MAX_MS} and back to the start on an accepted one — an API
 * outage meets a bounded trickle of reports, not one per player tick.
 */
export const REPORT_RETRY_FIRST_MS = 10_000;
export const REPORT_RETRY_MAX_MS = 60_000;

export interface StepScreenProps {
  courseSlug: string;
  config: LearningHostConfig;
  lesson: LearningLessonRead;
  stepId: string;
  /** The step read; null for a guest or a locked step. */
  step: LearningStepRead | null;
  /** The 025 balances for the plate (024 design §8); see `CoursePath`. */
  points?: PointsPlateBalances | null;
}

const STRIP_TONE = {
  done: "bg-primary-action text-primary-foreground border-primary-action",
  here: "bg-tint text-tint-foreground border-border shadow-md",
  open: "bg-card text-tint-foreground border-primary",
  closed: "bg-muted text-muted-foreground border-hairline",
} as const;

type Connector = "none" | "reached" | "ahead";

function StripLine({ kind }: { kind: Connector }) {
  return (
    <span
      aria-hidden="true"
      data-connector={kind}
      className={cn(
        "h-0 min-w-1 flex-1 basis-0",
        kind === "reached" && "border-t-4 border-solid border-primary-action",
        kind === "ahead" && "border-t-4 border-dashed border-muted-2",
      )}
    />
  );
}

const noSubscribe = () => () => undefined;

/**
 * False in the server render and until hydration, true after: an action whose
 * handler is client-only is disabled until it can run, so a click before
 * hydration is not swallowed by a button with no handler attached yet.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** Called after a fact or a submitted attempt that the server says changed a status. */
type OnChanged = (changed: readonly unknown[]) => void;

export function StepScreen({ courseSlug, config, stepId, ...initial }: StepScreenProps) {
  // EARS-15 / EARS-17 — the screen shows the evaluated state: a fact or an
  // attempt that changes a status (the response's `changed`) re-reads the
  // lesson (the strip), the step («Дальше», the sentences) and the plate in
  // place; the step body keeps its own state (the player keeps playing). A
  // failed re-read keeps what is on screen.
  const [lesson, setLesson] = useState(initial.lesson);
  const [step, setStep] = useState(initial.step);
  const [points, setPoints] = useState(initial.points);
  const lessonId = initial.lesson.lesson.id;
  const hasPlate = initial.points != null;
  const onChanged = useCallback<OnChanged>(
    (changed) => {
      if (changed.length === 0) return;
      const client = createLearningClient();
      void Promise.all([client.lesson(lessonId), client.step(stepId)])
        .then(([l, s]) => {
          setLesson(l);
          setStep(s);
        })
        .catch(() => undefined);
      if (hasPlate)
        void client
          .myPoints()
          .then((a) => setPoints(pointsPlateBalances(a)))
          .catch(() => undefined);
    },
    [lessonId, stepId, hasPlate],
  );
  const l = lesson.lesson;
  const current = lesson.steps.find((s) => s.id === stepId) ?? null;
  const index = lesson.steps.findIndex((s) => s.id === stepId);
  const back = stepHref(config, courseSlug, stepId);

  return (
    <div className="bg-background pb-16 text-foreground">
      <section className="px-gutter pt-10">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <nav aria-label={C.here} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link href={coursePathHref(config, courseSlug)} size="sm" tone="neutral" weight="semibold">
              {C.breadcrumbPath}
            </Link>
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
              // Exactly one «Вы здесь»: the step on screen (canvas v18). The
              // evaluated current step elsewhere in the strip is reachable — «Открыт».
              const word = here
                ? C.statusWord.current
                : C.statusWord[s.state.status === "current" ? "open" : s.state.status];
              const label = `Шаг ${i + 1}. ${s.title}. ${word}`;
              const box = cn(
                "inline-flex size-11 flex-none items-center justify-center border-2 no-underline md:size-14",
                STRIP_TONE[tone],
              );
              // The line into a step is solid once that step is reachable, dashed
              // while it is locked; nothing past either end (canvas v18).
              const into = (j: number): Connector =>
                j < 0 || j >= lesson.steps.length
                  ? "none"
                  : lesson.steps[j]!.state.status === "locked"
                    ? "ahead"
                    : "reached";
              return (
                <li key={s.id} className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-2">
                  <div className="flex items-center self-stretch">
                    <StripLine kind={i === 0 ? "none" : into(i)} />
                    {tone === "closed" ? (
                      <span data-step-box role="img" aria-label={label} aria-disabled="true" className={box}>
                        <StepIcon kind={s.type} size={22} />
                      </span>
                    ) : (
                      <Link
                        variant="wrapper"
                        className="flex-none"
                        href={stepHref(config, courseSlug, s.id)}
                        aria-label={label}
                        aria-current={here ? "step" : undefined}
                      >
                        <span data-step-box className={cn(box, "[a:hover>&]:shadow-btn")}>
                          <StepIcon kind={s.type} size={22} />
                        </span>
                      </Link>
                    )}
                    <StripLine kind={into(i + 1)} />
                  </div>
                  <span
                    data-step-caption
                    className={cn(
                      "hidden max-w-full px-1 text-center text-xs leading-tight md:block",
                      here ? "font-extrabold" : "font-semibold",
                      tone === "closed" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {STEP_TYPE_LABEL[s.type]}
                  </span>
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
                <StepBody step={step} onChanged={onChanged} />
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
                {/* The move to the next step or the path is the host's router
                    navigation: the doctor app stays loaded (no full page load). */}
                {step.nextStepId ? (
                  <Button asChild>
                    <NextLink href={stepHref(config, courseSlug, step.nextStepId)}>{C.next}</NextLink>
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <NextLink href={coursePathHref(config, courseSlug)}>{C.toPath}</NextLink>
                  </Button>
                )}
              </footer>
            </article>
          )}
        </div>
      </section>

      {points !== undefined ? (
        <section className="px-gutter pt-section">
          <div className="mx-auto max-w-4xl">
            <PointsPlate balances={points} />
          </div>
        </section>
      ) : null}
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

function StepBody({ step, onChanged }: { step: LearningStepRead; onChanged: OnChanged }) {
  switch (step.body.type) {
    case "video":
      return <VideoBody step={step} body={step.body} onChanged={onChanged} />;
    case "download":
      return <DownloadBody step={step} body={step.body} onChanged={onChanged} />;
    case "test":
      return <TestBody body={step.body} onChanged={onChanged} />;
  }
}

type Body<T extends LearningStepRead["body"]["type"]> = Extract<LearningStepRead["body"], { type: T }>;

/**
 * EARS-16 / EARS-10 — the 006 provider embed played exactly as a 014
 * recording (`RecordingPlayer`); the position reported is the provider
 * player's own clock (`onClock`), every {@link VIDEO_REPORT_EVERY_SEC} s of
 * playback and at the end; the server clamps it to the media length and to
 * `progress.maxPlaybackRate` / `progress.slackSec`. A provider with no clock
 * (cdnvideo, #4055) plays but reports nothing.
 */
function VideoBody({
  step,
  body,
  onChanged,
}: {
  step: LearningStepRead;
  body: Body<"video">;
  onChanged: OnChanged;
}) {
  const hydrated = useHydrated();
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(body.watchedPercent);
  // The player position last attempted. The cadence is measured on the
  // player's own clock, never on the server's clamped answer: after a forward
  // seek that answer stays below the clock, and measuring from it would send on
  // every tick. A refused attempt does not reset it either.
  const sent = useRef(body.positionSec);
  // The newest position the player reported: what a retry sends.
  const latest = useRef(body.positionSec);
  const sending = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(REPORT_RETRY_FIRST_MS);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
    };
  }, []);

  // A report is due when the clock moved VIDEO_REPORT_EVERY_SEC since the last
  // attempt (a seek back included), or the end was reached past it. A
  // completion the server allows only later is not polled for: a replay
  // reports it again.
  const due = useCallback(
    (position: number) =>
      Math.abs(position - sent.current) >= VIDEO_REPORT_EVERY_SEC ||
      (position >= body.durationSec - VIDEO_END_WINDOW_SEC && position > sent.current),
    [body.durationSec],
  );

  const report = useCallback(
    (first: number) => {
      const attempt = (positionSec: number) => {
        if (retry.current) clearTimeout(retry.current);
        retry.current = null;
        sent.current = positionSec;
        sending.current = true;
        createLearningClient()
          .recordFact({
            eventId: newLearningEventId(step.step.id),
            stepId: step.step.id,
            source: "web",
            kind: "position",
            clientOccurredAt: new Date().toISOString(),
            data: { positionSec },
          })
          // The bar shows what the server accepted after its clamp.
          .then((res) => {
            backoff.current = REPORT_RETRY_FIRST_MS;
            onChanged(res.changed);
            if (res.progress) setWatched(res.progress.watchedPercent);
          })
          // A failed report changes nothing on screen. A network error, a 5xx
          // or a 429 retries the newest position after the backoff, so the end
          // still goes out once the API is back with the player stopped; a
          // tick report meanwhile replaces it. Any other refusal (401/403/422…)
          // is final for that position: retrying it cannot change the answer.
          .catch((e: unknown) => {
            if (!alive.current) return;
            const transient =
              !(e instanceof LearningClientError) || e.status >= 500 || e.status === 429;
            if (!transient) return;
            const wait = backoff.current;
            backoff.current = Math.min(wait * 2, REPORT_RETRY_MAX_MS);
            retry.current = setTimeout(() => {
              retry.current = null;
              if (alive.current && !sending.current) attempt(latest.current);
            }, wait);
          })
          // A position the player reached while this report was in flight
          // (the end, with the player then stopped) goes out now — no tick
          // may come to carry it.
          .finally(() => {
            sending.current = false;
            if (alive.current && !retry.current && due(latest.current)) attempt(latest.current);
          });
      };
      attempt(first);
    },
    [step.step.id, onChanged, due],
  );

  const onClock = useCallback(
    (sec: number) => {
      const position = Math.min(Math.floor(sec), body.durationSec);
      const atEnd = position >= body.durationSec - VIDEO_END_WINDOW_SEC;
      latest.current = atEnd ? body.durationSec : position;
      if (sending.current || !due(position)) return;
      report(latest.current);
    },
    [body.durationSec, report, due],
  );

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
          onClock={onClock}
          // EARS-16 — the tap that mounted the player is the doctor's intent to
          // watch: it starts playing, no second tap on the provider's button.
          autoplay
        />
      ) : (
        <div className="relative flex aspect-video items-center justify-center border-2 border-border bg-primary-surface text-primary-surface-foreground">
          <Button size="lg" disabled={!hydrated} onClick={() => setPlaying(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5l12 7-12 7z" />
            </svg>
            {C.watch}
          </Button>
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
function DownloadBody({
  step,
  body,
  onChanged,
}: {
  step: LearningStepRead;
  body: Body<"download">;
  onChanged: OnChanged;
}) {
  const hydrated = useHydrated();
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
      .then((res) => {
        setOpened(true);
        onChanged(res.changed);
      })
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
      {hydrated ? (
        <Button asChild>
          <a href={body.mediaUrl} target="_blank" rel="noopener noreferrer" download={body.fileName} onClick={open}>
            {C.download}
          </a>
        </Button>
      ) : (
        // Before hydration the link would open the file without recording `opened`.
        <Button disabled>{C.download}</Button>
      )}
    </div>
  );
}

/** EARS-18 — the exit test: start (an open attempt comes back), one question at a time, submit, the result against the threshold. */
function TestBody({ body, onChanged }: { body: Body<"test">; onChanged: OnChanged }) {
  const hydrated = useHydrated();
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
      onChanged(r.changed);
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
          <Button disabled={!hydrated || busy || body.attemptsLeft === 0} onClick={() => void start()}>
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
      <div role="radiogroup" aria-label={C.optionsLabel} className="flex flex-col gap-2">
        {question.options.map((o) => {
          const on = chosen === o.id;
          return (
            <div
              key={o.id}
              className={cn(
                "flex border-2 px-4 py-3 transition-colors",
                on ? "border-primary bg-tint" : "border-border bg-card",
              )}
            >
              <Radio
                name={`question-${question.id}`}
                value={o.id}
                checked={on}
                onChange={() => setAnswers((a) => ({ ...a, [question.id]: o.id }))}
              >
                {o.text}
              </Radio>
            </div>
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
