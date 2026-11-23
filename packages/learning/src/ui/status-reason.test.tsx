// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningCoursePath, LearningLessonRead, LearningStatusReason, LearningStepRead } from "@ds/schemas";

import { CoursePath } from "./course-path";
import { LEARNING_UI_COPY, lockReasonText, statusReasonText } from "./learning-ui-copy";
import { buildPathView } from "./path-view";
import { StepScreen } from "./step-screen";
import { CONFIG, ID, coursePath, lessonRead, stubFetch, stubMatchMedia, videoStep } from "./__tests__/fixtures";

// 024 EARS-24 — the doctor sees why a lesson's status changed under them: a rule
// change on the published course (EARS-31) reopened a lesson they had finished.
// Canvas state `причина = правило изменилось` of `design-source/doctor-course.dc.html`
// and `design-source/doctor-lesson.dc.html`: the reopened node's line «Условия
// урока изменились», an info Alert in the node summary and on the lesson —
// what changed, then what to do now — and the course progress without that lesson.
// The doctor's next completion clears the reason (the read carries none).

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const S1_TEST = "00000000-0000-4000-8000-000000000105";
const TITLE = "Условия урока изменились";
const BODY =
  "Теперь для зачёта нужно набрать в тесте 80 % вместо 70 %. Пройдите тест ещё раз — остальные шаги урока засчитаны.";

const reason = (over: Partial<LearningStatusReason> = {}): LearningStatusReason => ({
  ruleChangeId: "00000000-0000-4000-8000-000000000901",
  at: "2026-11-20T09:00:00.000Z",
  scope: { kind: "course", id: ID.course },
  changed: [{ key: "test.threshold", before: 70, after: 80 }],
  needed: { status: "open", completionSentence: "Урок пройден, когда пройдены все шаги." },
  ...over,
});

/** Lesson 1 was done; the raised threshold reopened its test, its video stays done. */
function reopenedPath(withReason = true): LearningCoursePath {
  const path = coursePath();
  const mod = path.modules[0]!;
  const l1 = mod.lessons[0]!;
  mod.lessons[0] = {
    ...l1,
    stepCount: 2,
    state: { status: withReason ? "open" : "done" },
    ...(withReason ? { statusReason: reason() } : {}),
    steps: [
      l1.steps[0]!,
      {
        id: S1_TEST,
        type: "test",
        title: "Тест по уроку 1",
        durationMin: 10,
        test: { questionCount: 10, threshold: 80 },
        file: null,
        state: { status: withReason ? "open" : "done" },
      },
    ],
  };
  return path;
}

function reopenedLesson(withReason = true): LearningLessonRead {
  return lessonRead({
    lesson: {
      ...lessonRead().lesson,
      id: ID.l1,
      number: 1,
      title: "Анамнез",
      stepCount: 2,
      state: { status: withReason ? "open" : "done" },
      ...(withReason ? { statusReason: reason() } : {}),
      firstStepId: ID.s1,
    },
    steps: [
      { id: ID.s1, type: "video", title: "Сбор анамнеза", durationMin: 12, test: null, file: null, state: { status: "done" }, completionSentence: "Досмотрите видео до конца." },
      { id: S1_TEST, type: "test", title: "Тест по уроку 1", durationMin: 10, test: { questionCount: 1, threshold: 80 }, file: null, state: { status: withReason ? "open" : "done" }, completionSentence: "Сдайте тест на 80 % и выше." },
    ],
  });
}

