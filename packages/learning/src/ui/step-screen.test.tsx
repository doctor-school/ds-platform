// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningStepRead } from "@ds/schemas";

import { REPORT_RETRY_FIRST_MS, REPORT_RETRY_MAX_MS, StepScreen } from "./step-screen";
import {
  CONFIG,
  ID,
  bodiesOf,
  lessonRead,
  stubFetch,
  videoStep,
} from "./__tests__/fixtures";

// 024 EARS-15…18, EARS-10 — the step screen of `design-source/doctor-lesson.dc.html`
// v18: the locked reason, the guest gate, the video clock as position facts, the
// download fact, the exit test pass and fail, the sentences from the read.

// `next/link` wants the App-Router context this tier does not mount; the marker
// shows which links go through the host's router (a client-side move, EARS-15).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a data-router-link="" href={href} {...rest}>
      {children}
    </a>
  ),
}));

const FACTS = "POST /v1/me/learning/facts";
const START = `POST /v1/me/learning/tests/${ID.test}/attempts`;
const SUBMIT = `POST /v1/me/learning/attempts/${ID.attempt}/submit`;

const testStep = (attemptsLeft: number | null = 2): LearningStepRead =>
  videoStep({
    step: {
      id: ID.s4,
      type: "test",
      title: "Итоговый тест",
      durationMin: 10, test: { questionCount: 1, threshold: 70 }, file: null,
      state: { status: "open" },
      completionSentence: "Сдайте тест на 70 % и выше.",
    },
    body: {
      type: "test",
      testId: ID.test,
      kind: "exit",
      questionCount: 1,
      threshold: 70,
      attemptsLeft,
      lastResult: null,
    },
    nextStepId: null,
  });

const ATTEMPT = {
  attemptId: ID.attempt,
  testId: ID.test,
  questions: [
    {
      id: ID.q1,
      text: "Нормальный интервал PQ?",
      options: [
        { id: ID.o1, text: "120–200 мс" },
        { id: ID.o2, text: "300 мс" },
      ],
    },
  ],
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
    steps: [
      {
        id: ID.s4,
        type: "test",
        title: "Итоговый тест",
        durationMin: 10, test: { questionCount: 10, threshold: 80 }, file: null,
        state: { status: "open" },
        completionSentence: "Сдайте тест на 70 % и выше.",
      },
    ],
  });

