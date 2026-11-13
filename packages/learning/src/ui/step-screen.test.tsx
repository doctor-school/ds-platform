// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningStepRead } from "@ds/schemas";

import { StepScreen } from "./step-screen";
import { CONFIG, ID, bodiesOf, lessonRead, stubFetch, videoStep } from "./__tests__/fixtures";

// 024 EARS-15…18, EARS-10 — the step screen of `design-source/doctor-lesson.dc.html`
// v18: the locked reason, the guest gate, the video clock as position facts, the
// download fact, the exit test pass and fail, the sentences from the read.

const FACTS = "POST /v1/me/learning/facts";
const START = `POST /v1/me/learning/tests/${ID.test}/attempts`;
const SUBMIT = `POST /v1/me/learning/attempts/${ID.attempt}/submit`;

const testStep = (attemptsLeft: number | null = 2): LearningStepRead =>
  videoStep({
    step: { id: ID.s4, type: "test", title: "Итоговый тест", durationMin: 10, state: { status: "open" }, completionSentence: "Сдайте тест на 70 % и выше." },
    body: { type: "test", testId: ID.test, kind: "exit", questionCount: 1, threshold: 70, attemptsLeft, lastResult: null },
    nextStepId: null,
  });

const ATTEMPT = {
  attemptId: ID.attempt,
  testId: ID.test,
  questions: [{ id: ID.q1, text: "Нормальный интервал PQ?", options: [{ id: ID.o1, text: "120–200 мс" }, { id: ID.o2, text: "300 мс" }] }],
};
const result = (passed: boolean, attemptsLeft: number | null) => ({
  score: passed ? 100 : 0,
  threshold: 70,
  passed,
  attemptsLeft,
  nextAt: null,
  changed: [],
});

const testLesson = () =>
  lessonRead({
    steps: [{ id: ID.s4, type: "test", title: "Итоговый тест", durationMin: 10, state: { status: "open" }, completionSentence: "Сдайте тест на 70 % и выше." }],
  });

function renderStep(step: LearningStepRead | null, stepId = step?.step.id ?? ID.s2, lesson = lessonRead()) {
  return render(<StepScreen courseSlug="kardio" config={CONFIG} lesson={lesson} stepId={stepId} step={step} />);
}

async function answerAndSubmit() {
  fireEvent.click(screen.getByRole("button", { name: "Начать тест" }));
  fireEvent.click(await screen.findByRole("radio", { name: "120–200 мс" }));
  fireEvent.click(screen.getByRole("button", { name: "Ответить" }));
}