describe("024 EARS-24 — the status reason in the doctor's words", () => {
  it("EARS-24: the sentence names the setting before → after, then what the doctor does now", () => {
    expect(statusReasonText(reason(), reopenedLesson().steps)).toEqual({ title: TITLE, body: BODY });
  });

  it("EARS-24: a setting set for the first time on the scope names only its new value; a change with no doctor-facing setting still says what to do", () => {
    expect(
      statusReasonText(reason({ changed: [{ key: "test.threshold", before: null, after: 90 }] }), reopenedLesson().steps).body,
    ).toBe("Теперь для зачёта нужно набрать в тесте 90 %. Пройдите тест ещё раз — остальные шаги урока засчитаны.");
    expect(
      statusReasonText(reason({ changed: [{ key: "completion.lesson", before: null, after: { condition: "all-steps-done" } }] }), reopenedLesson().steps).body,
    ).toBe("Изменились правила зачёта урока. Пройдите тест ещё раз — остальные шаги урока засчитаны.");
  });

  it("EARS-24: a change that completes the lesson says so, and no text names money", () => {
    const done = reopenedLesson(false).steps;
    const text = statusReasonText(
      reason({ changed: [{ key: "test.threshold", before: 80, after: 60 }], needed: { status: "done", completionSentence: "" } }),
      done,
    );
    expect(text.body).toBe("Теперь для зачёта нужно набрать в тесте 60 % вместо 80 %. Урок засчитан — проходить его заново не нужно.");
    expect(`${text.title} ${text.body} ${BODY}`).not.toMatch(/бесплатн|оплат|деньг|руб/i);
  });

  it("EARS-24: a change that locks the lesson names what opens it — the first locked step's condition", () => {
    const locked = [
      { type: "video" as const, state: { status: "locked" as const, reason: { kind: "date" as const, at: "2026-12-01T09:00:00.000Z" } } },
      { type: "test" as const, state: { status: "locked" as const, reason: { kind: "previous" as const } } },
    ];
    const text = statusReasonText(reason({ needed: { status: "locked", completionSentence: "" } }), locked);
    expect(text.body).toBe(`Теперь для зачёта нужно набрать в тесте 80 % вместо 70 %. ${lockReasonText(locked[0]!.state.reason)}`);
    expect(text.body).not.toContain("условия курса");
  });

  it("EARS-24: a lesson reachable only by test-out is not told to pass its steps again", () => {
    const text = statusReasonText(
      reason({ needed: { status: "test-out-reachable", completionSentence: "" } }),
      reopenedLesson().steps,
    );
    expect(text.body).toBe("Теперь для зачёта нужно набрать в тесте 80 % вместо 70 %. Урок будет засчитан, когда вы сдадите тест.");
    expect(text.body).not.toMatch(/ещё раз/);
  });
});