function renderStep(
  step: LearningStepRead | null,
  stepId = step?.step.id ?? ID.s2,
  lesson = lessonRead(),
) {
  return render(
    <StepScreen
      courseSlug="kardio"
      config={CONFIG}
      lesson={lesson}
      stepId={stepId}
      step={step}
    />,
  );
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
        {
          id: ID.s3,
          type: "download",
          title: "Памятка по ЭКГ",
          durationMin: 5, test: null, file: { format: "PDF", sizeBytes: 1_258_291 },
          state: {
            status: "locked",
            reason: { kind: "date", at: "2026-12-01T09:00:00.000Z" },
          },
          completionSentence: "Откройте материал.",
        },
      ],
    });
    renderStep(null, ID.s3, lesson);
    expect(screen.getByText("Шаг откроется 1 декабря.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Скачать" })).toBeNull();
  });

  it("EARS-15: the step kicker reads as the canvas — «Шаг N из M · type · meta»", () => {
    const view = renderStep(videoStep());
    expect(screen.getByText("Шаг 1 из 2 · Серия · видео · 15 минут")).toBeInTheDocument();
    view.unmount();
    const lesson = lessonRead({ steps: [...lessonRead().steps, { ...testStep().step }] });
    renderStep(testStep(), ID.s4, lesson);
    expect(screen.getByText("Шаг 3 из 3 · Тест · 1 вопрос · порог 70 %")).toBeInTheDocument();
  });

  it("EARS-15: a guest meets the registration gate that returns them to this step", () => {
    renderStep(null, ID.s2, lessonRead({ signedIn: false }));
    expect(
      screen.getByRole("link", { name: "Зарегистрироваться" }),
    ).toHaveAttribute(
      "href",
      `/register?returnTo=${encodeURIComponent(`/courses/kardio/steps/${ID.s2}`)}`,
    );
  });

  it("EARS-17: the step's and the lesson's completion sentences come from the read, «Дальше» leads to the next step", () => {
    stubFetch({});
    renderStep(videoStep());
    expect(screen.getByText("Досмотрите видео до конца.")).toBeInTheDocument();
    expect(
      screen.getByText("Урок пройден, когда пройдены все шаги."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Дальше" })).toHaveAttribute(
      "href",
      `/courses/kardio/steps/${ID.s3}`,
    );
  });

  it("EARS-15: «Дальше» and «К пути» move through the host's router, not a full page load", () => {
    stubFetch({});
    renderStep(videoStep());
    expect(screen.getByRole("link", { name: "Дальше" })).toHaveAttribute("data-router-link");
    renderStep(videoStep({ nextStepId: null }));
    expect(screen.getByRole("link", { name: "К пути курса" })).toHaveAttribute("data-router-link");
  });

  it("EARS-16/10: the video reports the provider player's own clock as position facts, every 10 s and at the end", async () => {
    const answers = [
      { positionSec: 12, watchedPercent: 10 },
      { positionSec: 120, watchedPercent: 100 },
    ];
    const fetch = stubFetch({
      [FACTS]: () => ({
        outcome: "recorded",
        changed: [],
        progress: answers.shift(),
      }),
    });
    renderStep(videoStep());
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    const iframe = screen.getByTestId(
      "recording-player-rutube",
    ) as HTMLIFrameElement;
    const tick = (time: number) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://rutube.ru",
            data: JSON.stringify({
              type: "player:currentTime",
              data: { time },
            }),
            source: iframe.contentWindow,
          }),
        );
      });
    tick(4);
    expect(bodiesOf(fetch, FACTS)).toHaveLength(0);
    tick(12.6);
    await waitFor(() =>
      expect(screen.getAllByText("Просмотрено 10 %").length).toBeGreaterThan(0),
    );
    tick(120);
    await waitFor(() =>
      expect(screen.getAllByText("Просмотрено 100 %").length).toBeGreaterThan(
        0,
      ),
    );
    const facts = bodiesOf(fetch, FACTS) as {
      kind: string;
      stepId: string;
      data: { positionSec: number };
    }[];
    expect(facts.map((f) => [f.kind, f.stepId, f.data.positionSec])).toEqual([
      ["position", ID.s2, 12],
      ["position", ID.s2, 120],
    ]);
  });

  it("EARS-10: a media shorter than the typed length is watched to its own end — the provider's length and «ended» go out with the end (#4060)", async () => {
    const fetch = stubFetch({
      [FACTS]: () => ({ outcome: "recorded", changed: [], progress: { positionSec: 90, watchedPercent: 100 } }),
    });
    renderStep(videoStep());
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    const iframe = screen.getByTestId("recording-player-rutube") as HTMLIFrameElement;
    const post = (message: unknown) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://rutube.ru",
            data: JSON.stringify(message),
            source: iframe.contentWindow,
          }),
        );
      });
    // The typed length is 120 s; the player says the media is 90.4 s.
    post({ type: "player:durationChange", data: { duration: 90.4 } });
    post({ type: "player:currentTime", data: { time: 85 } });
    // The last tick falls short of the end window; the player then ends.
    post({ type: "player:playComplete", data: {} });
    await waitFor(() => expect(bodiesOf(fetch, FACTS)).toHaveLength(2));
    const facts = bodiesOf(fetch, FACTS) as { data: { positionSec: number; mediaDurationSec?: number } }[];
    expect(facts.map((f) => f.data)).toEqual([
      { positionSec: 85, mediaDurationSec: 90 },
      { positionSec: 90, mediaDurationSec: 90 },
    ]);
  });

  it("EARS-16: one tap on «Смотреть видео» mounts the player already playing — no second tap on the provider's play", () => {
    renderStep(videoStep());
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    expect(screen.getByTestId("recording-player-rutube").getAttribute("src")).toMatch(/[?&]autoplay=true(&|$)/);
  });

  it("EARS-10: the watched bar shows what the server accepted after its clamp, and reporting goes on from there", async () => {
    const answers = [
      { positionSec: 40, watchedPercent: 33 },
      { positionSec: 52, watchedPercent: 43 },
    ];
    const fetch = stubFetch({
      [FACTS]: () => ({
        outcome: "recorded",
        changed: [],
        progress: answers.shift(),
      }),
    });
    renderStep(videoStep());
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    const iframe = screen.getByTestId(
      "recording-player-rutube",
    ) as HTMLIFrameElement;
    const tick = (time: number) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://rutube.ru",
            data: JSON.stringify({
              type: "player:currentTime",
              data: { time },
            }),
            source: iframe.contentWindow,
          }),
        );
      });
    tick(120);
    await waitFor(() =>
      expect(screen.getAllByText("Просмотрено 33 %").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Просмотрено 100 %")).toBeNull();
    tick(52);
    await waitFor(() =>
      expect(screen.getAllByText("Просмотрено 43 %").length).toBeGreaterThan(0),
    );
    const facts = bodiesOf(fetch, FACTS) as { data: { positionSec: number } }[];
    expect(facts.map((f) => f.data.positionSec)).toEqual([120, 52]);
  });

  describe("EARS-10: the report cadence follows the player's own clock, not the server's clamped answer", () => {
    // The server holds a forward seek back (`progress.maxPlaybackRate`); its
    // answer stays far below the player's clock until the playback catches up.
    function clampedPlayer(answer: (sent: number) => number) {
      const fetch = stubFetch({
        [FACTS]: () => {
          const sent = (bodiesOf(fetch, FACTS).at(-1) as { data: { positionSec: number } }).data.positionSec;
          const positionSec = answer(sent);
          return {
            outcome: "recorded",
            changed: [],
            progress: { positionSec, watchedPercent: Math.round((positionSec / 120) * 100) },
          };
        },
      });
      renderStep(videoStep());
      fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
      const iframe = screen.getByTestId("recording-player-rutube") as HTMLIFrameElement;
      // One provider tick, then every pending report settles before the next.
      const tick = async (time: number) => {
        await act(async () => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://rutube.ru",
              data: JSON.stringify({ type: "player:currentTime", data: { time } }),
              source: iframe.contentWindow,
            }),
          );
          await new Promise((r) => setTimeout(r, 0));
        });
      };
      const sent = () =>
        (bodiesOf(fetch, FACTS) as { data: { positionSec: number } }[]).map((f) => f.data.positionSec);
      return { tick, sent };
    }

    it("EARS-10: after a forward seek the server clamps, and the player's ticks send only one report per 10 s of its clock", async () => {
      const { tick, sent } = clampedPlayer((s) => Math.min(s, 20));
      await tick(12.4);
      await tick(80);
      for (let t = 80.3; t < 90; t += 0.3) await tick(t);
      expect(sent()).toEqual([12, 80]);
      await tick(90.2);
      expect(sent()).toEqual([12, 80, 90]);
    });

    it("EARS-10: the end of the media is still reported once, and a lagging server allowance is not polled for", async () => {
      const { tick, sent } = clampedPlayer((s) => Math.min(s, 20));
      await tick(12.4);
      await tick(118.3);
      for (let t = 118.6; t <= 120; t += 0.3) await tick(t);
      await tick(120);
      expect(sent()).toEqual([12, 120]);
    });

    it("EARS-10: a replay after the end reports again, so a completion the server allows only later is reachable", async () => {
      const { tick, sent } = clampedPlayer((s) => Math.min(s, 20));
      await tick(118.3);
      await tick(0.5);
      await tick(118.4);
      expect(sent()).toEqual([120, 0, 120]);
    });
  });

  describe("EARS-10: a refused report is retried on the cadence or a bounded backoff, never on every tick", () => {
    afterEach(() => vi.useRealTimers());

    // Every POST answers 503 while `down`; the backoff timer is fake, the
    // network settles on real macrotasks.
    const OK = () =>
      new Response(
        JSON.stringify({ outcome: "recorded", changed: [], progress: { positionSec: 120, watchedPercent: 100 } }),
        { status: 200 },
      );

    function outagePlayer(refuse: () => Promise<Response> = async () => new Response("{}", { status: 503 })) {
      const state = { down: true, held: null as null | Promise<Response> };
      const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        void init;
        if (state.held) return state.held;
        return state.down
          ? refuse()
          : new Response(
              JSON.stringify({ outcome: "recorded", changed: [], progress: { positionSec: 120, watchedPercent: 100 } }),
              { status: 200 },
            );
      });
      vi.stubGlobal("fetch", fetch);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const view = renderStep(videoStep());
      fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
      const iframe = screen.getByTestId("recording-player-rutube") as HTMLIFrameElement;
      const settle = () => new Promise((r) => setImmediate(r));
      const flush = async () => {
        for (let i = 0; i < 5; i++) await settle();
      };
      const tick = async (time: number) => {
        await act(async () => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://rutube.ru",
              data: JSON.stringify({ type: "player:currentTime", data: { time } }),
              source: iframe.contentWindow,
            }),
          );
          await flush();
        });
      };
      const wait = async (ms: number) => {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
          await flush();
        });
      };
      const sent = () =>
        (bodiesOf(fetch as never, FACTS) as { data: { positionSec: number } }[]).map((f) => f.data.positionSec);
      return { state, tick, wait, sent, view };
    }

    it("EARS-10: while every report fails, the player's ticks attempt one report per 10 s of its clock", async () => {
      const { tick, sent } = outagePlayer();
      for (let t = 10.2; t < 45; t += 0.3) await tick(t);
      expect(sent()).toEqual([10, 20, 30, 40]);
    });

    it("EARS-10: a refused end report is retried on a doubling backoff with the player stopped, and sent once after recovery", async () => {
      const { state, tick, wait, sent } = outagePlayer();
      await tick(118.3);
      expect(sent()).toEqual([120]);
      await wait(REPORT_RETRY_FIRST_MS - 1);
      expect(sent()).toEqual([120]);
      await wait(1);
      expect(sent()).toEqual([120, 120]);
      await wait(REPORT_RETRY_FIRST_MS * 2 - 1);
      expect(sent()).toHaveLength(2);
      state.down = false;
      await wait(1);
      expect(sent()).toEqual([120, 120, 120]);
      expect(screen.getAllByText("Просмотрено 100 %").length).toBeGreaterThan(0);
      await wait(REPORT_RETRY_MAX_MS * 4);
      expect(sent()).toHaveLength(3);
    });

    it("EARS-10: a report in flight when the player reaches the end and stops is followed by the end report once it settles", async () => {
      const { state, tick, wait, sent } = outagePlayer();
      state.down = false;
      let release!: () => void;
      state.held = new Promise<Response>((r) => {
        release = () => r(OK());
      });
      await tick(10.2);
      await tick(118.3);
      await tick(120);
      expect(sent()).toEqual([10]);
      state.held = null;
      await act(async () => {
        release();
        await new Promise((r) => setImmediate(r));
      });
      await wait(0);
      expect(sent()).toEqual([10, 120]);
      await wait(REPORT_RETRY_MAX_MS * 2);
      expect(sent()).toEqual([10, 120]);
    });

    it.each([401, 403, 422])("EARS-10: a %i refusal is not retried for that position", async (status) => {
      const { wait, tick, sent } = outagePlayer(async () => new Response("{}", { status }));
      await tick(118.3);
      await wait(REPORT_RETRY_MAX_MS * 3);
      expect(sent()).toEqual([120]);
    });

    it.each([
      ["a 503", async () => new Response("{}", { status: 503 })],
      ["a 429", async () => new Response("{}", { status: 429 })],
      ["a network error", async (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"))],
    ] as const)("EARS-10: %s is retried on the backoff", async (_label, refuse) => {
      const { wait, tick, sent } = outagePlayer(refuse);
      await tick(118.3);
      await wait(REPORT_RETRY_FIRST_MS);
      expect(sent()).toEqual([120, 120]);
    });

    it("EARS-10: the backoff stops at its cap, and a pending retry is cleared when the screen goes away", async () => {
      const { tick, wait, sent, view } = outagePlayer();
      await tick(118.3);
      await wait(REPORT_RETRY_FIRST_MS); // 2nd
      await wait(REPORT_RETRY_FIRST_MS * 2); // 3rd
      await wait(REPORT_RETRY_FIRST_MS * 4); // 4th
      await wait(REPORT_RETRY_MAX_MS); // 5th, capped
      await wait(REPORT_RETRY_MAX_MS); // 6th
      expect(sent()).toHaveLength(6);
      view.unmount();
      await wait(REPORT_RETRY_MAX_MS * 3);
      expect(sent()).toHaveLength(6);
    });
  });

  it("EARS-16/10: opening the download records the `opened` fact and marks the material opened", async () => {
    const fetch = stubFetch({ [FACTS]: { outcome: "recorded", changed: [] } });
    renderStep(
      videoStep({
        step: {
          id: ID.s3,
          type: "download",
          title: "Памятка по ЭКГ",
          durationMin: 5, test: null, file: { format: "PDF", sizeBytes: 2_621_440 },
          state: { status: "open" },
          completionSentence: "Откройте материал.",
        },
        body: {
          type: "download",
          mediaUrl: "https://s3.example/signed",
          fileName: "ekg.pdf",
          fileSizeBytes: 2_621_440,
          opened: false,
        },
        nextStepId: null,
      }),
    );
    // The canvas meta (`doctor-lesson.dc.html`): «PDF · 2,5 МБ» under the file name and in the kicker.
    expect(screen.getByText("PDF · 2,5 МБ")).toBeInTheDocument();
    expect(screen.getByText("Шаг 2 из 2 · Материал для скачивания · PDF · 2,5 МБ")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Скачать" });
    expect(link).toHaveAttribute("href", "https://s3.example/signed");
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(await screen.findByText("Материал открыт")).toBeInTheDocument();
    expect(bodiesOf(fetch, FACTS)).toEqual([
      expect.objectContaining({ kind: "opened", stepId: ID.s3 }),
    ]);
    expect(screen.getByRole("link", { name: "К пути курса" })).toHaveAttribute(
      "href",
      "/courses/kardio",
    );
  });

  it("EARS-18: the exit test passed at or above the threshold shows the score against the threshold and the lesson done", async () => {
    const fetch = stubFetch({ [START]: ATTEMPT, [SUBMIT]: result(true, 1) });
    renderStep(testStep(), ID.s4, testLesson());
    expect(screen.getByText("1 вопрос · порог 70 %")).toBeInTheDocument();
    await answerAndSubmit();
    expect(
      await screen.findByText("Тест сдан: 100 % при пороге 70 %"),
    ).toBeInTheDocument();
    expect(screen.getByText("Урок пройден")).toBeInTheDocument();
    expect(bodiesOf(fetch, SUBMIT)).toEqual([
      { answers: [{ questionId: ID.q1, optionId: ID.o1 }] },
    ]);
  });

  it("EARS-18: a fail below the threshold shows the score, the attempts left and a retry", async () => {
    stubFetch({ [START]: ATTEMPT, [SUBMIT]: result(false, 2) });
    renderStep(testStep(), ID.s4, testLesson());
    await answerAndSubmit();
    expect(
      await screen.findByText(
        "Тест не сдан: 0 % при пороге 70 %. Пройденные шаги сохранены.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Осталось попыток: 2.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Повторить тест" }),
    ).toBeEnabled();
  });

  it("EARS-18: a fail with no attempts left disables the retry", async () => {
    stubFetch({ [START]: ATTEMPT, [SUBMIT]: result(false, 0) });
    renderStep(testStep(), ID.s4, testLesson());
    await answerAndSubmit();
    expect(await screen.findByText("Осталось попыток: 0.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Повторить тест" }),
    ).toBeDisabled();
  });

  describe("EARS-15: the strip of the lesson's steps (doctor-lesson.dc.html v18)", () => {
    const stripLesson = () =>
      lessonRead({
        steps: [
          ...lessonRead().steps,
          {
            id: ID.s4,
            type: "test",
            title: "Итоговый тест",
            durationMin: 10, test: { questionCount: 10, threshold: 80 }, file: null,
            state: { status: "locked", reason: { kind: "previous" } },
            completionSentence: "Сдайте тест.",
          },
        ] as ReturnType<typeof lessonRead>["steps"],
      });
    const connectors = () => {
      const strip = screen.getByRole("list", { name: "Шаги урока" });
      return [...strip.querySelectorAll("li")].map((li) => [
        ...li.querySelectorAll("[data-connector]"),
      ]);
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
      for (const line of [first![1]!, second![0]!])
        expect(line).toHaveClass(
          "border-t-4",
          "border-solid",
          "border-primary-action",
        );
      for (const line of [second![1]!, third![0]!])
        expect(line).toHaveClass(
          "border-t-4",
          "border-dashed",
          "border-muted-2",
        );
      for (const end of [first![0]!, third![1]!])
        expect(end).not.toHaveClass("border-t-4");
    });

    it("EARS-15: a step box is 2.75rem on a phone and 3.5rem from md, with the step type under it on desktop", () => {
      renderStep(videoStep(), ID.s2, stripLesson());
      const strip = screen.getByRole("list", { name: "Шаги урока" });
      const boxes = strip.querySelectorAll("[data-step-box]");
      expect(boxes).toHaveLength(3);
      for (const box of boxes) expect(box).toHaveClass("size-11", "md:size-14");
      const captions = [...strip.querySelectorAll("[data-step-caption]")];
      expect(captions.map((c) => c.textContent)).toEqual([
        "Серия",
        "Материал для скачивания",
        "Тест",
      ]);
      for (const c of captions) expect(c).toHaveClass("hidden", "md:block");
    });
  });
});