describe("024 EARS-15…18 — the step screen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("EARS-15: a locked step shows only its reason in words, no body", () => {
    const lesson = lessonRead({
      steps: [
        ...lessonRead().steps.slice(0, 1),
        { id: ID.s3, type: "download", title: "Памятка по ЭКГ", durationMin: 5, state: { status: "locked", reason: { kind: "date", at: "2026-12-01T09:00:00.000Z" } }, completionSentence: "Откройте материал." },
      ],
    });
    renderStep(null, ID.s3, lesson);
    expect(screen.getByText("Шаг откроется 1 декабря.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Скачать" })).toBeNull();
  });

  it("EARS-15: a guest meets the registration gate that returns them to this step", () => {
    renderStep(null, ID.s2, lessonRead({ signedIn: false }));
    expect(screen.getByRole("link", { name: "Зарегистрироваться" })).toHaveAttribute(
      "href",
      `/register?returnTo=${encodeURIComponent(`/courses/kardio/steps/${ID.s2}`)}`,
    );
  });

  it("EARS-17: the step's and the lesson's completion sentences come from the read, «Дальше» leads to the next step", () => {
    stubFetch({});
    renderStep(videoStep());
    expect(screen.getByText("Досмотрите видео до конца.")).toBeInTheDocument();
    expect(screen.getByText("Урок пройден, когда пройдены все шаги.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Дальше" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s3}`);
  });

  it("EARS-16 / EARS-10: the video reports the provider player's own clock as position facts, every 10 s and at the end", async () => {
    const fetch = stubFetch({ [FACTS]: { outcome: "recorded", changed: [] } });
    renderStep(videoStep());
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    const iframe = screen.getByTestId("recording-player-rutube") as HTMLIFrameElement;
    const tick = (time: number) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://rutube.ru",
            data: JSON.stringify({ type: "player:currentTime", data: { time } }),
            source: iframe.contentWindow,
          }),
        );
      });
    tick(4);
    expect(bodiesOf(fetch, FACTS)).toHaveLength(0);
    tick(12.6);
    await waitFor(() => expect(screen.getAllByText("Просмотрено 10 %").length).toBeGreaterThan(0));
    tick(120);
    await waitFor(() => expect(screen.getAllByText("Просмотрено 100 %").length).toBeGreaterThan(0));
    const facts = bodiesOf(fetch, FACTS) as { kind: string; stepId: string; data: { positionSec: number } }[];
    expect(facts.map((f) => [f.kind, f.stepId, f.data.positionSec])).toEqual([
      ["position", ID.s2, 12],
      ["position", ID.s2, 120],
    ]);
  });

  it("EARS-16 / EARS-10: opening the download records the `opened` fact and marks the material opened", async () => {
    const fetch = stubFetch({ [FACTS]: { outcome: "recorded", changed: [] } });
    renderStep(
      videoStep({
        step: { id: ID.s3, type: "download", title: "Памятка по ЭКГ", durationMin: 5, state: { status: "open" }, completionSentence: "Откройте материал." },
        body: { type: "download", mediaUrl: "https://s3.example/signed", fileName: "ekg.pdf", fileSizeBytes: 2_621_440, opened: false },
        nextStepId: null,
      }),
    );
    expect(screen.getByText("2,5 МБ")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Скачать" });
    expect(link).toHaveAttribute("href", "https://s3.example/signed");
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(await screen.findByText("Материал открыт")).toBeInTheDocument();
    expect(bodiesOf(fetch, FACTS)).toEqual([expect.objectContaining({ kind: "opened", stepId: ID.s3 })]);
    expect(screen.getByRole("link", { name: "К пути курса" })).toHaveAttribute("href", "/courses/kardio");
  });

  it("EARS-18: the exit test passed at or above the threshold shows the score against the threshold and the lesson done", async () => {
    const fetch = stubFetch({ [START]: ATTEMPT, [SUBMIT]: result(true, 1) });
    renderStep(testStep(), ID.s4, testLesson());
    expect(screen.getByText("1 вопрос · порог 70 %")).toBeInTheDocument();
    await answerAndSubmit();
    expect(await screen.findByText("Тест сдан: 100 % при пороге 70 %")).toBeInTheDocument();
    expect(screen.getByText("Урок пройден")).toBeInTheDocument();
    expect(bodiesOf(fetch, SUBMIT)).toEqual([{ answers: [{ questionId: ID.q1, optionId: ID.o1 }] }]);
  });

  it("EARS-18: a fail below the threshold shows the score, the attempts left and a retry", async () => {
    stubFetch({ [START]: ATTEMPT, [SUBMIT]: result(false, 2) });
    renderStep(testStep(), ID.s4, testLesson());
    await answerAndSubmit();
    expect(await screen.findByText("Тест не сдан: 0 % при пороге 70 %. Пройденные шаги сохранены.")).toBeInTheDocument();
    expect(screen.getByText("Осталось попыток: 2.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить тест" })).toBeEnabled();
  });

  it("EARS-18: a fail with no attempts left disables the retry", async () => {
    stubFetch({ [START]: ATTEMPT, [SUBMIT]: result(false, 0) });
    renderStep(testStep(), ID.s4, testLesson());
    await answerAndSubmit();
    expect(await screen.findByText("Осталось попыток: 0.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить тест" })).toBeDisabled();
  });

  describe("EARS-15: the strip of the lesson's steps (doctor-lesson.dc.html v18)", () => {
    const stripLesson = () =>
      lessonRead({
        steps: [
          ...lessonRead().steps,
          { id: ID.s4, type: "test", title: "Итоговый тест", durationMin: 10, state: { status: "locked", reason: { kind: "previous" } }, completionSentence: "Сдайте тест." },
        ] as ReturnType<typeof lessonRead>["steps"],
      });
    const connectors = () => {
      const strip = screen.getByRole("list", { name: "Шаги урока" });
      return [...strip.querySelectorAll("li")].map((li) => [...li.querySelectorAll("[data-connector]")]);
    };

    it("EARS-15: joins the steps with a line — solid up to the reachable steps, dashed to a locked one, none past the ends", () => {
      renderStep(videoStep(), ID.s2, stripLesson());
      const [first, second, third] = connectors();
      expect(first![0]).toHaveAttribute("data-connector", "none");
      expect(first![1]).toHaveAttribute("data-connector", "reached");
      expect(second![0]).toHaveAttribute("data-connector", "reached");
      expect(second![1]).toHaveAttribute("data-connector", "ahead");
      expect(third![0]).toHaveAttribute("data-connector", "ahead");
      expect(third![1]).toHaveAttribute("data-connector", "none");
      for (const line of [first![1]!, second![0]!]) expect(line).toHaveClass("border-t-4", "border-solid", "border-primary-action");
      for (const line of [second![1]!, third![0]!]) expect(line).toHaveClass("border-t-4", "border-dashed", "border-muted-2");
      for (const end of [first![0]!, third![1]!]) expect(end).not.toHaveClass("border-t-4");
    });

    it("EARS-15: a step box is 2.75rem on a phone and 3.5rem from md, with the step type under it on desktop", () => {
      renderStep(videoStep(), ID.s2, stripLesson());
      const strip = screen.getByRole("list", { name: "Шаги урока" });
      const boxes = strip.querySelectorAll("[data-step-box]");
      expect(boxes).toHaveLength(3);
      for (const box of boxes) expect(box).toHaveClass("size-11", "md:size-14");
      const captions = [...strip.querySelectorAll("[data-step-caption]")];
      expect(captions.map((c) => c.textContent)).toEqual(["Серия", "Материал для скачивания", "Тест"]);
      for (const c of captions) expect(c).toHaveClass("hidden", "md:block");
    });
  });
});