describe("024 EARS-24 — the reopened lesson on the course path", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    stubFetch({ [`GET /v1/learning/lessons/${ID.l1}`]: reopenedLesson() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("EARS-24: the reopened step is open again with the line «Условия урока изменились»; the progress leaves that lesson out", () => {
    const view = buildPathView(reopenedPath());
    const testNode = view.sections[0]!.nodes.find((n) => n.id === S1_TEST)!;
    expect(testNode.tone).toBe("open");
    expect(testNode.lockNote).toBe(TITLE);
    expect(testNode.ruleChange).toEqual({ title: TITLE, body: BODY });
    // The done video of the lesson carries no reason line.
    expect(view.sections[0]!.nodes.find((n) => n.id === ID.s1)!.lockNote).toBeNull();
    expect(view.doneLessons).toBe(0);

    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={reopenedPath()} />);
    expect(screen.getByRole("button", { name: /Урок 1, шаг 2\. Тест\. Тест по уроку 1\. Открыт/ })).toBeInTheDocument();
    expect(screen.getByText(TITLE, { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByText("Пройдено 0 уроков из 3").length).toBeGreaterThan(0);
  });

  it("EARS-24: a lesson the change locked keeps its unlock condition on the path; its summary carries the reason", () => {
    const path = reopenedPath();
    const l2 = path.modules[0]!.lessons[1]!;
    const prev = { status: "locked", reason: { kind: "previous" } } as const;
    path.modules[0]!.lessons[1] = {
      ...l2,
      state: prev,
      statusReason: reason({ needed: { status: "locked", completionSentence: "" } }),
      steps: l2.steps.map((s) => ({ ...s, state: prev })),
    };
    const view = buildPathView(path);
    const nodes = view.sections[0]!.nodes;
    const first = nodes.find((n) => n.id === ID.s2)!;
    expect(first.lockNote).toBe(LEARNING_UI_COPY.lockNote);
    expect(first.ruleChange).toEqual({
      title: TITLE,
      body: "Теперь для зачёта нужно набрать в тесте 80 % вместо 70 %. Шаг откроется, когда будут пройдены предыдущие.",
    });
    expect(nodes.find((n) => n.id === ID.s3)!.lockNote).toBeNull();
  });

  it("EARS-24: the summary of the reopened node shows the reason Alert and the action to take the test", async () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={reopenedPath()} />);
    fireEvent.click(screen.getByRole("button", { name: /Урок 1, шаг 2\. Тест/ }));
    const summary = within(screen.getByTestId("node-summary"));
    const title = summary.getByText(TITLE);
    expect(title.tagName).toBe("B");
    const alert = title.closest('[role="status"]')!;
    expect(alert).toHaveTextContent(BODY);
    expect(summary.getByRole("link", { name: "Начать" })).toBeInTheDocument();
  });

  it("EARS-24: once the doctor completes the lesson again the read carries no reason — no line, no Alert", () => {
    const view = buildPathView(reopenedPath(false));
    expect(view.sections[0]!.nodes.every((n) => n.ruleChange === null)).toBe(true);
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={reopenedPath(false)} />);
    fireEvent.click(screen.getByRole("button", { name: /Урок 1, шаг 2\. Тест/ }));
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

describe("024 EARS-24 — the reason on the lesson", () => {
  afterEach(() => vi.unstubAllGlobals());

  const testStep = (): LearningStepRead =>
    videoStep({
      lessonId: ID.l1,
      step: {
        id: S1_TEST,
        type: "test",
        title: "Тест по уроку 1",
        durationMin: 10,
        test: { questionCount: 1, threshold: 80 },
        file: null,
        state: { status: "open" },
        completionSentence: "Сдайте тест на 80 % и выше.",
      },
      body: { type: "test", testId: ID.test, kind: "exit", questionCount: 1, threshold: 80, attemptsLeft: 2, lastResult: null },
      nextStepId: null,
    });

  it("EARS-24: the lesson shows the reason Alert above the step; it is gone after the passing attempt re-reads the lesson", async () => {
    stubFetch({
      [`POST /v1/me/learning/tests/${ID.test}/attempts`]: {
        attemptId: ID.attempt,
        testId: ID.test,
        questions: [{ id: ID.q1, text: "Нормальный интервал PQ?", options: [{ id: ID.o1, text: "120–200 мс" }, { id: ID.o2, text: "300 мс" }] }],
      },
      [`POST /v1/me/learning/attempts/${ID.attempt}/submit`]: {
        score: 100,
        threshold: 80,
        passed: true,
        attemptsLeft: 1,
        nextAt: null,
        changed: [S1_TEST, ID.l1],
      },
      [`GET /v1/learning/lessons/${ID.l1}`]: reopenedLesson(false),
      [`GET /v1/me/learning/steps/${S1_TEST}`]: testStep(),
    });
    render(<StepScreen courseSlug="kardio" config={CONFIG} lesson={reopenedLesson()} stepId={S1_TEST} step={testStep()} />);
    const title = screen.getByText(TITLE);
    expect(title.tagName).toBe("B");
    const alert = title.closest('[role="status"]')!;
    expect(alert).toHaveTextContent(BODY);

    fireEvent.click(screen.getByRole("button", { name: "Начать тест" }));
    fireEvent.click(await screen.findByRole("radio", { name: "120–200 мс" }));
    fireEvent.click(screen.getByRole("button", { name: "Ответить" }));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
  });

  it("EARS-24: the last attempt is stated against the new pass mark, not called failed", () => {
    const step = testStep();
    if (step.body.type === "test") step.body.lastResult = { score: 50, passed: false };
    render(<StepScreen courseSlug="kardio" config={CONFIG} lesson={reopenedLesson()} stepId={S1_TEST} step={step} />);
    expect(screen.getByText("Ваш результат 50 % — теперь нужно 80 %.")).toBeInTheDocument();
    expect(screen.queryByText(/не сдан/)).toBeNull();
  });

  it("EARS-24: a guest never sees a reason", () => {
    render(
      <StepScreen
        courseSlug="kardio"
        config={CONFIG}
        lesson={{ ...reopenedLesson(), signedIn: false }}
        stepId={S1_TEST}
        step={null}
      />,
    );
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