describe("024 design §8 — the points plate on the step screen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the doctor's balances under the step", () => {
    render(<StepScreen courseSlug="kardio" config={CONFIG} lesson={lessonRead()} stepId={ID.s2} step={videoStep()} points={{ pul: 1250, bre: 3, con: 0 }} />);
    expect(screen.getAllByTestId("points-plate-value").map((v) => v.textContent?.replace(/\s/g, " "))).toEqual(["1 250 Pul", "3 Bre", "0 Con"]);
  });
});

describe("024 EARS-15/17 — the step screen follows the evaluated state in place", () => {
  afterEach(() => vi.unstubAllGlobals());

  const LESSON = `GET /v1/learning/lessons/${ID.l2}`;
  const STEP = `GET /v1/me/learning/steps/${ID.s2}`;
  const POINTS = "GET /v1/me/points";
  const before = () =>
    lessonRead({
      steps: [
        { id: ID.s2, type: "video", title: "Чтение ЭКГ", durationMin: 15, test: null, file: null, state: { status: "current" }, completionSentence: "Досмотрите видео до конца." },
        { id: ID.s3, type: "download", title: "Памятка по ЭКГ", durationMin: 5, test: null, file: { format: "PDF", sizeBytes: 1_258_291 }, state: { status: "locked", reason: { kind: "previous" } }, completionSentence: "Откройте материал." },
      ],
    });
  const after = () =>
    lessonRead({
      steps: [
        { id: ID.s2, type: "video", title: "Чтение ЭКГ", durationMin: 15, test: null, file: null, state: { status: "done" }, completionSentence: "Досмотрите видео до конца." },
        { id: ID.s3, type: "download", title: "Памятка по ЭКГ", durationMin: 5, test: null, file: { format: "PDF", sizeBytes: 1_258_291 }, state: { status: "current" }, completionSentence: "Откройте материал." },
      ],
    });
  const account = (pul: number) => ({
    personId: ID.course,
    pul: { unit: "pul", available: pul, reserved: 0 },
    bre: 1,
    con: 0,
    advance: { open: 0, owed: 0 },
  });
  const stripWords = () =>
    screen
      .getByRole("list", { name: "Шаги урока" })
      .querySelectorAll("[aria-label]");
  const hereCount = () =>
    [...stripWords()].filter((n) => n.getAttribute("aria-label")!.endsWith("Вы здесь")).length;

  it("EARS-17: the fact that completes the step re-reads the step, the strip and the plate — «Дальше» appears without a reload", async () => {
    const fetch = stubFetch({
      [FACTS]: () => ({
        outcome: "recorded",
        changed: [{ itemKind: "step", itemId: ID.s2, status: "done" }],
        progress: { positionSec: 120, watchedPercent: 100 },
      }),
      [LESSON]: after,
      [STEP]: () => videoStep({ step: { ...videoStep().step, state: { status: "done" } }, nextStepId: ID.s3 }),
      [POINTS]: () => account(1300),
    });
    render(
      <StepScreen
        courseSlug="kardio"
        config={CONFIG}
        lesson={before()}
        stepId={ID.s2}
        step={videoStep({ nextStepId: null })}
        points={{ pul: 1250, bre: 1, con: 0 }}
      />,
    );
    expect(screen.queryByRole("link", { name: "Дальше" })).toBeNull();
    expect(screen.getByRole("img", { name: /Шаг 2\. Памятка по ЭКГ\. Закрыт/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    const iframe = screen.getByTestId("recording-player-rutube") as HTMLIFrameElement;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://rutube.ru",
          data: JSON.stringify({ type: "player:currentTime", data: { time: 120 } }),
          source: iframe.contentWindow,
        }),
      );
    });
    expect(await screen.findByRole("link", { name: "Дальше" })).toHaveAttribute(
      "href",
      `/courses/kardio/steps/${ID.s3}`,
    );
    expect(screen.getByRole("link", { name: /Шаг 2\. Памятка по ЭКГ\. Открыт/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByTestId("points-plate-value")[0]!.textContent?.replace(/\s/g, " ")).toBe("1 300 Pul"),
    );
    expect(hereCount()).toBe(1);
    // The player keeps playing: the re-read does not remount the step body.
    expect(screen.getByTestId("recording-player-rutube")).toBe(iframe);
    expect(fetch.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${u}`)).toEqual(
      expect.arrayContaining([LESSON, STEP, POINTS]),
    );
  });

  it("EARS-10: a fact that changes no state re-reads nothing", async () => {
    const fetch = stubFetch({
      [FACTS]: () => ({ outcome: "recorded", changed: [], progress: { positionSec: 12, watchedPercent: 10 } }),
    });
    renderStep(videoStep());
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    const iframe = screen.getByTestId("recording-player-rutube") as HTMLIFrameElement;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://rutube.ru",
          data: JSON.stringify({ type: "player:currentTime", data: { time: 12 } }),
          source: iframe.contentWindow,
        }),
      );
    });
    await waitFor(() => expect(screen.getAllByText("Просмотрено 10 %").length).toBeGreaterThan(0));
    expect(fetch.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${u}`)).toEqual([FACTS]);
  });

  it("EARS-15: exactly one step is «Вы здесь» — the viewed one; the evaluated next step reads «Открыт»", () => {
    stubFetch({});
    renderStep(videoStep({ step: { ...videoStep().step, state: { status: "done" } } }), ID.s2, after());
    expect(hereCount()).toBe(1);
    expect(screen.getByRole("link", { name: /Шаг 1\. Чтение ЭКГ\. Вы здесь/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: /Шаг 2\. Памятка по ЭКГ\. Открыт/ })).not.toHaveAttribute("aria-current");
  });

  it("EARS-18: a passed exit test that completes the lesson re-reads the strip", async () => {
    const STEP4 = `GET /v1/me/learning/steps/${ID.s4}`;
    const fetch = stubFetch({
      [START]: ATTEMPT,
      [SUBMIT]: { ...result(true, 1), changed: [{ itemKind: "lesson", itemId: ID.l2, status: "done" }] },
      [LESSON]: () =>
        lessonRead({
          steps: [{ ...testLesson().steps[0]!, state: { status: "done" } }] as ReturnType<typeof lessonRead>["steps"],
        }),
      [STEP4]: () => testStep(0),
    });
    renderStep(testStep(), ID.s4, testLesson());
    await answerAndSubmit();
    expect(await screen.findByText("Тест сдан: 100 % при пороге 70 %")).toBeInTheDocument();
    // The viewed step stays «Вы здесь»; the read behind it is done now.
    await waitFor(() =>
      expect(fetch.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${u}`)).toEqual(
        expect.arrayContaining([LESSON, STEP4]),
      ),
    );
    expect(screen.getByRole("link", { name: /Шаг 1\. Итоговый тест\. Вы здесь/ })).toBeInTheDocument();
    // The result stays on screen through the re-read.
    expect(screen.getByText("Урок пройден")).toBeInTheDocument();
  });
});

describe("024 EARS-16 — the step's actions are live only once the page is interactive", () => {
  it("the server render ships «Смотреть видео» disabled; the hydrated screen enables it", async () => {
    const { renderToString } = await import("react-dom/server");
    const html = renderToString(
      <StepScreen courseSlug="kardio" config={CONFIG} lesson={lessonRead()} stepId={ID.s2} step={videoStep()} />,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const watch = [...doc.querySelectorAll("button")].find((b) => b.textContent?.includes("Смотреть видео"));
    expect(watch).toBeDefined();
    expect(watch!.disabled).toBe(true);
    stubFetch({});
    renderStep(videoStep());
    expect(screen.getByRole("button", { name: "Смотреть видео" })).toBeEnabled();
    vi.unstubAllGlobals();
  });
});
