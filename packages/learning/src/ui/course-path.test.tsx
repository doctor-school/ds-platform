// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePath } from "./course-path";
import { summaryAction } from "./node-summary";
import { buildPathView, sectionCurves, snakeGeometry } from "./path-view";
import { CONFIG, ID, coursePath, lessonRead, multiModulePath, stubFetch, stubMatchMedia } from "./__tests__/fixtures";
import type { LearningCoursePath } from "@ds/schemas";

// 024 EARS-14 — the course path block of `design-source/doctor-course.dc.html`
// v16: node states, the locked reason, the empty and error states, the
// breadcrumb, the author, and the summary of the selected node.

const node = (name: RegExp) => screen.getByRole("button", { name });

describe("024 EARS-14 — the course path", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    stubFetch({ [`GET /v1/learning/lessons/${ID.l2}`]: lessonRead() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("EARS-14: every node names its state — done, «Вы здесь», open and the first locked one with the canvas line", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(node(/Урок 1, шаг 1\. Серия\. Сбор анамнеза\. Пройден/)).toBeInTheDocument();
    expect(node(/Урок 2, шаг 1\. Серия\. Чтение ЭКГ\. Вы здесь/)).toBeInTheDocument();
    expect(node(/Урок 2, шаг 2\. Материал для скачивания\. Памятка по ЭКГ\. Открыт/)).toBeInTheDocument();
    expect(node(/Урок 3, шаг 1\. Тест\. Итоговый тест\. Закрыт/)).toBeInTheDocument();
    expect(screen.getAllByText("Вы здесь", { selector: "span,div" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Откроется после предыдущего шага")).toBeInTheDocument();
  });

  it("EARS-14: the progress band counts done lessons from the read and continues at the «Вы здесь» step on the path", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.getAllByText("Пройдено 1 урок из 3").length).toBeGreaterThan(0);
    // Canvas `goHere`: the band brings the «Вы здесь» node into view; its summary opens the step.
    expect(screen.getByRole("link", { name: "Продолжить — урок 2" })).toHaveAttribute("href", `#node-${ID.s2}`);
  });

  it("EARS-14: a course with no lessons shows the empty state, not an empty snake", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath({ modules: [], current: null })} />);
    expect(screen.getByText("Путь готовится.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /Урок \d/ })).toHaveLength(0);
  });

  it("EARS-14: a failed read shows the error and «Повторить» reads the path again", async () => {
    const fetch = stubFetch({ "GET /v1/learning/courses/kardio/path": coursePath() });
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={null} />);
    expect(screen.getByText("Не удалось загрузить путь курса.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(node(/Чтение ЭКГ\. Вы здесь/)).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/v1/learning/courses/kardio/path", expect.objectContaining({ method: "GET" }));
  });

  it("EARS-14: the breadcrumb names direction, school and course from the read, and omits a non-public direction", () => {
    const { unmount } = render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    const crumbs = within(screen.getByRole("navigation", { name: "Вы здесь" }));
    expect(crumbs.getByText("Кардиология")).toBeInTheDocument();
    expect(crumbs.getByText("Школа сердца")).toBeInTheDocument();
    expect(crumbs.getByText("Кардиология для практика")).toHaveAttribute("aria-current", "page");
    unmount();
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath({ direction: null })} />);
    const none = within(screen.getByRole("navigation", { name: "Вы здесь" }));
    expect(none.queryByText("Кардиология")).toBeNull();
    expect(none.getByText("Школа сердца")).toBeInTheDocument();
  });

  it("EARS-14: the author block shows a public author and is absent without one", () => {
    const { unmount } = render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.getByText("Автор курса")).toBeInTheDocument();
    expect(screen.getByText("Анна Иванова")).toBeInTheDocument();
    unmount();
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath({ author: null })} />);
    expect(screen.queryByText("Автор курса")).toBeNull();
  });

  it("EARS-14: selecting a node shows its summary with the lesson's sentence and the one action its state allows", async () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    const summary = () => within(screen.getByTestId("node-summary"));
    // «Вы здесь» is selected first.
    expect(summary().getByRole("link", { name: "Продолжить" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s2}`);
    await waitFor(() => expect(summary().getByText("Урок пройден, когда пройдены все шаги.")).toBeInTheDocument());
    fireEvent.click(node(/Сбор анамнеза\. Пройден/));
    expect(summary().getByRole("link", { name: "Повторить" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s1}`);
    fireEvent.click(node(/Итоговый тест\. Закрыт/));
    expect(summary().getByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeInTheDocument();
    expect(summary().queryByRole("link")).toBeNull();
  });

  it("EARS-14: on the narrow axis a selected node opens its summary in a Sheet", () => {
    stubMatchMedia(true);
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(node(/Памятка по ЭКГ\. Открыт/));
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByText("Памятка по ЭКГ")).toBeInTheDocument();
    expect(sheet.getByRole("link", { name: "Начать" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s3}`);
  });

  it("EARS-14: the summary names where the step is — «Урок N · шаг s из S · статус» — then the step's type and meta (canvas `sum`)", () => {
    const { unmount } = render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    const summary = within(screen.getByTestId("node-summary"));
    expect(summary.getByText("Урок 2 · шаг 1 из 2 · Вы здесь")).toBeInTheDocument();
    expect(summary.getByRole("heading", { name: "Чтение ЭКГ" })).toBeInTheDocument();
    expect(summary.getByText("Серия · видео · 15 минут")).toBeInTheDocument();
    // The lesson's step list is the Sheet's (canvas `materials`), not the aside's.
    expect(summary.queryByRole("list", { name: "Шаги урока" })).toBeNull();
    fireEvent.click(node(/Памятка по ЭКГ\. Открыт/));
    expect(summary.getByText("Урок 2 · шаг 2 из 2 · Открыт")).toBeInTheDocument();
    expect(summary.getByText("Материал для скачивания · PDF · 1,2 МБ")).toBeInTheDocument();
    unmount();
    // A course of several modules names the module too.
    render(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(6, 3, 8)} />);
    expect(within(screen.getByTestId("node-summary")).getByText("Урок 8 · модуль 3 · шаг 1 из 3 · Вы здесь")).toBeInTheDocument();
  });

  it("EARS-14: the Sheet names where the step is — «Урок N · модуль M · шаг s из S» — and lists the lesson's steps (canvas `sheetNote`, `materials`)", () => {
    stubMatchMedia(true);
    render(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(6, 3, 8)} />);
    fireEvent.click(node(/^Урок 8, шаг 2\./));
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByText("Урок 8 · модуль 3 · шаг 2 из 3")).toBeInTheDocument();
    const steps = within(sheet.getByRole("list", { name: "Шаги урока" })).getAllByRole("listitem");
    expect(steps.map((li) => li.textContent)).toEqual([
      "1Серия · Серия урока 8",
      "2Материал для скачивания · Памятка урока 8",
      "3Тест · Тест урока 8",
    ]);
  });
});

describe("024 EARS-14 — summaryAction", () => {
  const view = buildPathView(coursePath());
  const nodes = view.sections.flatMap((s) => s.nodes);
  const byId = (id: string) => nodes.find((n) => n.id === id)!;
  const hrefs = { step: "/step", register: "/register?returnTo=%2Fcourses%2Fkardio" };

  it("EARS-14: a guest gets the registration door on any step", () => {
    expect(summaryAction(byId(ID.s4), false, hrefs)).toEqual({ kind: "guest", href: hrefs.register });
  });
  it("EARS-14: a locked step offers no action", () => {
    expect(summaryAction(byId(ID.s4), true, hrefs)).toBeNull();
  });
  it("EARS-14: done → «Повторить», «Вы здесь» → «Продолжить», open → «Начать»", () => {
    expect(summaryAction(byId(ID.s1), true, hrefs)?.kind).toBe("repeat");
    expect(summaryAction(byId(ID.s2), true, hrefs)?.kind).toBe("continue");
    expect(summaryAction(byId(ID.s3), true, hrefs)?.kind).toBe("start");
  });
  it("EARS-14: the document node offers no action", () => {
    expect(summaryAction(byId("document"), true, hrefs)).toBeNull();
  });
});

describe("024 EARS-14 — the points plate on the course path", () => {
  beforeEach(() => stubMatchMedia(false));
  afterEach(() => vi.unstubAllGlobals());

  it("EARS-14: shows the doctor's three balances from the 025 read", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} points={{ pul: 120, bre: 34, con: 12 }} />);
    const plate = screen.getByTestId("points-plate");
    expect(within(plate).getAllByTestId("points-plate-value").map((v) => v.textContent)).toEqual(["120 Pul", "34 Bre", "12 Con"]);
  });

  it("EARS-14: a guest sees the plate with a dash for each balance", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath({ signedIn: false })} points={null} />);
    expect(screen.getAllByTestId("points-plate-value").map((v) => v.textContent)).toEqual(["— Pul", "— Bre", "— Con"]);
  });

  it("EARS-14: a failed points read shows no plate rather than a made-up number", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.queryByTestId("points-plate")).toBeNull();
  });
});

/**
 * The read of a course nobody has started (EARS-11/13): step 1 is the server's
 * `current`, every later node locked behind the previous — what a guest
 * (no facts) and a signed-in doctor with no done step both get.
 */
function freshPath(signedIn: boolean): LearningCoursePath {
  const locked = { status: "locked", reason: { kind: "previous" } } as const;
  const base = coursePath();
  const lessons = base.modules[0]!.lessons.map((l, li) => ({
    ...l,
    state: li === 0 ? ({ status: "current" } as const) : locked,
    steps: l.steps.map((s) => ({ ...s, state: s.id === ID.s1 ? ({ status: "current" } as const) : locked })),
  }));
  return coursePath({
    signedIn,
    modules: [{ ...base.modules[0]!, lessons }],
    current: { stepId: ID.s1, lessonId: ID.l1 },
  });
}

// `design-source/doctor-course.dc.html` `renderVals`: a guest's lesson steps
// are all `plain`; a signed-in doctor's are done / here (only while
// `inProgress`, `hereG`) / closed / open; `defaultSel` = hereG or 's1'.
describe("024 EARS-14 — the path per viewer state (guest · not started · in progress)", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    stubFetch({});
  });
  afterEach(() => vi.unstubAllGlobals());

  const hereBadges = () => screen.queryAllByText("Вы здесь", { selector: "span,div" });

  it("EARS-14: a guest sees every step plain — no «Вы здесь», no state word, no locked reason, the line open", () => {
    const view = buildPathView(freshPath(false));
    const steps = view.sections[0]!.nodes.filter((n) => n.kind === "step");
    expect(steps.map((n) => n.tone)).toEqual(["plain", "plain", "plain", "plain"]);
    expect(steps.every((n) => !n.here && n.reason === null)).toBe(true);
    expect(view.current).toBeNull();
    const curves = sectionCurves(view.sections[0]!.nodes, 0, snakeGeometry(false), null, null);
    expect(curves.locked).toBe("");
    expect(curves.open).not.toBe("");
    expect(view.outline[0]!.lessons.map((l) => l.tone)).toEqual(["plain", "plain", "plain"]);

    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={freshPath(false)} />);
    expect(hereBadges()).toHaveLength(0);
    expect(node(/^Урок 1, шаг 1\. Серия\. Сбор анамнеза$/)).toBeInTheDocument();
    expect(node(/^Урок 3, шаг 1\. Тест\. Итоговый тест$/)).toBeInTheDocument();
    expect(screen.queryByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeNull();
    expect(screen.queryByRole("link", { name: /Продолжить/ })).toBeNull();
    // Step 1 is selected first; its summary offers the registration door.
    const summary = within(screen.getByTestId("node-summary"));
    expect(summary.getByText("Сбор анамнеза")).toBeInTheDocument();
    expect(summary.getByRole("link", { name: "Открыть" })).toHaveAttribute("href", expect.stringMatching(/^\/register\?returnTo=/));
  });

  it("EARS-14: a doctor who has not started sees step 1 open and the rest closed — no «Вы здесь»; the band offers «Начать курс»", () => {
    const view = buildPathView(freshPath(true));
    expect(view.sections[0]!.nodes.filter((n) => n.kind === "step").map((n) => n.tone)).toEqual(["open", "closed", "closed", "closed"]);
    expect(view.current).toBeNull();

    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={freshPath(true)} />);
    expect(hereBadges()).toHaveLength(0);
    expect(node(/^Урок 1, шаг 1\. Серия\. Сбор анамнеза\. Открыт$/)).toBeInTheDocument();
    expect(node(/^Урок 2, шаг 1\. Серия\. Чтение ЭКГ\. Закрыт$/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Продолжить/ })).toBeNull();
    expect(screen.getByText("3 урока")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Начать курс" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s1}`);
    const summary = within(screen.getByTestId("node-summary"));
    expect(summary.getByText("Сбор анамнеза")).toBeInTheDocument();
    expect(summary.getByRole("link", { name: "Начать" })).toHaveAttribute("href", `/courses/kardio/steps/${ID.s1}`);
  });

  it("EARS-14: a doctor in progress sees exactly one «Вы здесь» — on the current step, with «Продолжить»", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(hereBadges()).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Начать курс" })).toBeNull();
    expect(screen.getByRole("link", { name: "Продолжить — урок 2" })).toBeInTheDocument();
  });

  // Canvas `reason: st === 'closed' && g === doneSteps + 2 ? 'Откроется после предыдущего шага' : ''`:
  // only the first closed step — the one right after the doctor's next step —
  // carries the line on the path; the summary of ANY selected closed step names
  // its reason (`sum.hasReason: isLesson && st === 'closed'`).
  it("EARS-14: only the first locked step carries «Откроется после предыдущего шага» on the path; a selected locked step's summary names its reason", () => {
    const LINE = "Откроется после предыдущего шага";
    const fresh = buildPathView(freshPath(true)).sections[0]!.nodes.filter((n) => n.kind === "step");
    expect(fresh.map((n) => n.lockNote)).toEqual([null, LINE, null, null]);
    const going = buildPathView(coursePath()).sections[0]!.nodes.filter((n) => n.kind === "step");
    expect(going.map((n) => n.lockNote)).toEqual([null, null, null, LINE]);

    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={freshPath(true)} />);
    expect(screen.getAllByText(LINE)).toHaveLength(1);
    expect(screen.queryByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeNull();
    fireEvent.click(node(/^Урок 3, шаг 1\. Тест\. Итоговый тест\. Закрыт$/));
    const summary = within(screen.getByTestId("node-summary"));
    expect(summary.getByText("Шаг откроется, когда будут пройдены предыдущие.")).toBeInTheDocument();
    expect(summary.queryByRole("link")).toBeNull();
  });

  it("EARS-14: the kicker names the step's medium as the canvas metas do — video «Серия · видео · N минут»", () => {
    const nodes = buildPathView(coursePath()).sections[0]!.nodes;
    const kicker = (id: string) => nodes.find((n) => n.id === id)!.kicker;
    expect(kicker(ID.s1)).toBe("Серия · видео · 12 минут");
    expect(nodes.find((n) => n.id === ID.s1)!.kickerParts).toEqual(["Серия", "видео", "12 минут"]);
  });

  it("EARS-14: the kicker carries the canvas metas — a test «Тест · N вопросов · порог P %», a download «Материал для скачивания · PDF · 1,2 МБ»", () => {
    const nodes = buildPathView(coursePath()).sections[0]!.nodes;
    const node = (id: string) => nodes.find((n) => n.id === id)!;
    expect(node(ID.s3).kicker).toBe("Материал для скачивания · PDF · 1,2 МБ");
    expect(node(ID.s3).kickerParts).toEqual(["Материал для скачивания", "PDF", "1,2 МБ"]);
    expect(node(ID.s4).kicker).toBe("Тест · 10 вопросов · порог 80 %");
    expect(node(ID.s4).kickerParts).toEqual(["Тест", "10 вопросов", "порог 80 %"]);
  });

  it("EARS-14: the question count is declined and a small file reads in КБ", () => {
    const kickers = (test: { questionCount: number; threshold: number }, file = { format: "PDF", sizeBytes: 1_258_291 }) => {
      const path = coursePath();
      path.modules[0]!.lessons[1]!.steps[1]!.file = file;
      path.modules[0]!.lessons[2]!.steps[0]!.test = test;
      const nodes = buildPathView(path).sections[0]!.nodes;
      return [ID.s3, ID.s4].map((id) => nodes.find((n) => n.id === id)!.kicker);
    };
    expect(kickers({ questionCount: 1, threshold: 70 }, { format: "DOCX", sizeBytes: 350 * 1024 })).toEqual([
      "Материал для скачивания · DOCX · 350 КБ",
      "Тест · 1 вопрос · порог 70 %",
    ]);
    expect(kickers({ questionCount: 3, threshold: 100 })[1]).toBe("Тест · 3 вопроса · порог 100 %");
    expect(kickers({ questionCount: 21, threshold: 80 })[1]).toBe("Тест · 21 вопрос · порог 80 %");
    expect(kickers({ questionCount: 12, threshold: 80 })[1]).toBe("Тест · 12 вопросов · порог 80 %");
  });
});
